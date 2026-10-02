"""latejoin suite (tools/mp/scenarios/latejoin.js; the late page has ?latejoin=12).

The late joiner starts with no body (deploy gate), deploys and spawns within 1 s of its deploy (<= 3 s after its
match start), takes no damage before that, never has another entity with its own id, ends with the same scoreboard as
the host, and the other client got its roster entry.
"""


def _c(page):
    return (page.get('result') or {}).get('custom') or {}


def check(pages, ctx):
    fails = []
    host = next((p for p in pages if ctx.role(p) == 'host'), None)
    late = next((p for p in pages if 'latejoin=' in (p.get('url') or '')), None)
    other = next((p for p in pages if p is not host and p is not late), None)
    if not host or not late:
        return ['need a host and a late page']
    lj = _c(late).get('latejoin') or {}
    ctx.log(f'late page: begin {lj.get("begin")}, deploy sent {lj.get("deploySentAt")}, spawn {lj.get("spawn")}, '
            f'damage before deploy {lj.get("damageBeforeDeploy")}, id clashes {lj.get("idClash")}')
    if not lj.get('begin'):
        fails.append('the late page never began the match')
    if not lj.get('spawn'):
        fails.append('the late page never spawned')
    elif lj.get('deploySentAt') and lj['spawn'] - lj['deploySentAt'] > 1000:
        fails.append(f'spawned {lj["spawn"] - lj["deploySentAt"]} ms after deploying (> 1 s)')
    if lj.get('begin') and lj.get('spawn') and lj['spawn'] - lj['begin'] > 3000:
        fails.append(f'spawned {lj["spawn"] - lj["begin"]} ms after its match start (> 3 s)')
    if lj.get('damageBeforeDeploy'):
        fails.append(f'{lj["damageBeforeDeploy"]} damage event(s) before deploying')
    if lj.get('idClash'):
        fails.append('an avatar had the late joiner\'s own id')
    hb = {e[0]: (e[1], e[2]) for e in _c(host).get('board') or []}
    lb = {e[0]: (e[1], e[2]) for e in _c(late).get('board') or []}
    diff = [i for i in hb if i in lb and abs(hb[i][0] - lb[i][0]) + abs(hb[i][1] - lb[i][1]) > 1]
    ctx.log(f'host board {hb}, late board {lb}')
    if diff:
        fails.append(f'scoreboards differ for ids {diff}')
    me = _c(late).get('me')
    if other:
        ob = {e[0] for e in _c(other).get('board') or []}
        if me not in ob:
            fails.append(f'the other client never got the late joiner (id {me}) in its roster')
    return fails
