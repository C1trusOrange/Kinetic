'use strict';
/**
 * Checks a KINETIC online server from this PC, the way the game reaches it (run it from the fps folder):
 *
 *   node server/check.js play.example.com                 name, HTTPS, the relay, WebSocket round trips
 *   node server/check.js 203.0.113.7:27500 --key KEY      ... and that KEY opens a room (closed again at once)
 *
 * The address is read exactly as the game's Join / Online server fields read it (src/net/ServerAddress.js).
 * Each failure says what usually causes it. Exit code 0 = everything works. Needs Node.js 22 or newer.
 */
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const dns = require('node:dns').promises;

const TIMEOUT_MS = 8000;

/** src/net/ServerAddress.js is an ES module without imports: loaded from its source, so the rules are the game's. */
async function addressRules() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'net', 'ServerAddress.js'), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
}

const ok = text => console.log(`  ok    ${text}`);
const bad = text => console.log(`  FAIL  ${text}`);
const note = text => console.log(`        ${text}`);

/** What a failed fetch / connect most likely means, for a person. */
function explain(err, port) {
  const cause = (err && err.cause) || err || {};
  const code = cause.code || (err && err.name) || '';
  if (code === 'ECONNREFUSED') return `nothing listens on port ${port} there: the relay is not running (on the server: systemctl status kinetic-relay), or it uses another port`;
  if (code === 'TimeoutError' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'AbortError') {
    return `no answer on port ${port}: a firewall drops it (the hosting panel's firewall, e.g. Hostinger VPS > Security > Firewall, or ufw on the server), or the address is wrong`;
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'the name does not resolve';
  if (/CERT|SSL|TLS|SELF_SIGNED|ALTNAME|UNABLE_TO_VERIFY/i.test(code)) {
    return `no valid HTTPS certificate (${code}): Caddy could not get one yet. Does the domain's A record point at the server? On the server: journalctl -u caddy`;
  }
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return `the connection was cut (${code}): something between here and the server (or another program on that port) does not speak HTTP${port === 443 ? 'S' : ''}`;
  return `${code || 'error'}: ${(cause && cause.message) || (err && err.message) || err}`;
}

function parseArgs(argv) {
  const out = { address: '', key: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return { help: true };
    if (a === '--key') {
      out.key = argv[++i] || '';
      if (!out.key) return { error: '--key needs the host key' };
    } else if (!out.address && !a.startsWith('-')) out.address = a;
    else return { error: `unexpected argument ${a}` };
  }
  if (!out.address) return { error: 'which server? (the address players type, e.g. play.example.com or 203.0.113.7:27500)' };
  return out;
}

/** A WebSocket helper: resolves with the socket once open; `next(t)` waits for the next control message of type t. */
function openSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const queue = [];
    const waiters = [];
    const timer = setTimeout(() => { reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })); try { ws.close(); } catch { /* closed */ } }, TIMEOUT_MS);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve({
        ws,
        send: obj => ws.send(JSON.stringify(obj)),
        next: () => new Promise((res, rej) => {
          if (queue.length) return res(queue.shift());
          const t = setTimeout(() => rej(new Error('no answer')), TIMEOUT_MS);
          waiters.push(m => { clearTimeout(t); res(m); });
        }),
      });
    };
    ws.onmessage = ev => {
      if (typeof ev.data !== 'string') return;
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (waiters.length) waiters.shift()(m);
      else queue.push(m);
    };
    ws.onerror = ev => { clearTimeout(timer); reject((ev && ev.error) || new Error('WebSocket error')); };
    ws.onclose = ev => { clearTimeout(timer); reject(new Error(`closed (${ev.code})`)); };
  });
}

