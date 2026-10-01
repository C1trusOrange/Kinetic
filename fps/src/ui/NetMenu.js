/**
 * Multiplayer screens: the hub (name, host, join by address + room code, open rooms), the lobby (room code, address
 * for friends, players, ready / start) and the online variants of the pause and end screens. Menu.js delegates to it
 * (mp-* actions, Esc, setup in host mode).
 *
 * In the desktop app hosting starts the built-in server (desktop/relay.js, via window.kineticDesktop) and friends
 * connect to this PC's address; in a browser the page's own server (tools/serve.py) is used.
 */
import { esc, hexOf } from './dom.js';
import { ICON } from './Icons.js';
import { modeName } from './ModeHUD.js';
import { normalizeCode, isValidCode, CODE_ALPHABET } from '../net/protocol.js';
import { normalizeServer, DEFAULT_PORT } from '../net/NetSession.js';
import { sanitizeName } from '../net/Teams.js';
import { TEAM_COLORS, TEAM_NAMES, isTeamMode } from '../core/constants.js';

const JOIN_ERRORS = {
  'no-such-room': 'No room with that code on this server.',
  'room-full': 'That room is full.',
  'room-locked': 'The host has locked the room.',
  'version-mismatch': 'You and the host run different versions of KINETIC.',
  build: 'The host has a different version of KINETIC. Update so you both run the same one.',
  kicked: 'The host removed you from this room.',
  'cannot-connect': "Can't reach that address. Check the IP and port, that the host is hosting, and the host's firewall.",
  timeout: "The host didn't answer.",
  'bad-code': 'Room codes are 4 letters.',
  'no-server': "Enter the host's address first.",
  busy: 'Already connecting.',
  'rate-limited': 'Too many attempts. Wait a minute and try again.',
  'server-full': 'That server is full.',
};
const CLOSED_MESSAGES = {
  'host-left': 'The host ended the game.',
  kicked: 'The host removed you from the room.',
  replaced: 'This game was opened in another window.',
  build: 'The host has a different version of KINETIC.',
  'reconnect-failed': 'Lost the connection to the host.',
  failed: 'The connection was lost.',
};
const ROOMS_REFRESH_MS = 2000;

export class NetMenu {
  /** @param {import('./Menu.js').Menu} menu */
  constructor(menu) {
    this.menu = menu;
    this.game = menu.game;
    /** 'solo' (Play) | 'host' (setup creates a room) | 'edit' (setup changes the room's rules) */
    this.setupMode = 'solo';
    this._busy = false;
    this._roomsTimer = 0;
    this._hostAddr = '';
    this._lastRooms = '';
  }

  get net() {
    return this.game.net;
  }

