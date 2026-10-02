#!/usr/bin/env bash
# KINETIC online server: installs the multiplayer relay (fps/desktop/relay.js) on a Debian or Ubuntu server (a
# Hostinger VPS or game-server plan, or any other) as a service that starts with the machine, protected by a host
# key, and opens its port. With --domain it also puts Caddy in front for HTTPS on port 443, so players on hotel or
# school Wi-Fi that only lets web traffic out can connect too. Step by step: README.md next to this file.
#
#   sudo bash install.sh                            relay on TCP 27500: players type <server IP>:27500
#   sudo bash install.sh --domain play.example.com  HTTPS on 443 through Caddy: players type play.example.com
#                        [--email you@example.com]  (the domain's A record must point at this server)
#   sudo bash install.sh --port 27600               another port (without --domain)
#   sudo bash install.sh --list-rooms               show open rooms in the game's Join screen (default: hidden;
#                                                   players join by room code)
#   sudo bash install.sh --new-key                  replace the host key
#   sudo bash install.sh --no-domain                back to the plain port (removes the KINETIC site from Caddy)
#   sudo bash install.sh --uninstall                remove the service, its files and the firewall rules it added
#   (--relay PATH: the relay.js to install; default: next to this file, or ../desktop/relay.js)
#
# Run it again to update the relay or change an option: the host key and the options of the last run are kept.
# It installs: /opt/kinetic-relay/relay.js, /etc/kinetic-relay/ (host-key, relay.env, install.conf; root only),
# /etc/systemd/system/kinetic-relay.service, Node.js if this machine has no Node 20+, and with --domain Caddy and
# /etc/caddy/Caddyfile. The relay runs as an unprivileged throwaway user (systemd DynamicUser) with no disk access.
set -euo pipefail
shopt -s inherit_errexit 2>/dev/null || true    # a failure inside $(...) stops the script too

ARGS=("$@")
ROOT="${KINETIC_TEST_ROOT:-}"      # tests only (tools/test_install.py): a directory standing in for /
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE=kinetic-relay
APP_DIR="$ROOT/opt/kinetic-relay"
CONF_DIR="$ROOT/etc/kinetic-relay"
CONF_FILE="$CONF_DIR/install.conf"
UNIT_FILE="$ROOT/etc/systemd/system/$SERVICE.service"
DROPIN_DIR="$ROOT/etc/systemd/system/$SERVICE.service.d"
CADDYFILE="$ROOT/etc/caddy/Caddyfile"
CADDY_BACKUP="$CADDYFILE.before-kinetic"
MARK='# KINETIC relay: written by install.sh (see the KINETIC server/README.md); run it again to change this'
DEFAULT_PORT=27500
NODE_MIN=20          # oldest Node.js the relay runs on
NODE_SETUP=24        # the NodeSource line installed when this machine has none (an LTS)
export DEBIAN_FRONTEND=noninteractive
APT=(apt-get -y -q -o DPkg::Lock::Timeout=180)

say()  { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
warn() { printf '\nWARNING: %s\n\n' "$*" >&2; }
die()  { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }

# ---------------------------------------------------------------------------------------------- options

OPT_PORT=""; OPT_DOMAIN=""; OPT_EMAIL=""; OPT_LIST=""; OPT_RELAY=""
OPT_NODOMAIN=0; OPT_NEWKEY=0; OPT_UNINSTALL=0
value() { if [ $# -lt 2 ] || [ -z "$2" ]; then die "$1 needs a value"; fi; printf '%s' "$2"; }
while [ $# -gt 0 ]; do
  case "$1" in
    --port) OPT_PORT="$(value "$@")"; shift 2 ;;
    --port=*) OPT_PORT="${1#*=}"; shift ;;
    --domain) OPT_DOMAIN="$(value "$@")"; shift 2 ;;
    --domain=*) OPT_DOMAIN="${1#*=}"; shift ;;
    --email) OPT_EMAIL="$(value "$@")"; shift 2 ;;
    --email=*) OPT_EMAIL="${1#*=}"; shift ;;
    --relay) OPT_RELAY="$(value "$@")"; shift 2 ;;
    --relay=*) OPT_RELAY="${1#*=}"; shift ;;
    --list-rooms) OPT_LIST=1; shift ;;
    --no-list-rooms) OPT_LIST=0; shift ;;
    --no-domain) OPT_NODOMAIN=1; shift ;;
    --new-key) OPT_NEWKEY=1; shift ;;
    --uninstall) OPT_UNINSTALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option '$1' (bash install.sh --help lists them)" ;;
  esac
