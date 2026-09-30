import * as THREE from 'three';
import { toColor } from '../core/utils.js';

/**
 * Procedural sky: a gradient dome with a sun disc + glow, optional stars and drifting clouds, and a
 * PMREM environment map generated from the very same shader so reflections match what you see.
 *
 * Usage (World does this): const sky = createSky(themeSky, sunDir, fogColor); scene.add(sky.mesh);
 * sky.update(dt); sky.mesh follows the camera on its own (onBeforeRender), sky.dispose().
 */

const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p;
}
`;

const FRAG = /* glsl */`
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uFogColor;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uCosSun;
uniform float uSunBoost;
uniform float uStars;
uniform float uClouds;
uniform float uTime;
uniform float uFogBlend;
// Stratos extras (only compiled in when the theme asks for them: SKY_DECK / SKY_PLANET / SKY_AURORA)
uniform vec3 uCam;
uniform float uDeckY;
uniform vec3 uDeckLit;
uniform vec3 uDeckShade;
uniform vec3 uFlashColor;
uniform float uFlash;
uniform vec4 uBolt[4];
uniform vec3 uPlanetDir;
uniform vec3 uPlanetLight;
uniform vec3 uPlanetA;
uniform vec3 uPlanetB;
uniform vec3 uRingColor;
uniform vec4 uPlanet;
uniform float uRingRot;
uniform vec3 uAur0;
uniform vec3 uAur1;
uniform vec3 uAur2;
uniform float uAurora;
varying vec3 vDir;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    a *= 0.5;
  }
  return s;
}

