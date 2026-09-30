// Test-only shim: real models where they exist, rifle fallback for the rest (until weapon-models agent finishes).
import { createWeaponModel as real, createGrenadeModel, createRocketModel } from '/src/weapons/WeaponModels.js?real';
export function createWeaponModel(id, o) {
  try { return real(id, o); } catch (e) { return real('rifle', o); }
}
export { createGrenadeModel, createRocketModel };