done

RE_PORT='^[0-9]{1,5}$'
RE_DOMAIN='^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'
RE_EMAIL='^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'

# the previous run's options (key=value lines; read, never sourced)
P_PORT=""; P_DOMAIN=""; P_EMAIL=""; P_LIST=""; P_OPENED=""
if [ -f "$CONF_FILE" ]; then
  while IFS='=' read -r k v; do
    case "$k" in
      PORT) P_PORT="$v" ;;
      DOMAIN) P_DOMAIN="$v" ;;
      EMAIL) P_EMAIL="$v" ;;
      LIST) P_LIST="$v" ;;
      OPENED) P_OPENED="$v" ;;
    esac
  done < "$CONF_FILE"
fi

PORT="${OPT_PORT:-${P_PORT:-$DEFAULT_PORT}}"
DOMAIN="${OPT_DOMAIN:-$P_DOMAIN}"
if [ "$OPT_NODOMAIN" = 1 ]; then DOMAIN=""; fi
DOMAIN="$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')"
EMAIL="${OPT_EMAIL:-$P_EMAIL}"
LIST="${OPT_LIST:-${P_LIST:-0}}"

if ! [[ $PORT =~ $RE_PORT ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then die "--port must be a number from 1 to 65535 (got '$PORT')"; fi
if [ -n "$DOMAIN" ] && ! [[ $DOMAIN =~ $RE_DOMAIN ]]; then die "--domain must be a domain name like play.example.com (got '$DOMAIN')"; fi
if [ -n "$EMAIL" ] && ! [[ $EMAIL =~ $RE_EMAIL ]]; then die "--email must be an email address (got '$EMAIL')"; fi
if [ -n "$OPT_DOMAIN" ] && [ "$OPT_NODOMAIN" = 1 ]; then die "--domain and --no-domain together make no sense"; fi
if [ -n "$DOMAIN" ] && { [ "$PORT" = 80 ] || [ "$PORT" = 443 ]; }; then
  # Caddy owns 80 and 443; the relay listens behind it on 127.0.0.1
  if [ -n "$OPT_PORT" ]; then die "with --domain, Caddy takes ports 80 and 443: give the relay another --port (default $DEFAULT_PORT)"; fi
  PORT=$DEFAULT_PORT
fi
case "$LIST" in 0|1) ;; *) LIST=0 ;; esac

# ---------------------------------------------------------------------------------------------- helpers

# the process listening on TCP port $1 ('' if none)
port_owner() {
  ss -Hltnp "sport = :$1" 2>/dev/null | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | sed -n '1p' || true
}

# this server's IPv4 toward the internet (on a VPS: its public address)
public_ip() {
  ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | sed -n '1p' || true
}

is_private_ip() {
  case "$1" in 10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*|100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*) return 0 ;; esac
  return 1
}

# 24 characters of a readable alphabet (no 0/O, 1/l/I): ~139 bits
gen_key() {
  local k
  k="$(LC_ALL=C tr -dc 'A-HJ-NP-Za-km-z2-9' < /dev/urandom | head -c 24 || true)"
  if [ "${#k}" -ne 24 ]; then die "could not generate a host key"; fi
  printf '%s\n' "$k"
}

