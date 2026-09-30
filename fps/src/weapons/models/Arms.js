/**
 * First-person arms: sleeves, armoured gloves and fingers wrapped around a "pole" (grip / handguard /
 * fore-grip). A hand is defined in a pole frame (origin, u, v, t): the pole runs along `t`, the cross
 * section (a rounded rectangle) lies in the (u, v) plane, the four fingers are stacked along `t` (index
 * first) and wrap around the perimeter starting at arc position `s0` in direction `dir`; the palm sits
 * behind the knuckles on the opposite side of the path. Everything is emitted into a ModelBuilder as the
 * parts `<side>Arm` (sleeve + cuff, pivot at the elbow) and `<side>Hand` (glove, pivot at the wrist, child
 * of the arm).
 */

const TAU = Math.PI * 2;

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const len3 = a => Math.hypot(a[0], a[1], a[2]);
const norm3 = a => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Rounded-rectangle perimeter path (closed), parametrised by arc length from (A, 0) counter-clockwise. */
function makePath(A, B, R, n = 6) {
  R = Math.min(R, A * 0.98, B * 0.98);
  const pts = [];
  const push = (x, y) => {
    const l = pts[pts.length - 1];
    if (!l || Math.hypot(l[0] - x, l[1] - y) > 1e-6) pts.push([x, y]);
  };
  const arc = (cx, cy, a0, a1) => { for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; push(cx + R * Math.cos(a), cy + R * Math.sin(a)); } };
  push(A, 0);
  push(A, B - R);
  arc(A - R, B - R, 0, Math.PI / 2);
  push(-(A - R), B);
  arc(-(A - R), B - R, Math.PI / 2, Math.PI);
  push(-A, -(B - R));
  arc(-(A - R), -(B - R), Math.PI, Math.PI * 1.5);
  push(A - R, -B);
  arc(A - R, -(B - R), Math.PI * 1.5, TAU);
  push(A, 0);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  return {
    L,
    /** Arc position of the polyline point closest to (u, v). */
    nearest(u, v) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const d = Math.hypot(pts[i][0] - u, pts[i][1] - v);
        if (d < bd) { bd = d; best = cum[i]; }
      }
      return best;
    },
    at(s) {
      s = ((s % L) + L) % L;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const k = (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
      const p = pts[i - 1], q = pts[i];
      const dx = q[0] - p[0], dy = q[1] - p[1];
      const d = Math.hypot(dx, dy) || 1;
      return { u: p[0] + dx * k, v: p[1] + dy * k, du: dx / d, dv: dy / d };
    },
  };
}

/**
 * Adds one arm + glove to the builder.
 * @param {import('./ModelKit.js').ModelBuilder} b
 * @param {object} c configuration (see file header)
 */
