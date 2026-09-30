// Ad-hoc probe: runs the async function body in probefile=<path> (or ?probe=<js>) with (game, THREE, report, Entity, Capsule, sleep)
// Marks report.done itself when finished (use duration=999 so the autotest does not finish early).
import * as THREE from 'three';
import { Entity } from '/src/core/Entity.js';
import { Capsule } from 'three/addons/math/Capsule.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function setup(game, report) {
  const p = new URLSearchParams(location.search);
  let src = p.get('probe') || '';
  if (p.get('probefile')) src = await (await fetch('/' + p.get('probefile'))).text();
  report.custom = {};
  // run asynchronously so the harness doesn't block in setup
  (async () => {
    try {
      const fn = new AsyncFunction('game', 'THREE', 'report', 'Entity', 'Capsule', 'sleep', src);
      const r = await fn(game, THREE, report, Entity, Capsule, sleep);
      if (r !== undefined) report.custom.result = r;
    } catch (e) {
      report.custom.error = String((e && e.stack) || e);
    }
    report.done = true;
    report.ok = report.errors.length === 0;
  })();
}
export function drive() {}
