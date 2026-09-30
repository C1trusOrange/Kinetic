let _geos = null;

/** Build (once) the shared bone geometries. */
function getGeometries() {
  if (_geos) return _geos;
  const P = 'paint', D = 'dark', E = 'edge', A = 'accent';
  const geos = {};

  // ---------------------------------------------------------------- pelvis
  {
    const g = new GeoBuilder(11);
    g.loft(
      [oct(-0.115, 0.108, 0.085, 0.028), oct(-0.075, 0.165, 0.118, 0.036), oct(0.045, 0.172, 0.122, 0.036), oct(0.075, 0.142, 0.104, 0.032)],
      (s, i) => (i & 1 ? E : s === 1 ? P : D), { top: D, bottom: D });
    for (const sx of [-1, 1]) g.prism(sx * HIP_X, HIP_DY, 0, 0.060, 0.115, 6, D, D, 'x');
    g.box(0, 0.0, -0.136, 0.10, 0.09, 0.03, { front: fit('accent2'), all: A });
    g.prism(-0.19, 0.0, 0.03, 0.036, 0.10, 6, D, A, 'y');
    geos.pelvis = g.build();
  }

  // ---------------------------------------------------------------- torso
  {
    const g = new GeoBuilder(12);
    const rings = [
      ridged(0.000, 0.140, 0.104, 0.028, 0.000), ridged(0.042, 0.146, 0.108, 0.028, 0.000),
      ridged(0.048, 0.132, 0.098, 0.024, 0.000), ridged(0.090, 0.140, 0.102, 0.026, 0.000),
      ridged(0.096, 0.128, 0.094, 0.024, 0.000), ridged(0.140, 0.144, 0.106, 0.028, 0.000),
      ridged(0.170, 0.180, 0.122, 0.038, 0.018), ridged(0.340, 0.232, 0.142, 0.050, 0.042),
      ridged(0.425, 0.220, 0.132, 0.058, 0.028), ridged(0.470, 0.118, 0.090, 0.040, 0.000),
    ];
    g.loft(rings, (s, i) => {
      if (s <= 5) return D;
      if (s === 6) {
        if (i === 0) return fit('chest', [0, 0, 0.5, 1]);
        if (i === 8) return fit('chest', [0.5, 0, 1, 1]);
        return i & 1 ? E : P;
      }
      if (s === 7) return i & 1 ? E : (i === 0 || i === 8 ? A : P);
      return D;
    }, { top: D, bottom: D });
    // gorget around the neck
    g.prism(0, 0.478, 0, 0.088, 0.05, 8, D, D, 'y');
    // pauldrons: accent shells tilted outward, number plate left, chevrons right
    for (const sx of [-1, 1]) {
      g.begin(sx * 0.295, 0.405, 0, 0, 0, -0.30 * sx);
      const outer = sx > 0 ? 2 : 6;
      const tile = sx > 0 ? 'shoulderR' : 'shoulderL';
      g.loft(
        [oct(-0.05, 0.070, 0.105, 0.028), oct(0.005, 0.082, 0.113, 0.034), oct(0.06, 0.056, 0.088, 0.028)],
        (s, i) => {
          if (i === outer) return fit(tile, s === 0 ? [0, 0, 1, 0.5] : [0, 0.5, 1, 1]);
          return i & 1 ? E : A;
        }, { top: A, bottom: D });
      g.end();
    }
    // reactor pack with rear plate, glowing core, exhaust stacks
    g.loft([oct(0.095, 0.145, 0.085, 0.025, 0.226), oct(0.415, 0.145, 0.085, 0.025, 0.226)],
      (s, i) => (i === 4 ? fit('back') : i === 0 ? null : i & 1 ? E : P), { top: D, bottom: D });
    g.prism(0, 0.27, 0.331, 0.072, 0.04, 8, D, fit('core'), 'z');
    for (const sx of [-1, 1]) g.prism(sx * 0.10, 0.50, 0.25, 0.028, 0.15, 6, D, A, 'y');
    geos.torso = g.build();
  }

  // ---------------------------------------------------------------- head
  {
    const g = new GeoBuilder(13);
    g.prism(0, -0.01, 0, 0.05, 0.08, 6, D, D, 'y');
    const rings = [
      oct(0.010, 0.068, 0.080, 0.020, 0), oct(0.050, 0.096, 0.110, 0.032, -0.002),
      oct(0.092, 0.116, 0.124, 0.040, 0), oct(0.152, 0.120, 0.128, 0.044, 0),
      oct(0.205, 0.112, 0.130, 0.050, 0.014), oct(0.250, 0.078, 0.106, 0.048, 0.026),
      oct(0.272, 0.040, 0.070, 0.030, 0.032),
    ];
    g.loft(rings, (s, i) => {
      if (i & 1) return E;
      if (s === 0 && i === 0) return D;
      if (s === 4) return A;
      return P;
    }, { top: A, bottom: D });
    // visor band: slightly proud of the shell; front + chamfers glow
    g.loft([oct(0.098, 0.124, 0.130, 0.046, -0.006), oct(0.150, 0.126, 0.134, 0.048, -0.006)], (s, i) => {
      if (i === 1) return fit('visor', [0, 0, 0.21, 1]);
      if (i === 0) return fit('visor', [0.21, 0, 0.79, 1]);
      if (i === 7) return fit('visor', [0.79, 0, 1, 1]);
      if (i === 2 || i === 6) return D;
      return null;
    });
    // brow chevron
    for (const sx of [-1, 1]) {
      g.begin(sx * 0.052, 0.166, -0.136, 0.15, -sx * 0.5, -sx * 0.16);
      g.box(0, 0, 0, 0.11, 0.016, 0.026, { all: A, bottom: D });
      g.end();
    }
    // respirator
    g.loft([oct(0.020, 0.048, 0.030, 0.014, -0.102), oct(0.074, 0.058, 0.030, 0.014, -0.106)],
      (s, i) => (i & 1 ? E : D), { top: D, bottom: D });
    // crest fin
    g.begin(0, 0.262, 0);
    g.loft([oct(0, 0.014, 0.095, 0.006, 0.03), oct(0.036, 0.009, 0.06, 0.005, 0.05)], (s, i) => (i & 1 ? E : A), { top: A, bottom: A });
    g.end();
    // ear pods
    for (const sx of [-1, 1]) {
      g.prism(sx * 0.132, 0.105, 0.010, 0.044, 0.05, 6, D, D, 'x');
      g.prism(sx * 0.158, 0.105, 0.010, 0.030, 0.012, 6, A, A, 'x');
    }
    // antenna
    g.begin(0.078, 0.235, 0.085, 0.28, 0, 0);
    g.box(0, 0.04, 0, 0.012, 0.08, 0.012, D);
    g.box(0, 0.09, 0, 0.022, 0.022, 0.022, 'glow');
    g.end();
    geos.head = g.build();
  }

  // ---------------------------------------------------------------- arms
  const armGeos = sx => {
    const ua = new GeoBuilder(sx > 0 ? 21 : 22);
    ua.prism(0, 0, 0, 0.050, 0.10, 6, D, D, 'x');
    ua.loft([oct(-0.03, 0.045, 0.050, 0.012), oct(-0.11, 0.052, 0.058, 0.014), oct(-0.20, 0.047, 0.050, 0.012),
      oct(-0.235, 0.047, 0.050, 0.012), oct(-0.285, 0.040, 0.043, 0.011)],
    (s, i) => (i & 1 ? E : s === 2 ? A : P), { top: D, bottom: D });
    ua.prism(0, -0.30, 0, 0.042, 0.09, 6, D, D, 'x');
    const fa = new GeoBuilder(sx > 0 ? 23 : 24);
    fa.loft([oct(-0.015, 0.041, 0.045, 0.011), oct(-0.09, 0.050, 0.052, 0.013), oct(-0.22, 0.045, 0.045, 0.011), oct(-0.285, 0.036, 0.036, 0.010)],
      (s, i) => (i & 1 ? E : s === 2 ? D : P), { top: D, bottom: D });
    fa.box(0, -0.045, 0.052, 0.046, 0.07, 0.035, A);
    fa.box(sx * 0.052, -0.15, 0, 0.007, 0.12, 0.014, 'glowDim');
    fa.loft([oct(-0.29, 0.036, 0.038, 0.011), oct(-0.34, 0.047, 0.050, 0.013), oct(-0.395, 0.034, 0.043, 0.011)],
      (s, i) => (i & 1 ? E : D), { top: D, bottom: D });
    fa.box(0, -0.30, -0.044, 0.056, 0.03, 0.028, P);
    return [ua.build(), fa.build()];
  };
  [geos.upperArmL, geos.foreArmL] = armGeos(-1);
  [geos.upperArmR, geos.foreArmR] = armGeos(1);

  // ---------------------------------------------------------------- legs
  const legGeos = sx => {
    const th = new GeoBuilder(sx > 0 ? 31 : 32);
    th.loft([oct(-0.03, 0.070, 0.076, 0.018), oct(-0.13, 0.080, 0.086, 0.022), oct(-0.32, 0.063, 0.070, 0.018), oct(-0.415, 0.054, 0.058, 0.015)],
      (s, i) => (i & 1 ? E : P), { top: D, bottom: D });
    th.box(0, -0.21, -0.084, 0.078, 0.16, 0.014, { front: fit('accent2'), all: A });
    th.box(sx * 0.073, -0.23, -0.005, 0.008, 0.15, 0.02, 'glowDim');
    th.prism(0, -0.43, 0, 0.048, 0.105, 6, D, D, 'x');
    const sh = new GeoBuilder(sx > 0 ? 33 : 34);
    sh.loft([oct(-0.055, 0.055, 0.060, 0.014, 0.005), oct(-0.16, 0.064, 0.080, 0.017, 0.018), oct(-0.34, 0.048, 0.057, 0.013, 0.008), oct(-0.415, 0.038, 0.042, 0.011, 0.004)],
      (s, i) => (i & 1 ? E : P), { top: D, bottom: D });
    sh.loft([oct(-0.075, 0.046, 0.043, 0.013, -0.052), oct(0.02, 0.046, 0.043, 0.013, -0.052)],
      (s, i) => (i & 1 ? E : i === 0 ? fit('accent2') : A), { top: A, bottom: A });
    sh.box(0, -0.21, -0.072, 0.064, 0.19, 0.016, P);
    sh.prism(0, -0.43, 0, 0.038, 0.09, 6, D, D, 'x');
    return [th.build(), sh.build()];
  };
  [geos.thighL, geos.shinL] = legGeos(-1);
  [geos.thighR, geos.shinR] = legGeos(1);

  // ---------------------------------------------------------------- foot (symmetric, shared)
  {
    const g = new GeoBuilder(41);
    g.loft(
      [oct(-0.085, 0.048, 0.135, 0.026, -0.07), oct(-0.055, 0.058, 0.145, 0.030, -0.07), oct(-0.035, 0.052, 0.132, 0.028, -0.07), oct(0.012, 0.046, 0.078, 0.020, -0.008)],
      (s, i) => (s < 2 ? D : i & 1 ? E : P), { top: D, bottom: D });
    g.box(0, -0.043, -0.19, 0.070, 0.03, 0.05, A);
    geos.foot = g.build();
  }

  _geos = geos;
  return geos;
}
