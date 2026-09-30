p = 'src/ai/BotModel.js'
s = open(p, encoding='utf-8', newline='').read().replace('\r\n', '\n')
def rep(a, b):
    global s
    assert a in s, a
    s = s.replace(a, b)
rep("""   * @param {{color?: number|string|THREE.Color, team?: number, number?: number}} [opts] accent colour (visor, plates,
   *   lights), team id, optional unit number (defaults to a number derived from the colour)
   */
  constructor({ color = 0xff4a3d, team = 0, number = null } = {}) {""", """   * @param {{color?: number|string|THREE.Color, team?: number, number?: number, phase?: number}} [opts] accent colour
   *   (visor, plates, lights), team id, optional unit number (defaults to a number derived from the colour) and optional
   *   gait / idle phase offset 0..1 (defaults to a per-instance value so a group of bots never moves in lockstep)
   */
  constructor({ color = 0xff4a3d, team = 0, number = null, phase = null } = {}) {""")
rep("""    this._ready = false;
    this._time = 0;
    this._phase = 0;
    this._k = {""", """    this._ready = false;
    const ph = phase != null ? phase : ((_instances++ * 0.61803398875) % 1);
    this._time = ph * 9.7;
    this._phase = ph;
    this._k = {""")
rep("""const FLASH_TIME = 0.16;
""", """const FLASH_TIME = 0.16;
let _instances = 1;
""")
open(p, 'w', encoding='utf-8', newline='\n').write(s)
p2 = 'tools/out/bot-model/dev.html'
t = open(p2, encoding='utf-8').read()
t = t.replace("new BotModel({ color, team: 1 })", "new BotModel({ color, team: 1, phase: 0 })")
open(p2, 'w', encoding='utf-8').write(t)
print('ok')
