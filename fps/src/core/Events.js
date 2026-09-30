/**
 * Tiny synchronous event bus. Handler exceptions are caught and reported via console.error
 * so one faulty listener cannot break the emitter (the error still reaches the test harness).
 */
export class Events {
  constructor() {
    this._map = new Map();
  }

  /** Subscribe. Returns an unsubscribe function. */
  on(name, fn) {
    let list = this._map.get(name);
    if (!list) { list = []; this._map.set(name, list); }
    list.push(fn);
    return () => this.off(name, fn);
  }

  once(name, fn) {
    const off = this.on(name, payload => { off(); fn(payload); });
    return off;
  }

  off(name, fn) {
    const list = this._map.get(name);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit(name, payload) {
    const list = this._map.get(name);
    if (!list || list.length === 0) return;
    for (const fn of list.slice()) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] listener for "${name}" threw:`, err);
      }
    }
  }
}
