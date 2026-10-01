"""arsenal suite (tools/mp/scenarios/arsenal.js): client rockets / grenades / Gale run on the host and hit the host
player; host rockets hit the client and push it (impulses); projectiles are replicated to the client; the client
showed its own rockets at once (predicted copies); no action was refused."""


def _c(page):
    return (page.get('result') or {}).get('custom') or {}


def check(pages, ctx):
    fails = []
    host = next((p for p in pages if ctx.role(p) == 'host'), None)
    client = next((p for p in pages if ctx.role(p) == 'client'), None)
    if not host or not client:
        return ['need a host and a client page']
    ha = (ctx.net(host).get('custom') or {}).get('ars') or {}
    ca = (ctx.net(client).get('custom') or {}).get('ars') or {}
    hl, cl = _c(host).get('arsenal') or {}, _c(client).get('arsenal') or {}
    imps = (ctx.net(client).get('custom') or {}).get('imp') or []
    ctx.log(f'client sent {ca.get("sent")}, refused {ca.get("refused")}, replicated max {ca.get("replicatedMax")}, '
            f'predicted max {ca.get("predictedMax")}')
    ctx.log(f'host executed {ha.get("exec")}, rejected {ha.get("rejected")}')
    ctx.log(f'host took {hl.get("taken")}, shoved {hl.get("shoved")} (max {hl.get("maxShoveSpeed")} m/s), deaths {hl.get("deaths")}')
    ctx.log(f'client took {cl.get("taken")}, impulses {len(imps)}, deaths {cl.get("deaths")}')
    sent, ex = ca.get('sent') or {}, ha.get('exec') or {}
    for a in ('rocket', 'nade', 'gale'):
        if not sent.get(a):
            fails.append(f'the client sent no {a} action')
        elif ex.get(a, 0) < sent[a]:
            fails.append(f'the host executed {ex.get(a, 0)} of {sent[a]} {a} actions')
    if ha.get('rejected'):
        fails.append(f'actions rejected: {ha["rejected"]}')
    taken = hl.get('taken') or {}
    if not (taken.get('rocket') or taken.get('grenade')):
        fails.append('the host player took no rocket / grenade damage from the client')
    if not taken.get('gale') and not hl.get('shoved'):
        fails.append('the Gale never reached the host player')
    if not (ca.get('replicatedMax') or 0):
        fails.append('the client never saw a replicated projectile')
    if not (ca.get('predictedMax') or 0):
        fails.append('the client never showed a predicted rocket')
    ctaken = cl.get('taken') or {}
    if not (ctaken.get('rocket') or ctaken.get('explosion')):
        fails.append("the client took no damage from the host's rockets")
    if not imps:
        fails.append('the client received no knockback impulse')
    return fails
