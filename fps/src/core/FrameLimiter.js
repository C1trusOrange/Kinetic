// 'Low latency mode': a GPU frames-in-flight limiter for Game._loop.
//
// Chrome lets WebGL frames pile up between the page and the display: the GPU process executes the page's commands
// (ANGLE -> D3D11), then the GPU runs them, and each stage keeps accepting new frames while it is busy. When that
// pipeline is the bottleneck every input waits behind the frames already queued in it - measured at 2560x1440 on the
// Radeon 860M: 118-147 ms from a key press to the GPU finishing the frame that reacted to it, which feels like the
// game "eats" inputs and replays them later. The limiter puts a fence after each frame's draw calls, and a
// requestAnimationFrame callback is skipped (no input edges consumed, no simulation, no render) while `maxFrames`
// earlier frames are still unfinished, so input is only sampled when the pipeline can take the frame.
//
// Depth. A fence is only seen as signalled at the next rAF after the GPU side finished (Chrome polls it), so even
// a GPU that keeps up reports each frame done 1-2 frame intervals after it was submitted. Measured on this laptop
// (in-session A/B against no limiter, Radeon 860M, foundry 8 bots):
//   maxFrames 1: -27..-43 % fps everywhere (page and GPU process serialised), so it is never used.
//   maxFrames 2: input -> GPU-done -36..-41 % when GPU-bound (2560x1440 4x MSAA: 49.7 -> 29.2 ms, no fps loss), but
//                at 1280x720 'medium', where the GPU keeps up, it skipped rAFs for nothing: -4..-9 % fps, latency
//                not lower.
//   maxFrames 3: no fps loss at 1280x720, but only -18..-21 % latency when GPU-bound.
// So the depth is automatic (autoDepth, default): 3 while the GPU keeps up, 2 while it is the bottleneck. The signal
// is the limiter's own skip rate over a window of frames: at depth 3 the queue only fills up (>= 0.3 skipped rAFs per
// frame) when the GPU side is slower than the page; at depth 2 a skip rate under 0.2 per frame means the GPU side is
// keeping up again. Measured skip rates: 1280x720 medium 0.03 (depth 3) / 0.10-0.18 (depth 2); 1932x1086 high
// 0.10 / 0.32-0.67; 2560x1440 ultra 0.58 / 0.88-1.59.
//
// Waiting is time-capped: the oldest unfinished frame is waited for until it is (maxFrames + 0.5) x the recent frame
// interval old (8..100 ms), so a slow GPU frame can hold the loop back by at most about one frame; after 120
// consecutive capped frames (a fence that never signals: driver bug) the limiter switches itself off with a warning.

const CAP_MIN_MS = 8;
const CAP_MAX_MS = 100;
const MAX_CAPPED_RUN = 120;
const RING = 4;
/** autoDepth: frames per decision window, and the skip rates (skipped rAFs per frame) that change the depth. */
const AUTO_WINDOW = 120;
const AUTO_TO_2 = 0.3;
const AUTO_TO_3 = 0.2;

/** Frames-in-flight limiter driven by WebGL2 fence syncs (see the file comment). */
export class FrameLimiter {
  /** @param {WebGL2RenderingContext} gl the renderer's context */
  constructor(gl) {
    this.gl = gl;
    /** false when the context has no fence syncs (WebGL1) */
    this.supported = !!gl && typeof gl.fenceSync === 'function';
    /** Whether fences are issued (the 'lowLatency' setting); see setEnabled. */
    this.enabled = false;
    /** true: maxFrames follows the GPU (3 while it keeps up, 2 while it is the bottleneck); false: maxFrames is fixed. */
    this.autoDepth = true;
    /** A frame starts only while fewer than this many earlier frames are unfinished on the GPU (1..RING). */
    this.maxFrames = 3;
    this._syncs = new Array(RING).fill(null);   // ring of pending fences, oldest at _head
    this._times = new Float64Array(RING);
    this._head = 0;
    this._count = 0;
    this._lastFrameAt = 0;
    this._interval = 16.7;   // EMA of the interval between frames that ran (ms)
    this._cappedRun = 0;
    this._winFrames = 0;     // autoDepth window: frames run / rAFs skipped
    this._winSkips = 0;
    /**
     * Counters for tests and profiling: rAFs skipped, frames that ran on the time cap, longest skip streak, autoDepth
     * depth changes and frames run at depth 2 / 3.
     */
    this.stats = { skipped: 0, capped: 0, maxRun: 0, run: 0, disabled: '', depthChanges: 0, framesAt2: 0, framesAt3: 0 };
  }