  /** Markup of the multiplayer screens (appended to the menu root). */
  html() {
    const desktop = this._desktopApi();
    return `
    <section class="k-screen s-mp" data-screen="mp">
      <header class="k-head"><button class="k-back" data-act="mp-back">${ICON.back}<span>Back</span></button><div><h2>Multiplayer</h2><small>Play with friends on your network</small></div></header>
      <div class="mp-body">
        <div class="mp-name"><div class="opt-h">Your name</div><input class="k-text" type="text" data-mp="name" maxlength="16" spellcheck="false" autocomplete="off"></div>
        <div class="mp-cards">
          <div class="mp-card k-cut">
            <div class="k-sec">Host a game</div>
            <p class="mp-p">Your PC runs the match. Friends on the same network join with your address and the room code${desktop ? ' (over the internet: forward the port on your router)' : ''}.</p>
            <div class="mp-note" data-r="mphostnote"></div>
            <button class="k-btn primary" data-act="mp-host"><span class="lbl">Host a game</span><b>${ICON.arrow}</b></button>
          </div>
          <div class="mp-card k-cut">
            <div class="k-sec">Join a game</div>
            <div class="mp-field" data-r="mpsrvrow"><div class="opt-h">Host address</div><input class="k-text" type="text" data-mp="server" placeholder="192.168.1.23:${DEFAULT_PORT}" spellcheck="false" autocomplete="off"></div>
            <div class="mp-join"><div class="mp-field"><div class="opt-h">Room code</div><input class="k-text mp-code" type="text" data-mp="code" maxlength="4" placeholder="ABCD" spellcheck="false" autocomplete="off"></div>
              <button class="k-btn primary" data-act="mp-join"><span class="lbl">Join</span><b>${ICON.arrow}</b></button></div>
            <div class="mp-err" data-r="mperr"></div>
            <div class="k-sec mp-rooms-h">Open rooms</div>
            <div class="mp-rooms" data-r="mprooms"><div class="mp-empty">No open rooms found yet.</div></div>
          </div>
        </div>
        <div class="mp-msg" data-r="mpmsg"></div>
      </div>
    </section>
    <section class="k-screen s-lobby" data-screen="lobby">
      <header class="k-head"><button class="k-back" data-act="mp-leave">${ICON.back}<span>Leave</span></button><div><h2>Lobby</h2><small data-r="lbsub"></small></div></header>
      <div class="lb-body">
        <div class="lb-left k-cut">
          <div class="k-sec">Room code</div>
          <div class="lb-code" data-r="lbcode">····</div>
          <div class="lb-addr" data-r="lbaddr"></div>
          <div class="k-sec">Match</div>
          <div class="lb-rules" data-r="lbrules"></div>
          <button class="k-btn ghost" data-act="mp-edit" data-r="lbedit"><span class="lbl">Edit rules</span></button>
        </div>
        <div class="lb-right k-cut"><div class="k-sec">Players <output data-r="lbcount"></output></div><div class="lb-rows" data-r="lbrows"></div></div>
      </div>
      <footer class="k-foot"><div class="summary" data-r="lbstatus"></div>
        <button class="k-btn ghost" data-act="mp-leave"><span class="lbl" data-r="lbleave">Leave room</span></button>
        <button class="k-btn" data-act="mp-ready" data-r="lbready"><span class="lbl">Ready</span></button>
        <button class="k-btn primary big" data-act="mp-start" data-r="lbstart"><span class="lbl">Start match</span><b>${ICON.arrow}</b></button>
      </footer>
    </section>`;
  }

  /** After the menu DOM exists: element refs and listeners. */
  bind() {
    const root = this.menu.root;
    this.el = {};
    for (const n of root.querySelectorAll('[data-mp]')) this.el[n.dataset.mp] = n;
    const s = this.game.settings;
    this.el.name.value = s.get('playerName') || '';
    this.el.server.value = s.get('mpLastServer') || '';
    this.el.name.addEventListener('change', () => s.set('playerName', sanitizeName(this.el.name.value)));
    this.el.code.addEventListener('input', () => {
      const v = normalizeCode(this.el.code.value).split('').filter(c => CODE_ALPHABET.includes(c)).join('').slice(0, 4);
      if (v !== this.el.code.value) this.el.code.value = v;
    });
    this.el.server.addEventListener('change', () => this._refreshRooms(true));
    for (const inp of [this.el.code, this.el.server]) {
      inp.addEventListener('keydown', e => {
        if (e.code === 'Enter') { e.preventDefault(); this._join(); }
      });
    }
    const ev = this.game.events;
    ev.on('net:lobby', () => this._onLobby());
    ev.on('net:phase', () => this._onLobby());
    this._syncHubMode();
  }

  _desktopApi() {
    return typeof window !== 'undefined' && window.kineticDesktop && window.kineticDesktop.isDesktop ? window.kineticDesktop : null;
  }

  /** The browser version joins on the page's own server; the desktop app needs the host's address. */
  _syncHubMode() {
    const r = this.menu.r;
    const pageServer = this.net.pageServer;
    if (r.mpsrvrow) r.mpsrvrow.style.display = pageServer ? 'none' : '';
    if (r.mphostnote) {
      r.mphostnote.textContent = this._desktopApi() ? 'Starts the KINETIC server on this PC (Windows may ask to allow it on your network).'
        : pageServer ? '' : 'Hosting needs the desktop app or host-lan.bat.';
    }
  }