async function main(argv) {
  const o = parseArgs(argv);
  if (o.help || o.error) {
    if (o.error) console.error(o.error + '\n');
    console.log('Usage: node server/check.js <server address> [--key HOSTKEY]');
    return o.help ? 0 : 2;
  }
  const { normalizeServer, displayServer } = await addressRules();
  const base = normalizeServer(o.address);
  if (!base) {
    bad(`"${o.address}" is not a server address`);
    return 2;
  }
  const u = new URL(base);
  const secure = u.protocol === 'https:';
  const port = Number(u.port) || (secure ? 443 : 80);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  console.log(`KINETIC server check: ${displayServer(base)}  (${secure ? 'HTTPS + wss' : 'plain http + ws'}, port ${port})`);
  let failed = 0;

  if (!net.isIP(host)) {
    try {
      const found = await dns.lookup(host, { all: true });
      ok(`name: ${host} -> ${found.map(a => a.address).join(', ')}`);
    } catch (err) {
      bad(`name: ${host} does not resolve (${err.code}). Add an A record for it pointing at the server's IP, then wait a few minutes.`);
      return 1;
    }
  }

  // the relay over HTTP(S): GET /api/rooms, as the game's room list does
  const t0 = performance.now();
  let data = null;
  try {
    const r = await fetch(base + '/api/rooms', { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'cache-control': 'no-store' } });
    const ms = Math.round(performance.now() - t0);
    const text = await r.text();
    try { data = JSON.parse(text); } catch { data = null; }
    if (r.ok && data && data.relay) {
      ok(`relay ${data.relay} answers (${ms} ms)${secure ? ', valid HTTPS certificate' : ''}; rooms ${data.listed === false ? 'unlisted: players join by room code' : `listed (${(data.rooms || []).length} open)`}`);
    } else {
      failed++;
      if (r.status === 502 || r.status === 503 || r.status === 504) bad(`HTTP ${r.status}: the web server answers but cannot reach the relay. On the server: systemctl status kinetic-relay`);
      else if (r.status === 404) bad(`HTTP 404: something answers there, but not the KINETIC relay (another port? another site on this name?)`);
      else bad(`HTTP ${r.status}: not the KINETIC relay (${text.slice(0, 80).replace(/\s+/g, ' ')})`);
    }
  } catch (err) {
    bad(`HTTP${secure ? 'S' : ''}: ${explain(err, port)}`);
    return 1;
  }

  // the game's own connection: a WebSocket on /ws, control pings, and with --key the host request
  if (typeof WebSocket !== 'function') {
    note(`(WebSocket check skipped: this Node.js ${process.version} has no WebSocket; Node 22+ has)`);
  } else {
    const url = base.replace(/^http/i, 'ws') + '/ws';
    let s = null;
    try {
      s = await openSocket(url);
      const rtts = [];
      for (let i = 0; i < 5; i++) {
        const t = performance.now();
        s.send({ t: 'ping', c: i });
        const m = await s.next();
        if (m.t === 'pong') rtts.push(performance.now() - t);
      }
      rtts.sort((a, b) => a - b);
      ok(`WebSocket ${url}: round trip ${Math.round(rtts[0])} ms (median ${Math.round(rtts[rtts.length >> 1])} ms of ${rtts.length})`);
      if (rtts[0] > 150) note('That is a long way: matches will feel laggy. A server closer to the players helps.');
      if (o.key) {
        s.send({ t: 'host', name: 'server check', max: 2, public: false, key: o.key });
        const m = await s.next();
        if (m.t === 'hosted') {
          s.send({ t: 'leave' });
          ok(`host key: accepted (room ${m.code} opened and closed again)`);
        } else if (m.t === 'error' && m.reason === 'host-key') {
          failed++;
          bad('host key: refused. Copy it again from the installer\'s output (on the server: cat /etc/kinetic-relay/host-key)');
        } else {
          failed++;
          bad(`host key: the server said ${m.reason || m.t}${m.reason === 'rate-limited' ? ' (too many tries: wait a minute)' : ''}`);
        }
      }
    } catch (err) {
      failed++;
      bad(`WebSocket ${url}: ${explain(err, port)}`);
    } finally {
      if (s) try { s.ws.close(1000); } catch { /* closed */ }
    }
  }

  if (failed) {
    console.log(`\n${failed} problem(s): see above.`);
    return 1;
  }
  console.log(`\nAll good. In KINETIC: Multiplayer > Host a game > Online server, address ${displayServer(base)}${o.key ? ' and that host key' : ' and the host key'}.`);
  return 0;
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; }, err => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