node_major() {
  if [ ! -x "$1" ]; then echo 0; return; fi
  "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

# (greps below read here-strings, not pipes: with pipefail, `cmd | grep -q` can fail when grep stops reading early)

# the firewall in use on this machine: ufw | firewalld | none
fw_kind() {
  local st=""
  if command -v ufw >/dev/null 2>&1; then st="$(ufw status 2>/dev/null || true)"; fi
  if grep -q '^Status: active' <<< "$st"; then echo ufw; return 0; fi
  if command -v firewall-cmd >/dev/null 2>&1 && [ "$(firewall-cmd --state 2>/dev/null || true)" = running ]; then echo firewalld; return 0; fi
  echo none
}

# open rule $1 (e.g. 27500/tcp); prints it when this call added it (a rule that was there already is not ours)
fw_open() {
  local st
  case "$FW" in
    ufw)
      st="$(ufw status 2>/dev/null || true)"
      if grep -qE "^$1[[:space:]]+ALLOW" <<< "$st"; then return 0; fi
      if ! ufw allow "$1" comment 'KINETIC relay' >/dev/null; then warn "ufw could not open $1: open it yourself (ufw allow $1)"; return 0; fi
      printf '%s ' "$1" ;;
    firewalld)
      if firewall-cmd --query-port="$1" >/dev/null 2>&1; then return 0; fi
      if ! firewall-cmd --quiet --permanent --add-port="$1"; then warn "firewalld could not open $1: open it yourself"; return 0; fi
      firewall-cmd --quiet --reload || true
      printf '%s ' "$1" ;;
  esac
}

fw_close() {
  case "$FW" in
    ufw) ufw --force delete allow "$1" >/dev/null 2>&1 || true ;;
    firewalld) firewall-cmd --quiet --permanent --remove-port="$1" >/dev/null 2>&1 || true; firewall-cmd --quiet --reload >/dev/null 2>&1 || true ;;
  esac
}

# the stock /etc/caddy/Caddyfile of the caddy package (a welcome page on :80), i.e. nothing of the owner's in it
caddyfile_is_stock() {
  local body
  body="$(grep -vE '^[[:space:]]*(#|$)' "$CADDYFILE" | tr -d '[:space:]' || true)"
  [ "$body" = ':80{root*/usr/share/caddyfile_server}' ] || [ -z "$body" ]
}

remove_caddy_site() {
  if [ ! -f "$CADDYFILE" ] || ! grep -qF "$MARK" "$CADDYFILE"; then return 0; fi
  if [ -f "$CADDY_BACKUP" ]; then mv -f "$CADDY_BACKUP" "$CADDYFILE"; else rm -f "$CADDYFILE"; fi
  # Caddy was there for KINETIC only: with its own file back it would just serve a welcome page
  systemctl disable --now caddy >/dev/null 2>&1 || true
  say "Removed the KINETIC site from Caddy and stopped Caddy."
}

save_conf() {
  mkdir -p "$CONF_DIR"
  (umask 077; printf 'PORT=%s\nDOMAIN=%s\nEMAIL=%s\nLIST=%s\nOPENED=%s\n' "$PORT" "$DOMAIN" "$EMAIL" "$LIST" "$1" > "$CONF_FILE")
}

wait_http() {   # $1 = URL, $2 = tries, $3 = seconds between tries
  local i
  if [ -n "$ROOT" ]; then return 0; fi    # tests: nothing is really running
  for i in $(seq 1 "$2"); do
    if "$NODE_BIN" -e "fetch(process.argv[1], { signal: AbortSignal.timeout(4000) }).then(r => r.json()).then(j => process.exit(j && j.relay ? 0 : 1), () => process.exit(1))" "$1" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$3"
  done
  return 1
}

# ---------------------------------------------------------------------------------------------- checks

if [ "$(id -u)" != 0 ]; then die "run it as root: sudo bash $0 ${ARGS[*]:-}"; fi