  // ------------------------------------------------------------------ Menu hooks

  /** mp-* buttons. @returns {boolean} handled */
  onClick(act) {
    const net = this.net, g = this.game;
    switch (act) {
      case 'mp-hub': this.showHub(); return true;
      case 'mp-back': this.menu.showMain(); return true;
      case 'mp-host':
        this._saveName();
        this.setupMode = 'host';
        this.menu._go('setup');
        return true;
      case 'mp-join': this._join(); return true;
      case 'mp-room': return true;
      case 'mp-leave': net.leave('left'); return true;
      case 'mp-ready': {
        const me = net.room && net.room.players ? net.room.players.find(p => p.peer === net.me.peer) : null;
        net.setReady(!(me && me.ready));
        return true;
      }
      case 'mp-start':
        if (net.isHost) net.start();   // synchronous inside the click: the host requests pointer lock
        return true;
      case 'mp-edit':
        if (net.isHost) { this.setupMode = 'edit'; this.menu._go('setup'); }
        return true;
      case 'mp-tolobby': if (net.isHost) net.toLobby(); return true;
      case 'mp-endall': if (net.isHost) net.endMatchForAll(); return true;
      default: return false;
    }
  }

  /** A room row's JOIN button (carries data-code). */
  onRoomClick(el) {
    const code = el && el.dataset.code;
    if (!code) return;
    this.el.code.value = code;
    this._join();
  }

  /** Esc on the multiplayer screens. @returns {boolean} handled */
  onKey(e) {
    if (e.code !== 'Escape') return false;
    const sc = this.menu.screen;
    if (sc === 'mp') { this.menu.showMain(); return true; }
    if (sc === 'setup' && this.setupMode !== 'solo') { this._backFromSetup(); return true; }
    return false;
  }

  /** Back from the setup screen in host / edit mode. @returns {boolean} handled */
  backFromSetup() {
    if (this.setupMode === 'solo') return false;
    this._backFromSetup();
    return true;
  }

  _backFromSetup() {
    if (this.setupMode === 'edit' && this.net.isHost) this.showLobby();
    else this.showHub();
  }

  /** Menu._go: per-screen setup. */
  onShow(name) {
    if (name === 'mp') this._startRooms();
    else this._stopRooms();
    const r = this.menu.r;
    if (name === 'setup' && r.deploylbl) {
      r.deploylbl.textContent = this.setupMode === 'host' ? 'Create room' : this.setupMode === 'edit' ? 'Apply' : 'Deploy';
    }
    if (name === 'lobby') this._fillLobby();
    if (name === 'main') this.setupMode = 'solo';
  }

  /** The setup screen's Deploy button in host / edit mode. */
  async createOrApply(cfg) {
    const net = this.net;
    if (this.setupMode === 'edit') {
      if (net.isHost) net.setConfig(cfg);
      this.showLobby();
      return;
    }
    if (this._busy) return;
    this._busy = true;
    this._setError('');
    const s = this.game.settings;
    try {
      let server = net.pageServer;
      const api = this._desktopApi();
      if (api && !server) {
        const info = await api.startServer({ port: s.get('mpPort') || DEFAULT_PORT });
        server = `http://127.0.0.1:${info.port}`;
        this._hostAddr = info.ips && info.ips.length ? `${info.ips[0]}:${info.port}` : `127.0.0.1:${info.port}`;
      } else this._hostAddr = '';
      if (!server) throw Object.assign(new Error('no server'), { code: 'no-server' });
      await net.hostRoom(cfg, {
        name: s.get('playerName'), public: s.get('mpPublic') !== false, maxPlayers: s.get('mpMaxPlayers'),
        code: s.get('mpLastCode') || null, server,
      });
      this.setupMode = 'solo';
      this.showLobby();
    } catch (err) {
      this.setupMode = 'solo';
      this.showHub({ message: this._hostError(err) });
    } finally {
      this._busy = false;
    }
  }

