/**
 * Worker-driven tick for online sessions. A dedicated Worker's setInterval keeps running at ~60 Hz while the tab is
 * hidden or minimized (measured 56-63 Hz) - requestAnimationFrame stops and page timers drop to 1 Hz there. Every tick
 * calls game._hostTick(), which runs a simulation + network frame without rendering when the page's own frames are
 * missing (hidden tab, rAF stall) or - on the host - slower than ~55 Hz (a GPU-bound host still simulates and sends
 * snapshots at >= 60 Hz). It also wakes hidden-tab loading yields (utils.setHiddenTick -> nextTick()).
 * Installed only while online.
 */
import { NET } from './GameProtocol.js';

const WORKER_SRC = 'let iv=0;onmessage=e=>{clearInterval(iv);iv=0;if(e.data>0)iv=setInterval(()=>postMessage(0),e.data)};';

export class HostTicker {
  /** @param {object} game */
  constructor(game) {
    this.game = game;
    this.running = false;
    this.ticks = 0;
    this._worker = null;
    this._url = '';
    this._waiters = [];
    this._fallback = 0;
  }

  /** Start ticking every `periodMs` (default NET.HOST_TICK_MS). */
  start(periodMs = NET.HOST_TICK_MS) {
    if (this.running) return;
    this.running = true;
    try {
      this._url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
      this._worker = new Worker(this._url);
      this._worker.onmessage = () => this._tick();
      this._worker.postMessage(periodMs);
    } catch (err) {
      // no Workers (unusual): a page interval still covers visible stalls
      console.warn('[net] HostTicker: no Worker available, using a page timer', err && err.message);
      this._worker = null;
      this._fallback = setInterval(() => this._tick(), periodMs);
    }
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this._worker) {
      this._worker.postMessage(0);
      this._worker.terminate();
      this._worker = null;
    }
    if (this._url) URL.revokeObjectURL(this._url);
    this._url = '';
    if (this._fallback) clearInterval(this._fallback);
    this._fallback = 0;
    const w = this._waiters;
    this._waiters = [];
    for (const fn of w) fn();
  }

  /** Resolves on the next tick (immediately when stopped). @returns {Promise<void>} */
  nextTick() {
    if (!this.running) return Promise.resolve();
    return new Promise(resolve => this._waiters.push(resolve));
  }

  _tick() {
    this.ticks++;
    if (this._waiters.length) {
      const w = this._waiters;
      this._waiters = [];
      for (const fn of w) fn();
    }
    const g = this.game;
    if (g && typeof g._hostTick === 'function') {
      try {
        g._hostTick();
      } catch (err) {
        if (typeof g._reportFrameError === 'function') g._reportFrameError(err);
        else console.error('[net] host tick failed', err);
      }
    }
  }
}