OS_ID=""; OS_LIKE=""; OS_NAME="this system"
if [ -r "$ROOT/etc/os-release" ]; then
  OS_ID="$(sed -n 's/^ID=//p' "$ROOT/etc/os-release" | tr -d '"')"
  OS_LIKE="$(sed -n 's/^ID_LIKE=//p' "$ROOT/etc/os-release" | tr -d '"')"
  OS_NAME="$(sed -n 's/^PRETTY_NAME=//p' "$ROOT/etc/os-release" | tr -d '"')"
fi
case " $OS_ID $OS_LIKE " in
  *" debian "*|*" ubuntu "*) ;;
  *) die "this installer is for Debian or Ubuntu (this is: ${OS_NAME:-unknown}). On another Linux run the relay by hand:
       node relay.js --port $DEFAULT_PORT --host-key-file /path/to/key --no-room-list --no-lan-info   (see README.md)" ;;
esac
command -v apt-get >/dev/null 2>&1 || die "apt-get is missing"
command -v systemctl >/dev/null 2>&1 || die "systemd is missing (systemctl): the relay runs as a systemd service"

# ---------------------------------------------------------------------------------------------- uninstall

if [ "$OPT_UNINSTALL" = 1 ]; then
  step "Removing the KINETIC relay"
  systemctl disable --now "$SERVICE" >/dev/null 2>&1 || true
  rm -f "$UNIT_FILE"
  rm -rf "$DROPIN_DIR"
  systemctl daemon-reload >/dev/null 2>&1 || true
  rm -rf "$APP_DIR"
  remove_caddy_site
  FW="$(fw_kind)"
  for rule in $P_OPENED; do fw_close "$rule"; say "Closed $rule in $FW."; done
  rm -rf "$CONF_DIR"
  say "The KINETIC relay is removed (Node.js and Caddy stay installed; apt-get remove nodejs caddy removes them too)."
  exit 0
fi

# ---------------------------------------------------------------------------------------------- preflight

RELAY_SRC="$OPT_RELAY"
if [ -z "$RELAY_SRC" ]; then
  for c in "$HERE/relay.js" "$HERE/../desktop/relay.js"; do
    if [ -f "$c" ]; then RELAY_SRC="$c"; break; fi
  done
fi
if [ -z "$RELAY_SRC" ] || [ ! -f "$RELAY_SRC" ]; then
  die "relay.js not found: put fps/desktop/relay.js next to install.sh (server/deploy.js does), or pass --relay PATH"
fi
grep -q 'KINETIC multiplayer relay' "$RELAY_SRC" || die "$RELAY_SRC is not the KINETIC relay"
UNIT_SRC="$HERE/kinetic-relay.service"
[ -f "$UNIT_SRC" ] || die "kinetic-relay.service not found next to install.sh"

# nothing is changed before every check passed: a port another program holds stops the run here
RUNNING=0
if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then RUNNING=1; fi
owner="$(port_owner "$PORT")"
if [ -n "$owner" ] && ! { [ "$RUNNING" = 1 ] && [ "$owner" = node ] && [ "$PORT" = "${P_PORT:-$DEFAULT_PORT}" ]; }; then
  die "port $PORT is already in use by '$owner'. Pick another one with --port."
