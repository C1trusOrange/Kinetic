# KINETIC online server (Hostinger or any Linux VPS)

An online server lets friends play together without anyone forwarding a port, from any network: home, hotel,
school, phone hotspot. Everyone's game connects *out* to the server; the host's PC still runs the match (bots,
scores, hits), and the server only passes packets along (it is the same relay the desktop app runs when you host
on *This PC*, `fps/desktop/relay.js`).

```
  host's PC  ──┐                         ┌──  friend 1
               ├──>  online server  <────┤
  friend 2   ──┘     (relay, 27500       └──  friend 3
                      or HTTPS 443)
```

What it needs: a Linux server with a public IP that you can log in to as root over SSH, running **Debian or
Ubuntu**. A Hostinger VPS works, and so does a Hostinger game-server plan (like the one your Minecraft server runs
on) as long as hPanel lists it under VPS with SSH access: the relay is small (about 50 MB of memory and almost no
CPU) and does not touch Minecraft.

Two ways to run it:

| | **Plain port** (simplest) | **HTTPS with a domain** (recommended) |
|---|---|---|
| Players type | `203.0.113.7:27500` | `play.yourdomain.com` |
| You need | nothing else | a domain or subdomain whose DNS you can edit |
| Hotel / school Wi-Fi | works where port 27500 is not blocked | works almost everywhere (it is ordinary HTTPS) |
| Encrypted | no | yes |
| Opens on the server | TCP 27500 | TCP 80 and 443 (Caddy, with a free Let's Encrypt certificate) |

## 1. Get the server details (Hostinger)

In hPanel open **VPS** and manage the server. Its overview shows the **IP address** and the **SSH** login (user
`root`). If you do not know the root password, set a new one in the VPS settings (look for *Root password*), or add
your SSH key there (*SSH keys*). The overview also names the operating system: it must be Debian or Ubuntu.
(hPanel's menus move around now and then; the names above are what to look for.)

Optional, for HTTPS: in hPanel open your domain's **DNS records** (Domains > the domain > DNS / Nameservers) and add
an **A** record: name `play` (or anything), pointing to the VPS IP, TTL 300. A few minutes later
`play.yourdomain.com` leads to the server. A domain registered elsewhere works the same way in its own DNS settings.

## 2. Install (one command, from your PC)

In a terminal (PowerShell is fine) in the `fps` folder of this project:

```
node server/deploy.js root@203.0.113.7
```

or, with the domain from step 1:

```
node server/deploy.js root@203.0.113.7 --domain play.yourdomain.com --email you@example.com
```

It copies `desktop/relay.js` and the installer to the server and runs `server/install.sh` there. SSH asks for the
root password twice (once to copy, once to run; the first time it also asks you to confirm the server's key: type
`yes`). The installer:

- installs Node.js if the server has none (or an old one),
- installs the relay as a service (`kinetic-relay`) that starts with the server and restarts if it ever stops,
  under its own unprivileged user with no access to the rest of the machine,
- makes a **host key**: only someone with it can open rooms on your server (joining needs just the room code),
- opens the port in the server's firewall (ufw) if one is active,
- with `--domain`: installs Caddy, which gets and renews the HTTPS certificate,
- and finally prints the **server address** and the **host key**. Keep that output.

**Hostinger's firewall:** if you have turned on the firewall in hPanel (**VPS > Security > Firewall**), add a rule
there: *Accept, TCP, port 27500, source any* (with a domain: two rules, ports 80 and 443). The installer cannot do
this part for you.

Without `deploy.js` (for example from the hPanel **Browser terminal**): copy the three files `desktop/relay.js`,
`server/install.sh` and `server/kinetic-relay.service` into one folder on the server, then run
`sudo bash install.sh` (plus `--domain ...` if you want HTTPS) in that folder.

## 3. Check it from your PC

```
node server/check.js play.yourdomain.com --key YOUR-HOST-KEY
node server/check.js 203.0.113.7:27500 --key YOUR-HOST-KEY
```

It connects the way the game does and tells you what is wrong if something is (a firewall that drops the
port, a domain that does not point at the server yet, a missing certificate, a wrong key).

## 4. Play

**Host:** KINETIC > Multiplayer > *Host a game*: pick **Online server**, enter the server address and the host key,
press *Host a game*, set up the match, *Create room*. The lobby shows the room code.

**Friends:** KINETIC > Multiplayer > *Join a game*: the server address and the room code, *Join*.

To spare friends the address: build it into the copy of the game you give them, and their Join screen starts with
it filled in, so they only type the code:

```
npm run package -- --server play.yourdomain.com
```

(`desktop/server.json` with `{"server": "play.yourdomain.com"}` does the same for every build; git ignores that
file, so the address stays out of the repository.)

## Updating, changing, removing

Run the same `deploy.js` command again after updating the game: it installs the new relay and keeps the host key
and the options of the last run. Options (after the address in `deploy.js`, or for `install.sh` directly):

| | |
|---|---|
| `--domain NAME [--email ADDR]` | switch to HTTPS on that domain |
| `--no-domain` | back to the plain port (removes the KINETIC site from Caddy) |
| `--port N` | another port for the plain mode (default 27500) |
| `--new-key` | a new host key (the old one stops working) |
| `--list-rooms` / `--no-list-rooms` | show open rooms in everyone's Join screen, or not (default: not shown) |
| `--uninstall` | remove the service, its files and the firewall rules it added |

On the server: `systemctl status kinetic-relay` (is it running), `journalctl -u kinetic-relay -f` (its log: rooms
opening, players joining, refused host attempts), `cat /etc/kinetic-relay/host-key` (the key).

## Security

- **Who can host:** only someone with the host key. A wrong key costs an attempt from the same budget as joins
  (20 a minute per address), so the key (24 random characters) cannot be guessed.
- **Who can join:** whoever has the room code. Rooms are not listed, so a stranger would have to guess a 4-letter
  code, which the same limit makes slow. Once your friends are in, press *Lock room* in the lobby to keep everyone
  else out (a friend who drops can still come back).
- **What players see of each other:** the server stands between everyone, so players do not see each other's IP
  addresses. (The server tells the host's game each player's address, as on a LAN; the game neither shows it nor
  passes it on. The server log has them too.)
- **On the server:** the relay runs as a throwaway user made for the service (systemd `DynamicUser`), cannot write
  to the disk, cannot gain privileges, and its key lives in a file only root can read. It accepts browser pages from
  the desktop app only, and it caps connections and requests per address.
- **Plain mode is not encrypted:** room codes and game traffic cross the internet as they are. That only matters
  for a code someone could reuse while the room is open; the HTTPS mode encrypts everything.

## Good to know

- Pick a server near the players: every packet goes host > server > friend, so the server's distance counts twice.
  `check.js` shows the round trip from your PC.
- If the **host's** internet drops, the server closes the room (friends who drop rejoin by themselves).
- HTTPS needs ports 80 and 443 for Caddy. If the server already uses them (a website, a game panel, a Caddy with
  your own sites), the installer stops before changing anything: use the plain mode there.
- Not Debian or Ubuntu: run the relay any way you like, e.g. `KINETIC_HOST_KEY=... node relay.js --port 27500
  --no-room-list --no-lan-info` (`node relay.js --help` lists everything).