  _hostError(err) {
    const code = err && (err.code || err.reason);
    if (code === 'EADDRINUSE' || /in use/i.test(String(err && err.message))) return 'That port is already in use on this PC. Close the other program or pick another port.';
    if (code === 'no-server') return 'Hosting needs the desktop app (or host-lan.bat for the browser version).';
    if (code === 'cannot-connect') return "Couldn't start the server on this PC.";
    return `Couldn't create the room (${esc(String(code || (err && err.message) || 'error'))}).`;
  }

  async _join() {
    if (this._busy) return;
    const net = this.net, s = this.game.settings;
    this._saveName();
    const code = normalizeCode(this.el.code.value);
    if (!isValidCode(code)) { this._setError(JOIN_ERRORS['bad-code']); return; }
    let server = net.pageServer;
    if (!server) {
      server = normalizeServer(this.el.server.value);
      if (!server) { this._setError(JOIN_ERRORS['no-server']); return; }
      s.set('mpLastServer', this.el.server.value.trim());
    }
    this._busy = true;
    this._setError('Connecting…', true);
    try {
      await net.joinRoom(code, { name: s.get('playerName'), server });
      this._setError('');
      this.showLobby();
    } catch (err) {
      this._setError(JOIN_ERRORS[err && err.code] || `Couldn't join (${esc(String((err && err.code) || 'error'))}).`);
    } finally {
      this._busy = false;
    }
  }

  _saveName() {
    const s = this.game.settings;
    const name = sanitizeName(this.el.name.value || s.get('playerName'));
    this.el.name.value = name;
    s.set('playerName', name);
  }

  _setError(text, info = false) {
    const el = this.menu.r.mperr;
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('info', !!info);
  }

  // ------------------------------------------------------------------ screens

  /** The hub; `join` pre-fills a room code, `message` explains why we are here. */
  showHub({ join, message } = {}) {
    const m = this.menu;
    if (!m.built) m.init();
    m._origin = 'main';
    m._go('mp');
    this.el.name.value = this.game.settings.get('playerName') || '';
    if (join) this.el.code.value = join;
    m.r.mpmsg.textContent = message || '';
    m.r.mpmsg.style.display = message ? '' : 'none';
    this._setError('');
    this._syncHubMode();
  }

  showLobby() {
    const m = this.menu;
    if (!m.built) m.init();
    m._origin = 'lobby';
    m._go('lobby');
  }

  /** NetSession ended (Game.netSessionEnded): back to the hub with the reason. */
  onSessionEnded(reason, quiet) {
    this._stopRooms();
    if (this._desktopApi() && this._hostAddr) {
      this._hostAddr = '';
      this._desktopApi().stopServer().catch(() => {});
    }
    if (quiet) return;
    this.showHub({ message: CLOSED_MESSAGES[reason] || '' });
  }

  _onLobby() {
    const g = this.game, net = this.net;
    if (this.menu.screen === 'lobby') this._fillLobby();
    // the host's loading overlay: who is still loading
    if (net.isHost && net.phase === 'loading' && g.state === 'loading' && net.host && net.host.hostLoaded && net.room) {
      const rows = (net.room.players || []).filter(p => !p.host && p.connected);
      const waiting = rows.filter(p => !p.loaded);
      const label = waiting.length
        ? `Waiting for players ${rows.length - waiting.length}/${rows.length} · ${waiting.map(p => `${p.name} ${Math.round(p.progress * 100)}%${p.vis === 'hidden' ? ' (in background)' : ''}`).join(', ')}`
        : 'Starting';
      this.menu.showLoading(label, 1);
    }
  }