fi
if [ -n "$DOMAIN" ]; then
  for p in 80 443; do
    owner="$(port_owner "$p")"
    if [ "$RUNNING" = 1 ] && [ "$owner" = node ] && [ "$p" = "$P_PORT" ]; then owner=""; fi   # our relay, about to move
    if [ -n "$owner" ] && [ "$owner" != caddy ]; then
      die "port $p is in use by '$owner' (a web server or a hosting panel?), and HTTPS through Caddy needs ports 80 and 443.
       Run without --domain instead (players then type this server's IP and port $PORT)."
    fi
  done
  if [ -f "$CADDYFILE" ] && ! grep -qF "$MARK" "$CADDYFILE" && ! caddyfile_is_stock; then
    die "$CADDYFILE already serves other sites, and the installer leaves it alone. Run without --domain instead
       (players then type this server's IP and port $PORT)."
  fi
fi

say "KINETIC online server setup on ${OS_NAME}"
if [ -n "$DOMAIN" ]; then say "  HTTPS: https://$DOMAIN (Caddy on ports 80/443 -> relay on 127.0.0.1:$PORT)"
else say "  plain: TCP port $PORT"; fi

# ---------------------------------------------------------------------------------------------- Node.js

NODE_BIN=""
for c in /usr/bin/node /usr/local/bin/node; do
  if [ "$(node_major "$ROOT$c")" -ge "$NODE_MIN" ]; then NODE_BIN="$ROOT$c"; break; fi
done
if [ -z "$NODE_BIN" ]; then
  step "Installing Node.js"
  "${APT[@]}" update
  cand="$(apt-cache policy nodejs 2>/dev/null | sed -n 's/^ *Candidate: *//p' | sed -n '1p' || true)"
  cand="${cand#*:}"         # an epoch ("1:20.19...") is not the version
  cand="${cand%%.*}"
  if [[ $cand =~ ^[0-9]+$ ]] && [ "$cand" -ge "$NODE_MIN" ]; then
    "${APT[@]}" install nodejs
  else
    say "This system's own Node.js is too old: installing Node.js $NODE_SETUP from NodeSource (deb.nodesource.com)."
    "${APT[@]}" install ca-certificates curl gnupg
    tmp="$(mktemp -d)"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_SETUP}.x" -o "$tmp/nodesource_setup.sh"
    bash "$tmp/nodesource_setup.sh"
    rm -rf "$tmp"
    "${APT[@]}" install nodejs
  fi
  for c in /usr/bin/node /usr/local/bin/node; do
    if [ "$(node_major "$ROOT$c")" -ge "$NODE_MIN" ]; then NODE_BIN="$ROOT$c"; break; fi
  done
  [ -n "$NODE_BIN" ] || die "Node.js $NODE_MIN or newer could not be installed"
fi
say "Node.js $("$NODE_BIN" -v) ($NODE_BIN)"

# ---------------------------------------------------------------------------------------------- the relay

step "Installing the relay"
mkdir -p "$APP_DIR" "$CONF_DIR" "$(dirname "$UNIT_FILE")"
chmod 755 "$APP_DIR"
chmod 700 "$CONF_DIR"
cp -f "$RELAY_SRC" "$APP_DIR/relay.js.new"
chmod 644 "$APP_DIR/relay.js.new"
mv -f "$APP_DIR/relay.js.new" "$APP_DIR/relay.js"
say "relay.js -> $APP_DIR/relay.js"

KEY_FILE="$CONF_DIR/host-key"
KEY_NEW=0
if [ "$OPT_NEWKEY" = 1 ] || [ ! -s "$KEY_FILE" ]; then
  (umask 077; gen_key > "$KEY_FILE")
  KEY_NEW=1
fi
chmod 600 "$KEY_FILE"
KEY="$(sed -n '1p' "$KEY_FILE" | tr -d '[:space:]')"
[ -n "$KEY" ] || die "the host key file $KEY_FILE is empty (run again with --new-key)"

if [ -n "$DOMAIN" ]; then
  RELAY_ARGS="--host 127.0.0.1 --port $PORT --trust-proxy --allow-host $DOMAIN"
else
  RELAY_ARGS="--host 0.0.0.0 --port $PORT"
fi
if [ "$LIST" != 1 ]; then RELAY_ARGS="$RELAY_ARGS --no-room-list"; fi
RELAY_ARGS="$RELAY_ARGS --no-lan-info"
(umask 077; printf '# written by install.sh: run it again to change these\nKINETIC_HOST_KEY=%s\nKINETIC_RELAY_ARGS=%s\n' "$KEY" "$RELAY_ARGS" > "$CONF_DIR/relay.env")
chmod 600 "$CONF_DIR/relay.env"

NODE_SYS="${NODE_BIN#"$ROOT"}"
sed "s#^ExecStart=/usr/bin/node #ExecStart=$NODE_SYS #" "$UNIT_SRC" > "$UNIT_FILE"
chmod 644 "$UNIT_FILE"
if [ -z "$DOMAIN" ] && [ "$PORT" -lt 1024 ]; then
  mkdir -p "$DROPIN_DIR"
  printf '[Service]\n# a port below 1024 needs this one capability\nAmbientCapabilities=CAP_NET_BIND_SERVICE\nCapabilityBoundingSet=CAP_NET_BIND_SERVICE\n' > "$DROPIN_DIR/port.conf"
else
  rm -rf "$DROPIN_DIR"
fi

# ---------------------------------------------------------------------------------------------- firewall

FW="$(fw_kind)"
if [ -n "$DOMAIN" ]; then NEED="80/tcp 443/tcp"; else NEED="$PORT/tcp"; fi
OPENED=""
for rule in $P_OPENED; do
  case " $NEED " in
    *" $rule "*) OPENED="$OPENED$rule " ;;
    *) fw_close "$rule"; say "Firewall ($FW): closed $rule (no longer used)" ;;
  esac