float fbm3(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    a *= 0.5;
  }
  return s;
}
#ifdef SKY_LOW
#define DECK_FBM fbm3
#else
#define DECK_FBM fbm
#endif

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;

  // base gradient
  float t = clamp(h, 0.0, 1.0);
  float k = 1.0 - pow(1.0 - t, 2.3);
  vec3 col = mix(uHorizon, uTop, k);
  float below = clamp(-h * 3.0, 0.0, 1.0);
  col = mix(col, uBottom, smoothstep(0.0, 1.0, below));

  // warm glow toward the sun along the horizon
  float sd = max(dot(d, uSunDir), 0.0);
  float horizonBand = 1.0 - smoothstep(0.0, 0.45, abs(h));
  col += uSunColor * pow(sd, 5.0) * horizonBand * 0.45;

  // stars
  #ifndef ENV
  if (uStars > 0.001 && h > 0.0) {
    vec3 p = d * 70.0;
    vec3 ip = floor(p);
    vec3 fp = fract(p);
    float rnd = hash13(ip);
    vec3 off = vec3(hash13(ip + 7.1), hash13(ip + 13.7), hash13(ip + 29.3)) * 0.6 + 0.2;
    float dist = length(fp - off);
    float star = step(0.955, rnd) * smoothstep(0.17, 0.0, dist);
    float tw = 0.75 + 0.25 * sin(uTime * 2.0 + rnd * 60.0);
    float lum = dot(col, vec3(0.3, 0.55, 0.15));
    float vis = uStars * smoothstep(0.0, 0.12, h) * (1.0 - clamp(lum * 3.0, 0.0, 1.0));
    col += vec3(0.85, 0.92, 1.0) * star * tw * vis * (0.8 + 1.8 * hash13(ip + 3.3));
  }
  #endif

  // clouds
  #ifndef ENV
  if (uClouds > 0.001 && h > 0.015) {
    vec2 cuv = d.xz / (h + 0.14) * 0.62 + vec2(uTime * 0.0035, uTime * 0.0012);
    float n = fbm(cuv * 1.6);
    float cover = mix(0.72, 0.36, clamp(uClouds, 0.0, 1.0));
    float c = smoothstep(cover, cover + 0.26, n);
    float fade = smoothstep(0.015, 0.2, h);
    // fake self shadowing: sample slightly toward the sun
    vec2 sunOff = normalize(uSunDir.xz + vec2(1e-4)) * 0.05;
    float n2 = fbm(cuv * 1.6 + sunOff * 1.6);
    float lit = clamp((n - n2) * 5.0 + 0.55, 0.0, 1.0);
    vec3 cc = mix(uCloudShade, uCloudLit, lit);
    cc += uSunColor * pow(sd, 6.0) * 0.35 * lit;
    col = mix(col, cc, c * fade * 0.92);
  }
  #endif

  #ifdef SKY_PLANET
  {
    // ringed gas giant: gnomonic projection around uPlanetDir, banded albedo, terminator, tilted ring
    vec3 Pd = normalize(uPlanetDir);
    float cosA = dot(d, Pd);
    if (cosA > 0.2) {
      vec3 T = normalize(cross(Pd, vec3(0.0, 1.0, 0.0)));
      vec3 B = cross(T, Pd);
      vec2 q = vec2(dot(d, T), dot(d, B)) / cosA;
      vec2 pq = q / tan(uPlanet.x);
      vec2 rq = vec2(pq.x * cos(uRingRot) + pq.y * sin(uRingRot), -pq.x * sin(uRingRot) + pq.y * cos(uRingRot));
      rq.y /= uPlanet.w;
      float rr = length(rq);
      float ringMask = smoothstep(uPlanet.y - 0.02, uPlanet.y + 0.02, rr) * (1.0 - smoothstep(uPlanet.z - 0.03, uPlanet.z + 0.03, rr));
      float gaps = 0.55 + 0.45 * sin(rr * 46.0) * sin(rr * 11.0 + 1.0);
      float ringA = ringMask * clamp(gaps, 0.0, 1.0) * 0.8;
      float r2 = dot(pq, pq);
      vec3 ringCol = uRingColor * (0.5 + 0.5 * pow(max(normalize(uPlanetLight).y, 0.0), 0.5));
      if (r2 < 1.0) {
        float z = sqrt(1.0 - r2);
        vec3 n = normalize(T * pq.x + B * pq.y - Pd * z);
        float bands = 0.5 + 0.5 * sin(pq.y * 15.0 + fbm3(vec2(pq.x * 2.0, pq.y * 6.0)) * 3.2);
        vec3 base = mix(uPlanetA, uPlanetB, bands);
        float lit = clamp(dot(n, normalize(uPlanetLight)) * 1.05 + 0.08, 0.0, 1.0);
        float rim = pow(1.0 - z, 3.0);
        vec3 pc = base * (0.06 + 1.1 * lit) + vec3(0.35, 0.5, 0.9) * rim * 0.4;
        float edge = 1.0 - smoothstep(0.985, 1.0, sqrt(r2));
        float front = step(0.0, -rq.y);
        col = mix(col, pc, edge);
        col = mix(col, ringCol, ringA * front);
      } else {
        col = mix(col, ringCol, ringA);
        col += vec3(0.45, 0.6, 1.0) * exp(-(sqrt(r2) - 1.0) * 14.0) * 0.26;
      }
    }
  }
  #endif

  #if defined(SKY_AURORA) && !defined(ENV) && !defined(SKY_LOW)
  if (h > 0.02 && uAurora > 0.001) {
    float az = atan(d.z, d.x);
    float wob = fbm3(vec2(az * 1.6 + uTime * 0.02, 3.1));
    float hh = h - (0.13 + 0.16 * wob);
    float curtain = smoothstep(-0.015, 0.05, hh) * exp(-max(hh, 0.0) * 5.0);
    float rays = 0.45 + 0.55 * vnoise(vec2(az * 34.0 + wob * 9.0, uTime * 0.35));
    float band = smoothstep(0.30, 0.78, fbm3(vec2(az * 2.6 - uTime * 0.015, 1.7)));
    vec3 ac = mix(uAur0, uAur1, clamp(hh * 3.2, 0.0, 1.0));
    ac = mix(ac, uAur2, clamp((hh - 0.22) * 4.0, 0.0, 1.0));
    col += ac * curtain * rays * band * uAurora * smoothstep(0.02, 0.10, h);
  }
  #endif

  // sun disc + glow
  float disc = smoothstep(uCosSun - 0.00035, uCosSun + 0.00025, dot(d, uSunDir));
  float glow = pow(sd, 96.0) * 0.9 + pow(sd, 14.0) * 0.28 + pow(sd, 3.0) * 0.06;
  col += uSunColor * (disc * uSunBoost + glow);

  #ifdef SKY_DECK
  // infinite storm-cloud sea below the horizon: ray/plane hit, lit warm on top, flashing from inside
  if (h < 0.0) {
    float tt = (uCam.y - uDeckY) / max(-h, 1e-4);
    vec2 wp = uCam.xz + d.xz * tt;
    vec2 q = wp * 0.0055 + vec2(uTime * 0.004, uTime * 0.0016);
    float n = DECK_FBM(q);
    #ifdef SKY_LOW
    float dens = smoothstep(0.28, 0.74, n * 1.05);
    float lit = clamp(dens * 1.2 - 0.2, 0.0, 1.0) * clamp(uSunDir.y * 5.0 + 0.45, 0.0, 1.0);
    #else
    float n2 = DECK_FBM(q * 2.7 + 8.3);
    float dens = smoothstep(0.28, 0.74, n * 0.78 + n2 * 0.32);
    vec2 sdir = normalize(uSunDir.xz + vec2(1e-4));
    float nl = DECK_FBM(q + sdir * 0.045);
    float lit = clamp((n - nl) * 7.0 + 0.55, 0.0, 1.0) * clamp(uSunDir.y * 5.0 + 0.45, 0.0, 1.0);
    #endif
    vec3 c = mix(uDeckShade, uDeckLit, lit * dens);
    c = mix(c * 0.5, c, smoothstep(0.1, 0.6, dens));
    float g = uFlash * (0.18 + 0.82 * dens);
    for (int i = 0; i < 4; i++) {
      vec2 dd = wp - uBolt[i].xy;
      g += uBolt[i].w * exp(-dot(dd, dd) / (uBolt[i].z * uBolt[i].z)) * (0.25 + 1.1 * dens);
    }
    c += uFlashColor * g;
    c = mix(c, uFogColor, clamp(1.0 - exp(-tt * 0.0016), 0.0, 1.0));
    col = mix(col, c, smoothstep(-0.0008, -0.02, h));
  }
  col += uFlashColor * uFlash * 0.22 * (0.4 + 0.6 * (1.0 - abs(h)));
  #endif

  // blend the horizon into the fog color so distant geometry melts into the sky
  float fogW = uFogBlend * (1.0 - smoothstep(0.0, 0.2, max(h, 0.0)));
  #ifdef SKY_DECK
  fogW *= step(-0.0008, h);
  #endif
  col = mix(col, uFogColor, fogW);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const _white = new THREE.Color(0xffffff);