  _fillLobby() {
    const net = this.net, r = this.menu.r, room = net.room;
    if (!room) return;
    const cfg = room.cfg || {};
    const def = (this.game.maps || []).find(d => d.id === cfg.mapId);
    r.lbcode.textContent = room.code || '····';
    r.lbsub.textContent = `Room ${room.code || ''} · ${def ? def.name : cfg.mapId || ''} · ${cfg.mode ? modeName(cfg.mode) : ''}`;
    // where friends connect
    let addr = '';
    if (net.isHost) {
      if (this._hostAddr) addr = `Friends: Multiplayer → Join, address <b>${esc(this._hostAddr)}</b>, code <b>${esc(room.code)}</b>`;
      else if (room.urls && room.urls.length) addr = `Friends: open <b>${esc(room.urls[0])}</b> and enter the code`;
      else addr = 'Friends join with this code.';
    } else {
      addr = `Connected to <b>${esc((net.server || '').replace(/^https?:\/\//, ''))}</b>`;
    }
    r.lbaddr.innerHTML = addr;
    const lim = cfg.mode === 'escalation' ? 'Finish the ladder' : cfg.scoreLimit ? `${cfg.scoreLimit} ${cfg.mode === 'koth' ? 'points' : 'kills'}` : 'No score limit';
    r.lbrules.innerHTML = [
      def ? esc(def.name) : esc(cfg.mapId || ''), cfg.mode ? esc(modeName(cfg.mode)) : '', esc(lim),
      cfg.timeLimit ? `${cfg.timeLimit} min` : 'No time limit', `${cfg.botCount | 0} bot${(cfg.botCount | 0) === 1 ? '' : 's'} · ${esc(cfg.difficulty || '')}`,
    ].filter(Boolean).map(t => `<div>${t}</div>`).join('');
    const players = room.players || [];
    r.lbcount.textContent = `${players.length}/${room.max || 8}`;
    const team = isTeamMode(cfg.mode);
    r.lbrows.innerHTML = players.map(p => {
      const color = team && p.team ? TEAM_COLORS[p.team] : p.color;
      const status = room.phase === 'loading' ? (p.loaded ? 'Loaded' : `Loading ${Math.round((p.progress || 0) * 100)}%${p.vis === 'hidden' ? ' (in background)' : ''}`)
        : room.phase === 'playing' || room.phase === 'ended' ? 'In match' : p.host ? 'Host' : p.ready ? 'Ready' : 'Not ready';
      const me = p.peer === net.me.peer;
      return `<div class="lb-row${me ? ' me' : ''}${p.connected === false ? ' off' : ''}">`
        + `<i class="lb-chip" style="background:${hexOf(color)}"></i><span class="lb-name">${esc(p.name)}${p.host ? ' <em>HOST</em>' : ''}${me ? ' <em>YOU</em>' : ''}</span>`
        + `${team && p.team ? `<span class="lb-team">${esc(TEAM_NAMES[p.team] || '')}</span>` : ''}`
        + `<span class="lb-st${p.ready || p.host ? ' ok' : ''}">${esc(status)}</span><span class="lb-ping">${p.host ? '' : `${p.ping | 0} ms`}</span></div>`;
    }).join('');
    const ready = players.filter(p => !p.host && p.ready).length;
    const clients = players.filter(p => !p.host).length;
    r.lbedit.style.display = net.isHost ? '' : 'none';
    r.lbstart.style.display = net.isHost ? '' : 'none';
    r.lbready.style.display = net.isClient ? '' : 'none';
    const mine = players.find(p => p.peer === net.me.peer);
    if (net.isClient) r.lbready.querySelector('.lbl').textContent = mine && mine.ready ? 'Not ready' : 'Ready';
    r.lbstatus.textContent = net.isHost
      ? (clients ? `${clients} friend${clients === 1 ? '' : 's'} in the room · ${ready} ready` : 'Waiting for friends to join')
      : room.phase === 'playing' || room.phase === 'loading' ? 'A match is running: you join the next one' : 'Waiting for the host to start';
    r.lbleave.textContent = net.isHost ? 'Close room' : 'Leave room';
  }

