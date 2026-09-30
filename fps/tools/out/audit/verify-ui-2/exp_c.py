import json, sys, time
from sess import Session
from common import start_match
from exp_b_helpers import new_match

s = Session(1280, 720)
try:
    st = start_match(s, map_id='sandbox', bots=3, mode='ffa', score=10, timelim=0)
    print('state', st)

    HOOK = """
      const h = __GAME__.hud; window.__log = [];
      if (!h.__orig) { h.__orig = h.announce.bind(h); }
      h.announce = (t, sub, k, ms) => { window.__log.push({t: t, sub: sub, k: k, frame: __GAME__.frame, state: __GAME__.state}); h.__orig(t, sub, k, ms); };
    """

    # ---- D: victory banner overwritten by kill callout ----
    new_match(s, 2, 3)
    s.run(HOOK)
    r = s.run("""
      const g = __GAME__, p = g.player, bot = g.entities.find(e => e.isBot);
      p.kills = 2;
      g.combat.kill(bot, {attacker: p, weapon: 'rifle', headshot: true});
      await new Promise(r => setTimeout(r, 400));
      return {log: window.__log, atitle: g.hud.e.atitle.textContent, asub: g.hud.e.asub.textContent, state: g.state, over: g.match.over, playerWon: g.match.playerWon, animState: g.hud._annAnim && g.hud._annAnim.playState};
    """)
    print('D', json.dumps(r))
    s.shot('d_victory.png')

    # ---- D2: winning kill without a callout, does LEAD/other overwrite? ----
    new_match(s, 2, 3)
    s.run(HOOK)
    r = s.run("""
      const g = __GAME__, p = g.player, bots = g.entities.filter(e => e.isBot);
      g.hud._firstBlood = true;
      // bot0 scores first so the leader is the bot, then the player wins
      g.combat.kill(bots[1], {attacker: bots[0], weapon: 'rifle'});
      await new Promise(r => setTimeout(r, 300));
      g.hud.__orig = g.hud.__orig; 
      p.kills = 2; bots[0].kills = 1;
      g.combat.kill(bots[0], {attacker: p, weapon: 'rifle', headshot: false});
      await new Promise(r => setTimeout(r, 400));
      return {log: window.__log, atitle: g.hud.e.atitle.textContent, state: g.state, playerWon: g.match.playerWon, kills: [p.kills, bots[0].kills, bots[1].kills]};
    """)
    print('D2', json.dumps(r))

    # ---- E: kill callout overwritten by MATCH POINT in same frame ----
    new_match(s, 2, 10)
    s.run(HOOK)
    r = s.run("""
      const g = __GAME__, p = g.player, bot = g.entities.find(e => e.isBot);
      g.hud._firstBlood = true;
      p.kills = 8;
      window.__log.length = 0;
      window.__f0 = g.frame;
      g.combat.kill(bot, {attacker: p, weapon: 'rifle', headshot: true});
      window.__afterKillLog = window.__log.slice();
      await new Promise(r => setTimeout(r, 300));
      return {afterKill: window.__afterKillLog, full: window.__log, frame: g.frame, f0: window.__f0, atitle: g.hud.e.atitle.textContent};
    """)
    print('E', json.dumps(r))

    # ---- F: rank tie-break ----
    new_match(s, 3, 25)
    r = s.run("""
      const g = __GAME__, p = g.player, bots = g.entities.filter(e => e.isBot);
      p.kills = 3; p.deaths = 2; bots[0].kills = 3; bots[0].deaths = 1; bots[1].kills = 0; bots[2].kills = 0;
      g.hud._scoreDirty = true;
      await new Promise(r => setTimeout(r, 300));
      const rows = g.getScoreboard();
      return {hudRank: g.hud.e.tlname.textContent, tag: g.hud.e.trtag.textContent, boardRank: rows.findIndex(x => x.isPlayer) + 1, rows: rows.map(x => [x.name, x.kills, x.deaths])};
    """)
    print('F', json.dumps(r))
    # time-limit end with equal kills, different deaths
    r = s.run("""
      const g = __GAME__, p = g.player;
      g.endMatch('time');
      await new Promise(r => setTimeout(r, 200));
      return {hudRank: g.hud.e.tlname.textContent, winner: g.match.winner && g.match.winner.name, playerWon: g.match.playerWon, announce: [g.hud.e.atitle.textContent, g.hud.e.asub.textContent]};
    """)
    print('F2', json.dumps(r))
finally:
    s.close()
