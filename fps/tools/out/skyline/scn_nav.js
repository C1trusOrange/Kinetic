import * as THREE from 'three';
export function setup(game, report) {
  const nav = game.world.nav;
  const P = (x, y, z) => { const n = nav.nearestNode(new THREE.Vector3(x, y, z), 1.6); return n ? `${n.main ? 'M' : (n.fromMain ? 'f' : (n.toMain ? 't' : '-'))}@${n.position.y.toFixed(2)}` : 'none'; };
  const out = {};
  const line = (name, pts) => { out[name] = pts.map(p => P(...p)).join(' '); };
  // bridges: 5 samples
  const br = {
    B1: [[10.5, 6.6, -28], [12, 7.2, -28], [14, 8, -28], [16, 8.8, -28], [17.5, 9.5, -28], [19, 9.6, -28]],
    B2: [[28, 9.6, -17.5], [28, 9.6, -15], [28, 9.6, -13], [28, 9.6, -10.5], [28, 9.6, -8.5]],
    B3: [[28, 9.6, 9], [28, 10.2, 11], [28, 11, 14], [28, 12.2, 17], [28, 12.8, 19]],
    B4: [[-9, 6.4, 28], [-11, 6.8, 28], [-14, 7.8, 28], [-17, 8.8, 28], [-19, 9.6, 28]],
    B5: [[-28, 9.6, 19], [-28, 10.2, 17], [-28, 11, 14], [-28, 12.2, 11], [-28, 12.8, 9]],
    B6: [[-28, 12.8, -9], [-28, 13.4, -11], [-28, 14.4, -14], [-28, 15.6, -17], [-28, 16, -19]],
    escN: [[-11.4, 0, -15], [-11.4, 1.6, -18], [-11.4, 3.2, -22], [-11.4, 5, -26], [-11.4, 6.4, -31], [-8, 6.4, -31]],
    escS: [[11.4, 0, 15], [11.4, 1.6, 18], [11.4, 3.2, 22], [11.4, 5, 26], [11.4, 6.4, 31], [8, 6.4, 31]],
  };
  for (const k of Object.keys(br)) line(k, br[k]);
  report.custom = report.custom || {};
  report.custom.nav = out;
  report.custom.stats = nav.stats;
}
export function drive() {}
export function finish() {}
