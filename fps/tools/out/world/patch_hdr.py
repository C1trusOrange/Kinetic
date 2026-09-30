p = 'src/world/MapBuilder.js'
s = open(p, encoding='utf-8').read()
a = s.index("/**\n * MapBuilder: turns")
b = s.index("const UP = new THREE.Vector3")
hdr = '''/**
 * MapBuilder: turns `def.solids` (see ARCHITECTURE.md 6.3) into
 *   - render meshes merged per material (world-space, tangent-plane projected UVs scaled by
 *     getMaterialInfo(mat).scale, so textures are continuous across neighbouring pieces),
 *   - collision triangles (added to a CollisionWorld) tagged with the material's surface type,
 *   - a flat triangle list used by the NavGraph.
 *
 * Two phases so the World can generate exactly the textures the map needs:
 *   const b = new MapBuilder(def, collision);  b.buildGeometry();  -> b.materialNames
 *   await preloadMaterials(b.materialNames);   b.createMeshes();
 *
 * Designer notes
 *   - Default materials: crate 'crate' . container 'container_<color>' . railing 'metal_painted_yellow' .
 *     catwalk deck 'metal_grate' (steel structure 'metal_dark', rails 'metal_painted_yellow') .
 *     panel 'light_panel' (no collision, no shadow) . everything else 'concrete'.
 *   - `top` / `bottom` are the +Y / -Y face materials of box, wall, container, cylinder caps and pillar;
 *     for ramp and stairs `top` is the walking surface (slope / treads).
 *   - Every solid is a closed piece (the NavGraph and collision rely on that). Overlapping solids are fine,
 *     but coplanar overlapping faces of DIFFERENT materials will z-fight - keep them 1-2 cm apart.
 *   - Collision uses simplified geometry (plain boxes for bevelled / detailed pieces, a smooth ramp for
 *     stairs); details (container ribs, railing posts, catwalk beams, panels) never collide.
 *   - `visible:false` solids collide but never render and never count as walkable floor for bots.
 *   - Emissive materials (neon, light panels) never cast or receive shadows.
 *
 * Extras beyond the documented format (all optional, safe to ignore):
 *   any solid: nav:false (bots never treat its top as floor) . surface (override collision surface)
 *   box/wall: bevel (chamfer size in metres) . cylinder: axis 'x'|'y'|'z' (lay pipes down), flat (facet shading)
 *   catwalk: railMat, railHeight . railing: mat, height
 */

'''
s = s[:a] + hdr + s[b:]
open(p, 'w', encoding='utf-8').write(s)
