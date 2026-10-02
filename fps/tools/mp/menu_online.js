// Menu test: hosting on an online server through the Multiplayer screens (src/ui/NetMenu.js), clicked like a player.
// Runs in the browser version with a stand-in for the desktop app's preload (window.kineticDesktop: the online option
// is desktop-only) against the Node relay set up as server/install.sh sets one up (host key, rooms unlisted, no
// LAN info). tools/mp/run_all.sh (suite "menu") starts it from run_mp.py's --wait expression:
//   index.html?srv={server}&key=<host key>   ->   window.__MENU__ (checked by tools/mp/checks/menu.py)
import { PROTOCOL_VERSION } from '/src/net/protocol.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** A stranger's join request straight to the relay (the game's version): the reply ('joined' or the error reason). */
function tryJoin(srv, code) {
  return new Promise(resolve => {
    const ws = new WebSocket(`ws://${srv}/ws`);
    const timer = setTimeout(() => { ws.close(); resolve('timeout'); }, 5000);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', v: PROTOCOL_VERSION, code, name: 'Stranger' }));
    ws.onmessage = ev => {
      clearTimeout(timer);
      const m = JSON.parse(ev.data);
      ws.close();
      resolve(m.t === 'error' ? m.reason : m.t);
    };
    ws.onerror = () => { clearTimeout(timer); resolve('error'); };
  });
}

async function until(fn, what, ms = 15000) {
  const t0 = performance.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (performance.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

export async function run() {
  const out = { ok: false, steps: {} };
  const p = new URLSearchParams(location.search);
  const srv = p.get('srv');
  const key = p.get('key');
  const g = await until(() => window.__GAME__ && window.__GAME__.menu && window.__GAME__.menu.screen === 'main' && window.__GAME__, 'the main menu', 60000);
  const m = g.menu, nm = m.net, s = g.settings, root = m.root;
  let started = 0;
  window.kineticDesktop = {
    isDesktop: true, version: 'menu-test', defaultServer: '',
    async startServer() { started++; throw new Error('the built-in server must not start when hosting online'); },
    async stopServer() {},
    async serverStatus() { return { running: false, port: 0, ips: [], urls: [] }; },
  };
  const click = sel => {
    const el = root.querySelector(sel);
    if (!el) throw new Error(`no ${sel}`);
    el.click();
  };
  const shown = el => !!el && el.style.display !== 'none';
  try {
    click('[data-act="mp-hub"]');
    out.steps.hub = { screen: m.screen, where: shown(m.r.mpwhere), online: shown(m.r.mponline) };
    click('[data-act="mp-hoston"][data-on="online"]');
    out.steps.switched = { online: shown(m.r.mponline), setting: s.get('mpHostOn'), text: m.r.mphostp.textContent };

    // no address: the card says so and the match setup does not open
    nm.el.osrv.value = '';
    click('[data-act="mp-host"]');
    out.steps.noAddr = { screen: m.screen, err: m.r.mphosterr.textContent };

    // a wrong key, then none: back on the hub with the reason (nothing started on this PC)
    const attempt = async (k, label) => {
      nm.el.osrv.value = srv;
      nm.el.okey.value = k;
      m.r.mpmsg.textContent = '';
      click('[data-act="mp-host"]');
      const setup = m.screen;
      click('[data-act="deploy"]');
      await until(() => m.screen === 'mp' && m.r.mpmsg.textContent, label);
      return { setup, msg: m.r.mpmsg.textContent };
    };
    out.steps.wrongKey = await attempt('wrong-key', 'the wrong-key refusal');
    out.steps.noKey = await attempt('', 'the no-key refusal');

    // the right key: the room opens on the online server
    nm.el.okey.value = '  ' + key + ' ';
    click('[data-act="mp-host"]');
    click('[data-act="deploy"]');
    await until(() => m.screen === 'lobby' && g.net.room && g.net.room.code, 'the lobby');
    await sleep(300);
    out.steps.lobby = { server: g.net.server, online: g.net.room.online, code: g.net.room.code, addr: m.r.lbaddr.textContent, role: g.net.role };
    out.steps.saved = { server: s.get('mpServer'), key: s.get('mpHostKey') === key, hostOn: s.get('mpHostOn') };
    // Lock room: the relay refuses new players; Unlock lets them in again
    const lockBtn = m.r.lblock;
    out.steps.lockShown = shown(lockBtn) && lockBtn.textContent.trim();
    click('[data-act="mp-lock"]');
    await sleep(300);
    out.steps.locked = { flag: g.net.room.locked, label: lockBtn.textContent.trim(), addr: m.r.lbaddr.textContent, stranger: await tryJoin(srv, g.net.room.code) };
    click('[data-act="mp-lock"]');
    await sleep(300);
    out.steps.unlocked = { flag: g.net.room.locked, label: lockBtn.textContent.trim() };
    click('[data-act="mp-leave"]');
    await until(() => m.screen === 'mp' && g.net.role === 'offline', 'the hub after leaving');
    out.steps.left = { screen: m.screen, msg: m.r.mpmsg.textContent };
    out.steps.list = await g.net.listRooms(srv);
    out.started = started;

    // back to this PC
    click('[data-act="mp-hoston"][data-on="pc"]');
    out.steps.back = { online: shown(m.r.mponline), setting: s.get('mpHostOn') };
    out.ok = true;
  } catch (err) {
    out.error = String((err && err.stack) || err);
  } finally {
    delete window.kineticDesktop;
  }
  return out;
}
