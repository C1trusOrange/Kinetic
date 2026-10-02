"""smoke suite: the match lifecycle on every page (tools/mp/scenarios/smoke.js).

START -> all pages begin within 10 s; a client that stalled 300 ms in the countdown still goes live within 50 ms of
the host (host time); the time limit ends the match on every page with the same winnerId and each page's own
results row is its own entity; REMATCH -> epoch + 1 and every page plays again; BACK TO LOBBY -> every page in the lobby.
"""


def _log(page):
    rep = page.get('result') or {}
    return ((rep.get('custom') or {}).get('smoke')) or None


def check(pages, ctx):
    fails = []
    logs = [(p, _log(p)) for p in pages]
    if any(lg is None for _, lg in logs):
        return ['a page has no smoke log (the scenario did not finish)']
    host = next((p for p in pages if ctx.role(p) == 'host'), None)
    hlog = _log(host) if host else None
    if not hlog:
        return ['no host page']
    # matches started everywhere
    for p, lg in logs:
        if len(lg['begins']) < 2:
            fails.append(f'p{p["page"]}: {len(lg["begins"])} match start(s), want 2')
    e1 = hlog['begins'][0][0] if hlog['begins'] else None
    starts = [lg['begins'][0][1] for _, lg in logs if lg['begins']]
    if starts and max(starts) - min(starts) > 10000:
        fails.append(f'first match began {max(starts) - min(starts)} ms apart (> 10 s)')
    # countdown -> live within 50 ms of the host
    hlive = [t for ep, t in hlog['lives'] if ep == e1]
    for p, lg in logs:
        live = [t for ep, t in lg['lives'] if ep == e1]
        if not live or not hlive:
            fails.append(f'p{p["page"]}: never went live in the first match')
            continue
        d = live[0] - hlive[0]
        ctx.log(f'p{p["page"]} live {d:+d} ms vs host')
        if abs(d) > 50:
            fails.append(f'p{p["page"]}: went live {d} ms from the host (> 50)')
    # same winner, own results row
    for idx in (0, 1):
        winners = set()
        for p, lg in logs:
            if len(lg['ends']) <= idx:
                fails.append(f'p{p["page"]}: no end of match {idx + 1}')
                continue
            ep, winner, me_row, own, won, draw = lg['ends'][idx]
            winners.add(winner)
            if me_row != own:
                fails.append(f'p{p["page"]}: end screen "me" row {me_row} != own entity {own} (match {idx + 1})')
        if len(winners) > 1:
            fails.append(f'match {idx + 1}: different winnerId on the pages: {sorted(winners)}')
        else:
            ctx.log(f'match {idx + 1}: winnerId {winners}')
    # rematch epoch + 1
    for p, lg in logs:
        if len(lg['begins']) >= 2 and lg['begins'][1][0] != (lg['begins'][0][0] + 1) % 256:
            fails.append(f'p{p["page"]}: rematch epoch {lg["begins"][1][0]} != {lg["begins"][0][0]} + 1')
        if not lg['lobby']:
            fails.append(f'p{p["page"]}: never returned to the lobby')
        ctx.log(f'p{p["page"]} phases {[ph for ph, _ in lg["phases"]]}')
    return fails