  _startRooms() {
    this._stopRooms();
    this._refreshRooms(true);
    this._roomsTimer = setInterval(() => this._refreshRooms(false), ROOMS_REFRESH_MS);
  }

  _stopRooms() {
    if (this._roomsTimer) clearInterval(this._roomsTimer);
    this._roomsTimer = 0;
  }

  async _refreshRooms(force) {
    const net = this.net, r = this.menu.r;
    const server = net.pageServer || normalizeServer(this.el && this.el.server ? this.el.server.value : '');
    if (!server) {
      r.mprooms.innerHTML = '<div class="mp-empty">Enter the host\'s address to see its rooms.</div>';
      this._lastRooms = '';
      return;
    }
    let rooms;
    try {
      rooms = await net.listRooms(server);
    } catch {
      if (force) r.mprooms.innerHTML = '<div class="mp-empty">No KINETIC server answers at that address.</div>';
      this._lastRooms = '';
      return;
    }
    const html = rooms.length ? rooms.map(room => {
      const meta = room.meta || {};
      const def = (this.game.maps || []).find(d => d.id === meta.map);
      return `<div class="mp-room"><span><b>${esc(room.name || meta.host || 'Game')}</b> · ${esc(def ? def.name : meta.map || '?')} · ${esc(meta.mode ? modeName(meta.mode) : '')} · ${room.players | 0}/${room.max | 0}${room.locked ? ' · locked' : ''}</span>`
        + `<button class="k-btn ghost mp-room-join" data-act="mp-room" data-code="${esc(room.code)}"${room.locked ? ' disabled' : ''}><span class="lbl">Join</span></button></div>`;
    }).join('') : '<div class="mp-empty">No open rooms on that server.</div>';
    if (html !== this._lastRooms) {
      this._lastRooms = html;
      r.mprooms.innerHTML = html;
    }
  }

  // ------------------------------------------------------------------ pause / end variants

  /** The pause screen as the online match menu (the match keeps running). */
  fillPause() {
    const r = this.menu.r, net = this.net;
    const online = net.online;
    if (r.pztitle) r.pztitle.textContent = online ? 'Match menu' : 'Paused';
    if (r.pzkicker) r.pzkicker.textContent = online ? 'The match keeps running' : 'Match in progress';
    if (r.pzrestart) r.pzrestart.style.display = online ? 'none' : '';
    if (r.pztolobby) r.pztolobby.style.display = online && net.isHost ? '' : 'none';
    if (r.pzendall) r.pzendall.style.display = online && net.isHost ? '' : 'none';
    if (r.quitlbl && !this.menu._quitArmed) r.quitlbl.textContent = online ? (net.isHost ? 'End the game for everyone' : 'Leave match') : 'Quit to menu';
    if (online && r.pzinfo && net.room) {
      const row = (l, v) => `<div><span>${l}</span><b>${v}</b></div>`;
      r.pzinfo.innerHTML += row('Room', esc(net.room.code || '')) + (net.isClient ? row('Ping', `${Math.round(net.ping)} ms`) : '');
    }
  }

  /** The end screen online: the host picks what happens next, clients follow. */
  fillEnd() {
    const r = this.menu.r, net = this.net;
    const online = net.online;
    if (r.endagain) {
      r.endagain.style.display = online && !net.isHost ? 'none' : '';
      const l = r.endagain.querySelector('.lbl');
      if (l) l.textContent = online ? 'Rematch' : 'Play again';
    }
    if (r.endtolobby) r.endtolobby.style.display = online && net.isHost ? '' : 'none';
    if (r.endwait) r.endwait.style.display = online && net.isClient ? '' : 'none';
    if (r.endmenu) {
      const l = r.endmenu.querySelector('.lbl');
      if (l) l.textContent = online ? (net.isHost ? 'Close room' : 'Leave room') : 'Main menu';
    }
  }
}