  /** @param {boolean} on */
  setEnabled(on) {
    this.enabled = !!on && this.supported && !this.stats.disabled;
    if (!this.enabled) this._clear();
  }

  /**
   * Call at the top of every rAF callback, before anything else (only while frames are submitted each rAF).
   * @returns {boolean} true = maxFrames earlier frames are still unfinished: return without doing anything this rAF
   */
  shouldSkip() {
    if (!this._count) return false;
    const gl = this.gl;
    if (gl.isContextLost()) {
      this._syncs.fill(null);
      this._count = 0;
      return false;
    }
    // retire finished frames (fences signal in submission order)
    while (this._count && gl.getSyncParameter(this._syncs[this._head], gl.SYNC_STATUS) === gl.SIGNALED) this._pop();
    const s = this.stats;
    if (this._count < this.maxFrames) {
      this._cappedRun = 0;
      s.run = 0;
      return false;
    }
    const cap = Math.min(CAP_MAX_MS, Math.max(CAP_MIN_MS, this._interval * (this.maxFrames + 0.5)));
    if (performance.now() - this._times[this._head] < cap) {
      s.skipped++;
      this._winSkips++;
      if (++s.run > s.maxRun) s.maxRun = s.run;
      return true;
    }
    // time cap: run this frame anyway and stop waiting for the oldest fence
    this._pop();
    s.capped++;
    s.run = 0;
    if (++this._cappedRun >= MAX_CAPPED_RUN) {
      s.disabled = 'fence did not signal for ' + MAX_CAPPED_RUN + ' frames';
      console.warn('[game] low latency mode switched off:', s.disabled);
      this.setEnabled(false);
    }
    return false;
  }

  /** Call right after the frame's draw calls were issued (after Game.render). */
  frameSubmitted() {
    const now = performance.now();
    if (this._lastFrameAt) {
      const dt = now - this._lastFrameAt;
      if (dt > 0 && dt < 250) this._interval += (dt - this._interval) * 0.1;
    }
    this._lastFrameAt = now;
    if (!this.enabled) return;
    const gl = this.gl;
    if (this._count === RING) this._pop();
    const i = (this._head + this._count) % RING;
    this._syncs[i] = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    this._times[i] = now;
    this._count++;
    gl.flush();   // a fence only signals once the commands before it were submitted
    if (this.maxFrames === 2) this.stats.framesAt2++;
    else if (this.maxFrames === 3) this.stats.framesAt3++;
    if (++this._winFrames >= AUTO_WINDOW) this._adaptDepth();
  }

  /** autoDepth: pick maxFrames 2 or 3 from the skip rate of the window that just ended (see the file comment). */
  _adaptDepth() {
    const rate = this._winSkips / this._winFrames;
    this._winFrames = 0;
    this._winSkips = 0;
    if (!this.autoDepth) return;
    const next = this.maxFrames >= 3 ? (rate >= AUTO_TO_2 ? 2 : 3) : (rate < AUTO_TO_3 ? 3 : 2);
    if (next !== this.maxFrames) {
      this.maxFrames = next;
      this.stats.depthChanges++;
    }
  }

  _pop() {
    const s = this._syncs[this._head];
    if (s) this.gl.deleteSync(s);
    this._syncs[this._head] = null;
    this._head = (this._head + 1) % RING;
    this._count--;
  }

  _clear() {
    while (this._count) this._pop();
    this._winFrames = 0;
    this._winSkips = 0;
  }
}
