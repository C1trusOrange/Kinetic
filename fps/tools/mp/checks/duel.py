"""duel suite (tools/mp/scenarios/duel.js): hit registration both ways.

Phase A (client shoots the host): the host applied >= 95 % of the client's predicted hits, rejected <= 2 % of its
claims, the host's damage events from the client equal the applied claims, and the client got an echo for each.
Phase B (host shoots the client): every damage event the host's own shots made on the client reached the client.
"""


def _d(page):
    return ((page.get('result') or {}).get('custom') or {}).get('duel') or None


def check(pages, ctx):
    fails = []
    host = next((p for p in pages if ctx.role(p) == 'host'), None)
    client = next((p for p in pages if ctx.role(p) == 'client'), None)
    if not host or not client or not _d(host) or not _d(client):
        return ['need a host and a client page with duel logs']
    h, c = _d(host), _d(client)
    hc = (ctx.net(host).get('host') or {}).get('claims') or {}
    cc = (ctx.net(client).get('client') or {}).get('claims') or {}
    ctx.log(f'phase A (client shoots): fired {c["fired"]["A"]}, predicted hits {c["predicted"]["A"]}, host applied {hc.get("applied")} '
            f'rejected {hc.get("rejected")}; host took {h["taken"]["A"]} damage events; client echoes {cc.get("applied")} ghosts {cc.get("ghost")}')
    ctx.log(f'phase B (host shoots): host dealt {h["dealt"]["B"]} damage events, client took {c["taken"]["B"]}')
    ctx.log(f'kills host {h["kills"]} client {c["kills"]}, deaths host {h["deaths"]} client {c["deaths"]}')
    pred = c['predicted']['A']
    applied = hc.get('applied') or 0
    rejected = sum((hc.get('rejected') or {}).values())
    if pred < 10:
        fails.append(f'only {pred} predicted hits in phase A (the duel did not happen)')
    else:
        if applied < 0.95 * pred:
            fails.append(f'host applied {applied} of {pred} predicted hits (< 95 %)')
        if rejected > 0.02 * max(1, applied + rejected):
            fails.append(f'{rejected} claims rejected ({hc.get("rejected")})')
        if h['taken']['A'] != applied:
            fails.append(f'host damage events from the client ({h["taken"]["A"]}) != applied claims ({applied})')
        if (cc.get('applied') or 0) < applied:
            fails.append(f'client saw {cc.get("applied")} echoes for {applied} applied claims')
    for nm, d in (('host', h), ('client', c)):
        frames, shown = d.get('tagFrames') or 0, d.get('tagShown') or 0
        ctx.log(f'{nm}: name tag of the other player shown in {shown} of {frames} frames')
        if frames and shown < 0.5 * frames:
            fails.append(f"{nm}: the other player's name tag was shown in only {shown} of {frames} frames")
    if h['dealt']['B'] < 10:
        fails.append(f'host dealt only {h["dealt"]["B"]} hits in phase B')
    elif c['taken']['B'] != h['dealt']['B']:
        fails.append(f'client damage events from the host ({c["taken"]["B"]}) != host hits ({h["dealt"]["B"]})')
    return fails