export function addArm(b, c) {
  const side = c.side; // 'right' | 'left'
  const O = c.origin, U = c.u, V = c.v, T = c.t;
  const P3 = (u, v, t) => [O[0] + U[0] * u + V[0] * v + T[0] * t, O[1] + U[1] * u + V[1] * v + T[1] * t, O[2] + U[2] * u + V[2] * v + T[2] * t];
  const dir = c.dir ?? -1;
  const sp = c.spacing ?? 0.0172;
  const fr = c.fingerR ?? 0.0079;
  const offF = c.off ?? (fr + 0.0008);
  const palmT = c.palmThick ?? 0.02;
  const offP = c.palmOff ?? (palmT / 2 + 0.0008);
  const pathF = makePath(c.hu + offF, c.hv + offF, (c.rr ?? 0.006) + offF);
  const pathP = makePath(c.hu + offP, c.hv + offP, (c.rr ?? 0.006) + offP);
  const s0 = c.startUV ? pathF.nearest(c.startUV[0], c.startUV[1]) : c.s0;
  const lens = c.lens ?? [0.033, 0.023, 0.019];
  const fscale = c.fingerScale ?? [1.0, 1.06, 0.97, 0.8];
  const tShift = c.tShift ?? 0;
  const tOf = k => (k - 1.5) * sp + tShift;
  // outward normal of a CCW path is (dv, -du)
  const out2 = (p) => [p.dv, -p.du];
  const out3 = (p) => { const n = out2(p); return [U[0] * n[0] + V[0] * n[1], U[1] * n[0] + V[1] * n[1], U[2] * n[0] + V[2] * n[1]]; };

  const armName = side + 'Arm', handName = side + 'Hand';
  const lastPalm = pathP.at(s0 - dir * (c.palmLen ?? 0.072));
  const wrist = P3(lastPalm.u, lastPalm.v, tShift);
  const elbow = c.elbow;
  const toElbow = norm3(sub(elbow, wrist));

  // ---------------- arm part (sleeve + cuff), pivot at the elbow
  b.part(armName, elbow, null);
  const sr0 = c.sleeveR0 ?? 0.026, sr1 = c.sleeveR1 ?? 0.037;
  const cuffLen = 0.085;
  const cuffStart = sub(wrist, mul(toElbow, 0.012));
  const cuffEnd = add(wrist, mul(toElbow, cuffLen));
  b.limb('armor', cuffStart, cuffEnd, 0.0295, 0.031, { seg: 8, capFrom: false });
  b.limb('glowArm', add(wrist, mul(toElbow, cuffLen - 0.001)), add(wrist, mul(toElbow, cuffLen + 0.007)), 0.0314, 0.0314, { seg: 8, capFrom: false, capTo: false });
  b.limb('sleeve', add(wrist, mul(toElbow, cuffLen + 0.004)), elbow, sr0, sr1, { seg: 8, capFrom: false });
  // segmented forearm bracer (armour plates on the outer side, thin glow piping between them)
  const upIn = c.armUp ?? [0, 1, 0];
  const upDot = upIn[0] * toElbow[0] + upIn[1] * toElbow[1] + upIn[2] * toElbow[2];
  const upDir = norm3([upIn[0] - toElbow[0] * upDot, upIn[1] - toElbow[1] * upDot, upIn[2] - toElbow[2] * upDot]);
  const armLen = len3(sub(elbow, wrist));
  const sleeveRadiusAt = d => sr0 + (sr1 - sr0) * Math.min(1, (d - cuffLen) / Math.max(0.1, armLen - cuffLen));
  const plates = [[0.06, 0.05, 0.034], [0.125, 0.045, 0.03], [0.185, 0.04, 0.026]];
  plates.forEach(([d0, len, w], i) => {
    const pa = add(wrist, mul(toElbow, cuffLen + d0)), pb = add(wrist, mul(toElbow, cuffLen + d0 + len));
    const la = sleeveRadiusAt(cuffLen + d0) + 0.0028, lb = sleeveRadiusAt(cuffLen + d0 + len) + 0.0028;
    b.beam('armor', add(pa, mul(upDir, la)), add(pb, mul(upDir, lb)), { w, h: 0.0065, up: upDir, bevel: i === 0 ? 0.0018 : 0 });
    b.beam('glowArm', add(pa, mul(upDir, la + 0.0036)), add(pb, mul(upDir, lb + 0.0036)), { w: 0.0035, h: 0.0012, up: upDir, bevel: 0 });
  });

  // ---------------- hand part (glove), pivot at the wrist
  b.part(handName, wrist, armName);

  // palm chords with the back-of-hand armour plate on top
  const palmLen = c.palmLen ?? 0.072;
  const chords = 2;
  for (let i = 0; i < chords; i++) {
    const sa = s0 - dir * (palmLen * i / chords) + dir * 0.004 * (i === 0 ? 1 : 0);
    const sb = s0 - dir * (palmLen * (i + 1) / chords);
    const pa2 = pathP.at(sa), pb2 = pathP.at(sb);
    const mid = pathP.at((sa + sb) / 2);
    const w = (c.palmW ?? 0.08) * (1 - 0.26 * (i + 0.5) / chords);
    const A3 = P3(pa2.u, pa2.v, tShift), B3 = P3(pb2.u, pb2.v, tShift);
    const up3 = out3(mid);
    b.beam('glove', A3, B3, { w, h: palmT, up: up3, bevel: 0.004, ext0: i === 0 ? 0.002 : 0.004, ext1: 0.004 });
    const o = mul(up3, palmT / 2 + 0.0035);
    b.beam('armor', add(A3, o), add(B3, o), { w: w * 0.66, h: 0.006, up: up3, bevel: i === 0 ? 0.0025 : 0, ext0: 0.004, ext1: 0.003 });
    if (i === 0) {
      const o2 = mul(up3, palmT / 2 + 0.0072);
      b.beam('glowArm', add(A3, o2), add(B3, o2), { w: 0.005, h: 0.0016, up: up3, bevel: 0, ext0: 0.008, ext1: 0.008 });
    }
  }

  // fingers
  for (let k = 0; k < 4; k++) {
    const tk = tOf(k);
    const sc = fscale[k];
    const cfgF = c.fingerOverride && c.fingerOverride[k];
    let pts;
    if (cfgF && cfgF.target) {
      const p0a = pathF.at(s0);
      const p0 = P3(p0a.u, p0a.v, tk);
      const p3 = cfgF.target;
      const bend = cfgF.bend ?? [0, 0, 0];
      pts = [p0, add(lerp3(p0, p3, 0.4), bend), add(lerp3(p0, p3, 0.74), mul(bend, 0.5)), p3];
    } else {
      pts = [];
      let acc = 0;
      const L = [0, lens[0] * sc, lens[1] * sc, lens[2] * sc];
      const curl = cfgF && cfgF.len ? cfgF.len : 1;
      for (let j = 0; j < 4; j++) {
        acc += L[j] * curl;
        const p = pathF.at(s0 + dir * acc);
        pts.push(P3(p.u, p.v, tk));
      }
    }
    const rr = [fr * 1.0, fr * 0.93, fr * 0.86, fr * 0.78];
    b.limb('glove', pts[0], pts[1], rr[0], rr[1], { seg: 6, capFrom: false, capTo: false, ext0: 0.004, ext1: 0.004 });
    b.limb('glove', pts[1], pts[2], rr[1], rr[2], { seg: 6, capFrom: false, capTo: false, ext0: 0.004, ext1: 0.004 });
    b.limb('glove', pts[2], pts[3], rr[2], rr[3], { seg: 6, capFrom: false, ext0: 0.004, ext1: 0.001 });
    // knuckle plate over the proximal segment
    const pm = pathF.at(s0 + dir * lens[0] * sc * 0.5);
    const up3 = out3(pm);
    const o = mul(up3, fr * 0.93);
    b.cube('armor', [0.0105, 0.0085, 0.0105], add(lerp3(pts[0], pts[1], 0.5), o), {});
    if (k === 0 || k === 3) { /* keep triangle count low */ }
  }

  // thumb
  const th = c.thumb;
  if (th) {
    const p = th.map(q => P3(q[0], q[1], q[2]));
    const tr = c.thumbR ?? 0.0084;
    for (let i = 0; i < p.length - 1; i++) {
      const last = i === p.length - 2;
      b.limb('glove', p[i], p[i + 1], tr * (1 - i * 0.1), tr * (1 - (i + 1) * 0.1), { seg: 6, capFrom: false, capTo: last, ext0: 0.004, ext1: last ? 0.001 : 0.004 });
    }
    if (th.length > 2) {
      const m = lerp3(p[1], p[2], 0.35);
      b.cube('armor', [0.011, 0.007, 0.02], add(m, mul(c.thumbUp ?? [0, 1, 0], 0.009)), {});
    }
  }
  return { wrist, elbow };
}
