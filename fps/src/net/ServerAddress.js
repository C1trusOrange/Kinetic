/**
 * Server addresses as players type them, and back. Three kinds of server:
 *   - a PC on the network, or a port-forwarded one: '192.168.1.23', '192.168.1.23:27500', 'DESKTOP-ABC' -> plain
 *     http/ws on the relay's port (27500 when none is typed);
 *   - an online server behind HTTPS (server/install.sh --domain): a bare domain name, 'play.example.com' ->
 *     https/wss on port 443 (works from networks that only let web traffic out: hotels, schools);
 *   - anything with a scheme ('http://host:8000', 'wss://host/...') is taken as typed (its own default port).
 */

/** Port of the KINETIC relay (desktop/relay.js) when an address has none. */
export const DEFAULT_PORT = 27500;

/** Names that only exist on a home / office network: a PC there, not an online server. */
const LAN_SUFFIX_RE = /\.(?:local|lan|home|internal|localdomain|intranet|corp|home\.arpa)$/i;

/** True for a DNS name of the internet ('play.example.com'): not an IP literal, a PC name or a LAN-only name. */
function isDomainName(host) {
  if (!host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host)) return false;
  const tld = host.slice(host.lastIndexOf('.') + 1);
  return /^[a-z][a-z0-9-]*$/i.test(tld) && !LAN_SUFFIX_RE.test(host);
}

/**
 * A server address as typed -> its base URL ('http://host:port' or 'https://host[:port]'), or '' if it is not an
 * address. Bare hosts get `defaultPort` (domain names: HTTPS instead, see above).
 * @param {string} text @param {number} [defaultPort]
 */
export function normalizeServer(text, defaultPort = DEFAULT_PORT) {
  let s = String(text ?? '').trim();
  if (!s) return '';
  const typedScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
  if (!typedScheme) s = 'http://' + s;
  let u;
  try { u = new URL(s); } catch { return ''; }
  if (u.protocol === 'ws:') u.protocol = 'http:';
  else if (u.protocol === 'wss:') u.protocol = 'https:';
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  // a host name (PC names may have '_'), an IPv4 address or a bracketed IPv6 one (URL lower-cases names and
  // punycodes non-ASCII ones)
  if (!/^(?:\[[0-9a-f:.]+\]|[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?)*)$/.test(u.hostname)) return '';
  let proto = u.protocol;
  let port = u.port;   // '' when none was typed, or the scheme's own default (http://host:80)
  if (!typedScheme && !port) {
    if (isDomainName(u.hostname)) proto = 'https:';
    else port = String(defaultPort);
  }
  const host = u.hostname.includes(':') && !u.hostname.startsWith('[') ? `[${u.hostname}]` : u.hostname;
  return `${proto}//${host}${port ? ':' + port : ''}`;
}

/** A base URL for people: 'play.example.com' (HTTPS on 443), '1.2.3.4:27500', 'http://host' (plain on port 80). */
export function displayServer(base) {
  const s = String(base || '');
  const m = /^(https?):\/\/(.+)$/i.exec(s);
  if (!m) return s;
  const [, proto, rest] = m;
  if (proto.toLowerCase() === 'https') {
    // shown bare only when typing it bare leads back here (a domain name; an IP would get port 27500)
    return !rest.includes(':') && normalizeServer(rest) === `https://${rest}` ? rest : s;
  }
  return rest.includes(':') ? rest : s;
}