const _tmp = new THREE.Color();

/** Fill in defaults for a theme.sky block. Returns plain THREE.Colors + numbers. */
export function normalizeSky(sky = {}) {
  const top = toColor(sky.top ?? '#3f7fd6');
  const horizon = toColor(sky.horizon ?? '#bcd7ee');
  const bottom = toColor(sky.bottom ?? '#4f5560');
  const sunColor = toColor(sky.sunColor ?? '#fff1d6');
  const luma = top.r * 0.3 + top.g * 0.55 + top.b * 0.15;
  const day = Math.min(1, luma * 3.2);
  const cloudLit = toColor(sky.cloudColor ?? horizon).lerp(_white, 0.55 * day + 0.1).multiplyScalar(0.55 + 0.6 * day);
  const cloudShade = top.clone().lerp(horizon, 0.35).multiplyScalar(0.55 + 0.25 * day);
  return {
    top, horizon, bottom, sunColor, cloudLit, cloudShade,
    sunSize: Math.max(0.05, sky.sunSize ?? 1),
    stars: sky.stars === true ? 1 : (typeof sky.stars === 'number' ? sky.stars : 0),
    clouds: Math.min(1, Math.max(0, sky.clouds ?? 0.3)),
    deck: sky.deck ? {
      y: sky.deck.y ?? -58, lit: toColor(sky.deck.lit ?? '#ffb09a'), shade: toColor(sky.deck.shade ?? '#2a2058'), flash: toColor(sky.deck.flash ?? '#9fd8ff'),
    } : null,
    planet: sky.planet ? {
      dir: new THREE.Vector3(...(sky.planet.dir ?? [0.6, 0.3, 0.7])).normalize(),
      light: new THREE.Vector3(...(sky.planet.light ?? [-0.6, 0.35, -0.5])).normalize(),
      radius: sky.planet.radius ?? 0.17, a: toColor(sky.planet.a ?? '#e9c9a0'), b: toColor(sky.planet.b ?? '#b7896a'),
      ringInner: sky.planet.ring?.inner ?? 1.32, ringOuter: sky.planet.ring?.outer ?? 2.15, ringSquash: sky.planet.ring?.tilt ?? 0.34,
      ringRot: sky.planet.ring?.rot ?? 0.42, ringColor: toColor(sky.planet.ring?.color ?? '#d8c3a0'),
    } : null,
    aurora: sky.aurora ? {
      intensity: sky.aurora.intensity ?? 0.75,
      colors: (sky.aurora.colors ?? ['#25ffa8', '#2d8cff', '#b060ff']).map(c => toColor(c)),
    } : null,
  };
}

