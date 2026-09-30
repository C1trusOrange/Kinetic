# Integration issues (collected during the build workflow)

1. **Projectiles.js — grenade explosions have owner = null** (reported by AI agent, confirmed by reading lines ~224-233):
   `update()` calls `this._releaseGrenade(g)` before `this.explode(g.position, { owner: g.owner, ... })`; release clears owner
   (and pooled position/normal may be reused). Effects: grenade kills credited as suicides (victim loses a kill), selfScale
   never applies, TDM friendly fire applies to grenades, bots lose explosion attribution.
   Fix: capture `owner`, `position.clone()`, `normal` before releasing, then explode.
2. **Duplicate AI agent incident**: my SendMessage resumed a second copy of the AI engineer that edited src/ai/* concurrently
   with the workflow instance (BotNav.js ledgeAhead/allowsDrop, BotBrain.js applyLedgeGuard, aim calibration, raycast
   workaround removal). After the workflow: re-verify src/ai/* coherence (lint, check, autotest with bots), confirm no
   leftover raycast workaround (inflated maxDist) remains.
3. Core raycast bug (fixed in Collision.js, verified). Check world/player reports for workarounds that are now unnecessary.