done
if [ "$FW" != none ]; then
  for rule in $NEED; do
    added="$(fw_open "$rule")"
    if [ -n "$added" ]; then OPENED="$OPENED$added"; say "Firewall ($FW): opened $rule"; else say "Firewall ($FW): $rule is open"; fi
  done
else
  say "Firewall: no ufw / firewalld active on this machine (nothing to open here)."
fi
OPENED="$(printf '%s' "$OPENED" | sed 's/ *$//')"

# ---------------------------------------------------------------------------------------------- start

step "Starting the relay"
save_conf "$OPENED"
systemctl daemon-reload
systemctl enable --quiet "$SERVICE"
if ! systemctl restart "$SERVICE" || ! wait_http "http://127.0.0.1:$PORT/api/rooms" 40 0.5; then
  journalctl -u "$SERVICE" -n 30 --no-pager >&2 || true
  die "the relay did not start (its log is above)"
fi
say "The relay answers on port $PORT."

# ---------------------------------------------------------------------------------------------- HTTPS

if [ -n "$DOMAIN" ]; then
  step "HTTPS for $DOMAIN (Caddy)"
  dns="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true)"
  mine="$(ip -o -4 addr show scope global 2>/dev/null | awk '{split($4, a, "/"); print a[1]}' | tr '\n' ' ' || true)"
  dns_ok=0
  for a in $dns; do case " $mine " in *" $a "*) dns_ok=1 ;; esac; done
  if [ -z "$dns" ]; then
    here_ips="${mine:-the IP of this server}"
    warn "$DOMAIN does not resolve yet. Add an A record for it pointing at $here_ips (at your domain's DNS);
Caddy keeps trying and gets the certificate once it does."
  elif [ "$dns_ok" = 1 ]; then
    say "DNS: $DOMAIN -> $dns(this server)"
  else
    warn "$DOMAIN points to ${dns}but this server's addresses are ${mine:-unknown}. Fix the A record: until it points here,
