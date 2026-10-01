/**
 * Transport: how a multiplayer session reaches its peers, independent of the medium. Phase 1 is
 * WsRelayTransport (one WebSocket to the relay in tools/netserver.py on the host PC, same address that
 * served the page). A later RtcTransport (WebRTC DataChannels, signalled through the relay's 'signal'
 * message, falling back to the relay) implements the same interface, so the game never talks to a
 * WebSocket directly.
 *
 * Model: the host is peer 0 and runs the authoritative game; clients are peers 1..254 and only talk to
 * the host. Binary packets are Uint8Arrays that start with [route, type] (see protocol.js); the send
 * methods fill in the route byte. Drain onMessage packets into your own queues and apply them once per
 * frame; never replay stale packets.
 *
 * Callbacks (assign functions; exceptions thrown by them are reported with console.error):
 *   onMessage(from, u8)    a binary packet. Host: from = the sender's peer id. Client: from = 0 (host).
 *                          `u8` is a fresh view of the received bytes (copy nothing unless you keep it).
 *   onPeerJoin(info)       host only: {peer, name, addr, rejoin}
 *   onPeerLeave(info)      host only: {peer, reason, reserved}. reserved = the slot is kept for a rejoin
 *                          with the peer's token; a later onPeerLeave with reason 'expired' ends it.
 *   onControl(msg)         every JSON message from the relay, after internal handling
 *   onStatus(state, info)  state changes (see `state`)
 *   onClose(info)          the session is over (no automatic retry follows):
 *                          {code, reason, text, wasClean}; reason is 'room-closed' (host left), 'kicked',
 *                          'replaced', 'slow', 'reconnect-failed', 'slot-lost' (kicked while reconnecting, or
 *                          the reserved slot expired), 'closed', ...
 *   onError(err)           relay error replies that no pending request consumed: {reason, re}
 */
export class Transport {
  constructor() {
    /** 'idle' | 'connecting' | 'open' | 'in-room' | 'reconnecting' | 'closed' */
    this.state = 'idle';
    /** 'none' | 'host' | 'client' */
    this.role = 'none';
    /** 0 for the host, 1..254 for clients, -1 outside a room */
    this.peerId = -1;
    /** Room code while in a room */
    this.code = '';
    this.onMessage = null;
    this.onPeerJoin = null;
    this.onPeerLeave = null;
    this.onControl = null;
    this.onStatus = null;
    this.onClose = null;
    this.onError = null;
  }

  get isHost() { return this.role === 'host'; }
  get isClient() { return this.role === 'client'; }
  get inRoom() { return this.state === 'in-room'; }

  /** Open the connection. @returns {Promise<void>} */
  connect() { return this._unsupported('connect'); }

  /**
   * Create a room and become its host (peer 0).
   * @param {{name?: string, max?: number, public?: boolean, code?: string, meta?: object}} [opts]
   * @returns {Promise<{code: string, peer: number, max: number}>}
   */
  host(opts) { return this._unsupported('host', opts); }

  /**
   * Join a room. `token` reclaims a previous slot; by default the token remembered for this code in this
   * tab is used (so a reloaded page gets its peer id back), '' joins as a new player. A token that is in
   * use on another connection takes that slot over (the other connection closes with 4002).
   * @returns {Promise<{code: string, peer: number, token: string, rejoin: boolean, room: object}>}
   */
  join(code, name, token) { return this._unsupported('join', code, name, token); }

  /** Leave the room (the host leaving closes it for everyone); the connection stays open. @returns {Promise<void>} */
  leave() { return this._unsupported('leave'); }

  /** Host: remove a peer (its connection closes with 4001). @returns {Promise<void>} */
  kick(peer, reason) { return this._unsupported('kick', peer, reason); }

  /** Host: refuse new joins (rejoins with a token still work). @returns {Promise<void>} */
  lock(locked) { return this._unsupported('lock', locked); }

  /** Host: small JSON object shown in room lists (map, mode, player counts). @returns {Promise<void>} */
  meta(obj) { return this._unsupported('meta', obj); }

  /** Open public rooms on this server. @returns {Promise<object[]>} */
  list() { return this._unsupported('list'); }

  /** Client: send a packet to the host. @returns {boolean} false if it was not sent */
  sendToHost(u8) { return this._unsupported('sendToHost', u8); }

  /** Host: send a packet to one client. @returns {boolean} */
  sendTo(peer, u8) { return this._unsupported('sendTo', peer, u8); }

  /** Host: send a packet to every client. @returns {boolean} */
  broadcast(u8) { return this._unsupported('broadcast', u8); }

  /** Send a raw JSON control message to the relay (e.g. {t:'signal', to, data}). @returns {boolean} */
  sendControl(obj) { return this._unsupported('sendControl', obj); }

  /** Leave the room (if any) and close the connection for good. */
  close(code, reason) { return this._unsupported('close', code, reason); }

  _unsupported(name) {
    throw new Error(`${this.constructor.name}.${name}() is not implemented`);
  }

  /** Call a user callback; a throwing handler must not break the transport. */
  _emit(name, a, b) {
    const fn = this[name];
    if (typeof fn !== 'function') return;
    try {
      fn(a, b);
    } catch (err) {
      console.error(`[net] ${name} handler threw:`, err);
    }
  }

  _setState(state, info) {
    if (this.state === state) return;
    this.state = state;
    this._emit('onStatus', state, info);
  }
}
