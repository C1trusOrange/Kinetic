p = 'src/ai/BotModel.js'
s = open(p, encoding='utf-8', newline='').read().replace('\r\n', '\n')
def rep(a, b, cnt=1):
    global s
    assert s.count(a) >= 1, a
    s = s.replace(a, b)
rep("const CROUCH_HIPS = 0.40;", "const CROUCH_HIPS = 0.37;")
rep("- 0.35 * crouchE + 0.012 * breath", "- 0.45 * crouchE + 0.012 * breath")
rep("""      let fx = lerp(stx, gx, gait), fz = lerp(stz, gz + stz * 0.3, gait), fy = lerp(ANKLE, gy, gait);
      let fp = pitch * gait * (0.6 + 0.4 * run);""", """      let fx = lerp(stx, gx, gait), fz = lerp(stz, gz + stz * 0.3, gait), fy = lerp(ANKLE, gy, gait);
      const fp0 = pitch * gait * (0.6 + 0.4 * run);
      let fp = fp0;
      // roll over the heel / ball of the foot without sinking into the ground
      fy += 0.16 * Math.sin(Math.max(0, -fp0)) + 0.07 * Math.sin(Math.max(0, fp0));""")
rep("""    const flash1 = new THREE.MeshStandardMaterial({
    ...common, emissive: new THREE.Color(0xffffff), emissiveMap: at.whiteMap, emissiveIntensity: 0.95,
  });""", "XX") if False else None
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('ok')