no certificate can be issued."
  fi
  if ! command -v caddy >/dev/null 2>&1; then
    "${APT[@]}" update
    pol="$(apt-cache policy caddy 2>/dev/null || true)"
    if grep -qE 'Candidate: +[0-9]' <<< "$pol"; then
      "${APT[@]}" install caddy
    else
      say "Adding Caddy's own package repository (dl.cloudsmith.io/public/caddy)."
      "${APT[@]}" install ca-certificates curl gnupg
      curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o "$ROOT/usr/share/keyrings/caddy-stable-archive-keyring.gpg"
      curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > "$ROOT/etc/apt/sources.list.d/caddy-stable.list"
      chmod o+r "$ROOT/usr/share/keyrings/caddy-stable-archive-keyring.gpg" "$ROOT/etc/apt/sources.list.d/caddy-stable.list"
      "${APT[@]}" update
      "${APT[@]}" install caddy
    fi
  fi
  mkdir -p "$(dirname "$CADDYFILE")"
  if [ -f "$CADDYFILE" ] && ! grep -qF "$MARK" "$CADDYFILE"; then cp -f "$CADDYFILE" "$CADDY_BACKUP"; fi
  {
    say "$MARK"
    if [ -n "$EMAIL" ]; then printf '{\n\temail %s\n}\n\n' "$EMAIL"; fi
    printf '%s {\n' "$DOMAIN"
    printf '\t# the game: WebSocket /ws and the room list; X-Forwarded-For tells the relay who each player is\n'
    printf '\t@relay path /ws /api/rooms\n'
    printf '\thandle @relay {\n\t\treverse_proxy 127.0.0.1:%s\n\t}\n' "$PORT"
    printf '\thandle {\n\t\trespond "KINETIC online server. Players: KINETIC > Multiplayer > Join, address %s." 200\n\t}\n' "$DOMAIN"
    printf '}\n'
  } > "$CADDYFILE.new"
  mv -f "$CADDYFILE.new" "$CADDYFILE"
  chmod 644 "$CADDYFILE"
  caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1 || die "Caddy does not accept $CADDYFILE (caddy validate --config $CADDYFILE)"
  systemctl enable --quiet caddy || true
  if ! systemctl restart caddy; then
    journalctl -u caddy -n 20 --no-pager >&2 || true
    die "Caddy did not start (its log is above)"
  fi
  say "Caddy is set up for https://$DOMAIN (it gets the certificate from Let's Encrypt and renews it). Checking ..."
  if wait_http "https://$DOMAIN/api/rooms" 25 2; then
    say "https://$DOMAIN answers."
  else
    journalctl -u caddy -n 15 --no-pager >&2 || true
    warn "https://$DOMAIN does not answer yet (Caddy's log is above). Usual reasons: the A record does not point here yet,
or ports 80/443 are closed in the hosting panel's firewall. Caddy keeps retrying; check again from your PC with:
    node server/check.js $DOMAIN      (in the fps folder)"
  fi
else
  remove_caddy_site
fi

# ---------------------------------------------------------------------------------------------- done

if [ -n "$DOMAIN" ]; then
  ADDRESS="$DOMAIN"
  PANEL_PORTS="TCP 80 and 443"
else
  ip4="$(public_ip)"
  ADDRESS="${ip4:-SERVER-IP}:$PORT"
  PANEL_PORTS="TCP $PORT"
  if [ -n "$ip4" ] && is_private_ip "$ip4"; then
    warn "this machine's address $ip4 is a private one: players need the server's public IP (shown in your hosting
panel), and port $PORT must be forwarded to this machine."
  fi
fi

say ""
say "=============================================================================================="
say " KINETIC online server is running."
say ""
say "   Server address   $ADDRESS"
say "                    players: KINETIC > Multiplayer > Join, this address and the host's room code"
say "   Host key         $KEY$( [ "$KEY_NEW" = 1 ] && printf '   (new)' )"
say "                    for whoever hosts: Host a game > Online server. Keep it private: anyone with"
say "                    it can open rooms here."
say ""
say "   Your hosting panel may have its own firewall (Hostinger: VPS > Security > Firewall):"
say "   it must allow $PANEL_PORTS."
say ""
say "   Build the address into your copy of the game (friends then type only the code):"
say "       npm run package -- --server $ADDRESS"
say ""
say "   status: systemctl status $SERVICE      log: journalctl -u $SERVICE -f"
say "   update: run install.sh again (keeps the key and these options); new key: --new-key;"
say "   remove: --uninstall"
say "=============================================================================================="