function makeMaterial(p, sunDir, fogColor, env, low = false) {
  const sunRad = 0.03 * p.sunSize; // angular radius of the (stylised, oversized) sun
  const defines = env ? { ENV: 1 } : {};
  if (p.deck) defines.SKY_DECK = 1;
  if (p.planet) defines.SKY_PLANET = 1;
  if (p.aurora) defines.SKY_AURORA = 1;
  if (low && !env) defines.SKY_LOW = 1;
  const pl = p.planet, au = p.aurora, dk = p.deck;
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    defines,
    uniforms: {
      uTop: { value: p.top.clone() },
      uHorizon: { value: p.horizon.clone() },
      uBottom: { value: p.bottom.clone() },
      uSunColor: { value: p.sunColor.clone() },
      uSunDir: { value: sunDir.clone().normalize() },
      uFogColor: { value: fogColor.clone() },
      uCloudLit: { value: p.cloudLit.clone() },
      uCloudShade: { value: p.cloudShade.clone() },
      uCosSun: { value: Math.cos(sunRad) },
      uSunBoost: { value: env ? 1.6 : 4.5 },
      uStars: { value: p.stars },
      uClouds: { value: p.clouds },
      uTime: { value: 0 },
      uFogBlend: { value: 0.0 },
      uCam: { value: new THREE.Vector3(0, dk ? dk.y + 65 : 0, 0) },
      uDeckY: { value: dk ? dk.y : 0 },
      uDeckLit: { value: dk ? dk.lit.clone() : new THREE.Color() },
      uDeckShade: { value: dk ? dk.shade.clone() : new THREE.Color() },
      uFlashColor: { value: dk ? dk.flash.clone() : new THREE.Color() },
      uFlash: { value: 0 },
      uBolt: { value: [new THREE.Vector4(0, 0, 1, 0), new THREE.Vector4(0, 0, 1, 0), new THREE.Vector4(0, 0, 1, 0), new THREE.Vector4(0, 0, 1, 0)] },
      uPlanetDir: { value: pl ? pl.dir.clone() : new THREE.Vector3(0, 1, 0) },
      uPlanetLight: { value: pl ? pl.light.clone() : new THREE.Vector3(0, 1, 0) },
      uPlanetA: { value: pl ? pl.a.clone() : new THREE.Color() },
      uPlanetB: { value: pl ? pl.b.clone() : new THREE.Color() },
      uRingColor: { value: pl ? pl.ringColor.clone() : new THREE.Color() },
      uPlanet: { value: pl ? new THREE.Vector4(pl.radius, pl.ringInner, pl.ringOuter, pl.ringSquash) : new THREE.Vector4() },
      uRingRot: { value: pl ? pl.ringRot : 0 },
      uAur0: { value: au ? au.colors[0].clone() : new THREE.Color() },
      uAur1: { value: au ? au.colors[1].clone() : new THREE.Color() },
      uAur2: { value: au ? au.colors[2].clone() : new THREE.Color() },
      uAurora: { value: au ? au.intensity : 0 },
    },
  });
  return m;
}

