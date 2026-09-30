// 'Low latency mode': a GPU frames-in-flight limiter for Game._loop.
//
// Chrome/ANGLE lets WebGL queue about three frames on the GPU. When the GPU is the bottleneck every input then waits
// behind that queue: measured 120-170 ms from a key press to the GPU finishing the frame that reacted to it at 28 fps,
// which feels like the game "eats" inputs and replays them later. The limiter puts a fence after each frame's draw
// calls; a requestAnimationFrame callback is skipped (no input edges consumed, no simulation, no render) while
// `maxFrames` earlier frames are still unfinished on the GPU, so input is sampled only when the GPU can take the frame.
//
// A skip streak is time-capped at about one frame (the oldest fence may be (maxFrames + 0.25) x the recent frame
// interval old, 4..100 ms), so a slow GPU frame can hold the loop back by at most that much; after 120 consecutive
// capped frames (a fence that never signals: driver bug, lost context) the limiter switches itself off with a warning.

const CAP_MIN_MS = 4;
const CAP_MAX_MS = 100;
const MAX_CAPPED_RUN = 120;
const RING = 4;

export class FrameLimiter {
  /** @param {WebGL2RenderingContext} gl the renderer's context */
  constructor(gl) {
    this.gl = gl;
    /** false when the context has no fence syncs (WebGL1) */
    this.supported = !!gl && typeof gl.fenceSync === 'function';
    /** Whether fences are issued (the 'lowLatency' setting); see setEnabled. */
    this.enabled = false;
    /** Frames that may be in flight (submitted, not finished on the GPU) when a new one starts: 1..RING. */
    this.maxFrames = 1;
    this._syncs = new Array(RING).fill(null);   // ring of pending fences, oldest at _head
    this._times = new Float64Array(RING);
    this._head = 0;
    this._count = 0;
    this._lastFrameAt = 0;
    this._interval = 16.7;   // EMA of the interval between frames that ran (ms)
    this._cappedRun = 0;
    /** Counters for tests and profiling: rAFs skipped, frames that ran on the time cap, longest skip streak. */
    this.stats = { skipped: 0, capped: 0, maxRun: 0, run: 0, disabled: '' };
  }

  /** @param {boolean} on */
  setEnabled(on) {
    this.enabled = !!on && this.supported && !this.stats.disabled;
    if (!this.enabled) this._clear();
  }

  /**
   * Call at the top of every rAF callback, before anything else.
   * @returns {boolean} true = the GPU still has maxFrames unfinished frames: return without doing anything this rAF
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
    if (this._count < this.maxFrames) {
      this._cappedRun = 0;
      this.stats.run = 0;
      return false;
    }
    const cap = Math.min(CAP_MAX_MS, Math.max(CAP_MIN_MS, this._interval * (this.maxFrames + 0.25)));
    if (performance.now() - this._times[this._head] < cap) {
      const s = this.stats;
      s.skipped++;
      if (++s.run > s.maxRun) s.maxRun = s.run;
      return true;
    }
    // time cap: run this frame anyway and stop waiting for the oldest fence
    this._pop();
    this.stats.capped++;
    this.stats.run = 0;
    if (++this._cappedRun >= MAX_CAPPED_RUN) {
      this.stats.disabled = 'fence did not signal for ' + MAX_CAPPED_RUN + ' frames';
      console.warn('[game] low latency mode switched off:', this.stats.disabled);
      this.setEnabled(false);
    }
    return false;
  }

  /** Call right after the frame's draw calls were issued (end of Game.render). */
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
  }
}