/**
 * Create the visible sky dome. The dome re-centres itself on the rendering camera every frame.
 * @param {object} skyTheme  theme.sky (see ARCHITECTURE.md 6.3)
 * @param {THREE.Vector3} sunDir unit vector toward the sun
 * @param {THREE.Color} fogColor colour the horizon is blended into (blend strength scales with fogBlend)
 * @param {number} radius dome radius (must stay inside camera.far)
 */
export function createSky(skyTheme, sunDir, fogColor, radius = 400, fogBlend = 0.75, low = false) {
  const params = normalizeSky(skyTheme);
  const material = makeMaterial(params, sunDir, fogColor, false, low);
  material.uniforms.uFogBlend.value = fogBlend;
  const geometry = new THREE.SphereGeometry(1, 40, 24);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sky';
  mesh.scale.setScalar(radius);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.onBeforeRender = (renderer, scene, camera) => {
    mesh.position.setFromMatrixPosition(camera.matrixWorld);
    mesh.updateMatrixWorld();
    material.uniforms.uCam.value.copy(mesh.position);
  };
  let time = Math.random() * 100;
  return {
    mesh,
    params,
    material,
    /** Advance cloud drift / star twinkle. */
    update(dt) {
      time += dt;
      material.uniforms.uTime.value = time;
    },
    /** Lightning flash on the whole sky + cloud deck (0..1; keep peaks around 0.3-0.45). */
    setFlash(k) {
      material.uniforms.uFlash.value = k;
    },
    /** Glows inside the cloud deck: up to 4 of {x, z, radius, intensity} (world metres). */
    setBolts(list) {
      const u = material.uniforms.uBolt.value;
      for (let i = 0; i < 4; i++) {
        const b = list && list[i];
        if (b) u[i].set(b.x, b.z, b.radius ?? 60, b.intensity ?? 1); else u[i].w = 0;
      }
    },
    /** Switch the cheaper deck path (3 octaves, one sample, no aurora) on or off (quality 'low'). */
    setLow(low) {
      if (!!material.defines.SKY_LOW === !!low) return;
      if (low) material.defines.SKY_LOW = 1; else delete material.defines.SKY_LOW;
      material.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * Render the sky into a PMREM environment map (image based lighting / reflections).
 * @param {THREE.PMREMGenerator} pmrem shared generator
 * @returns {{texture: THREE.Texture, target: THREE.WebGLRenderTarget, dispose: Function}}
 */
export function createEnvironment(pmrem, skyTheme, sunDir, fogColor) {
  const params = normalizeSky(skyTheme);
  const material = makeMaterial(params, sunDir, fogColor, true);
  material.uniforms.uFogBlend.value = 0.35;
  const geometry = new THREE.SphereGeometry(1, 32, 16);
  const dome = new THREE.Mesh(geometry, material);
  dome.scale.setScalar(100);
  dome.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(dome);
  const target = pmrem.fromScene(scene, 0.0, 1, 1000);
  geometry.dispose();
  material.dispose();
  return {
    texture: target.texture,
    target,
    dispose() { target.dispose(); },
  };
}

/** Average sky luminance-ish colour, handy for fallback fog / ambient decisions. */
export function skyAverage(skyTheme, out = new THREE.Color()) {
  const p = normalizeSky(skyTheme);
  return out.copy(p.horizon).lerp(_tmp.copy(p.top), 0.4);
}
