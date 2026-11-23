# Aircraft import pipeline

War Browser's aircraft viewer runs independently of the game. It loads the three detail levels, exercises the visual rig, displays attachment points, and reports live rendering statistics.

```sh
npm ci
npm run aircraft:viewer
```

Open the address printed by Vite. **Open package** accepts a generated `manifest.json` and its three GLB files selected together. The included Hornet loads by default. **Orbit**, **Top**, **Port**, and **Underside** inspect different angles. For a side-by-side detail check, choose a fixed LOD and keep the camera in place. **Auto** switches at the manifest's distances with hysteresis.

`npm run aircraft:viewer:build` builds a standalone static viewer into `tools/aircraft-viewer/dist/`. The main game build has its own entry point and public asset directory.

## Import another aircraft

Use Blender 4.3 or newer and Python 3.10 or newer. Install Pillow in a virtual environment if your Python installation requires one.

```sh
python -m pip install -r tools/aircraft-import/requirements.txt

python tools/aircraft-import/import_aircraft.py inspect /path/to/original.glb --parts

python tools/aircraft-import/import_aircraft.py build /path/to/original.glb \
  --recipe /path/to/aircraft.json --output /path/to/package

python tools/aircraft-import/import_aircraft.py validate /path/to/package \
  --recipe /path/to/aircraft.json
```

To reproduce the included Hornet, use `recipes/fa-18-hornet.json` from `tools/aircraft-import/` and output to `tools/aircraft-viewer/public/fa-18-hornet/`. Before redistributing a new import, verify its license and record title, author, source URL, and license. The importer carries attribution from glTF `asset.extras` into every output and produces `ATTRIBUTION.txt`. An explicit `attribution` object in the recipe can supply any missing fields.

1. Survey the source GLB. The report gives triangle counts, bounds, materials, textures, animations, and the hierarchy. Sources with skins, clips, or morph targets require a reviewed static export before re-rigging.
2. Copy the Hornet recipe. Set the frame's source-space `origin`, uniform `scale`, and optional `yawDegrees`, `pitchDegrees`, and `rollDegrees`. Rotation order is roll, pitch, then yaw about glTF Z, X, and Y. Specify expected length and span ranges in meters to catch scale and orientation mistakes.
3. Map each source mesh or single-mesh parent to a group. Keep independently moving surfaces in separate groups with a pivot and hinge axis fitted to their actual geometry. A `clip` plane keeps the positive half of a source mesh in source world space. Use complementary planes to split a paired mesh or free a surface while preserving its UVs. Put decorative or embedded store meshes in `drop` when they should be omitted. The importer rejects unassigned source meshes and empty groups.
4. Add socket positions and directions in the **output** frame, component names, and pose-clearance pairs. A reviewed `opaqueMaterials` list changes source materials with fully opaque usage to opaque. Per-part overrides let geometry sharing a glass texture use an opaque material while the glass stays blended.
5. Set three LOD distances, triangle ratios, and texture limits. `preserve` retains thin surfaces or small doors exactly. `lodFloor` protects moving geometry from over-decimation. Inspect the result in Three.js at rest and across its full pose range. Check the generated clearance report before wiring the model into gameplay.

The build welds coincident vertices at the recipe tolerance, prunes degenerates, clips and joins meshes within their own group, and decimates each group independently. It preserves UVs and writes embedded WebP textures using `EXT_texture_webp`, with lossless compression for normal and packed data maps. It removes entirely black emissive maps. No remote texture URLs or GPU texture decoders are needed. WebP reduces transfer size. GPU residency still depends on texture dimensions and mipmaps.

The package contains `lod0.glb`, `lod1.glb`, `lod2.glb`, `manifest.json`, `report.json`, and `ATTRIBUTION.txt`. Validation checks finite geometry, triangle indices, degenerates, hierarchy ownership, nonempty moving parts, socket orientation and location, LOD transforms, model bounds, and reduction. The clearance report samples the rest pose, surface limits, and the actual gear schedule at 10% intervals. It counts overlapping triangle pairs on the groups named in the recipe. The count can include shared seams and intended overlaps. Review the positions visually to establish whether collisions affect the model.

## War Browser integration contract

- `src/aircraft/registry.js` pairs each aircraft's spec with an asynchronous visual factory. The existing A-10C path uses `GLTFLoader`, a named rig, and `THREE.LOD`. Its loader rotates its particular GLB into simulation coordinates.
- New imported GLBs are authored directly in simulation coordinates. Units are meters, **+Z** is nose forward, **+Y** is up, and **+X** is aircraft left. They need no A-10C-style 180° correction.
- The normalized root has one child per visual group and attachment. A moving group owns real mesh geometry and includes an `aircraftAnimation` JSON string in its glTF extras. The viewer reads that metadata and rotates its quaternion about the stored normalized local axis. Each detail level has the same names, pivots, and metadata.
- `Aileron_Left/Right`, `Elevator_Left/Right`, `Rudder_Left/Right`, `Flap_Left/Right`, and `LeadingEdge_Left/Right` use `roll`, `pitch`, `yaw`, `flaps`, and `leadingEdge` respectively. Use the current visual adapter's interpolated flight state to supply pose inputs in a future integration. Roll, pitch, and yaw expect `[-1, 1]`. Flaps and leading-edge surfaces expect `[0, 1]`. `min`, `max`, and `sense` define the mapping to degrees. Gear and gear doors use `rest`, `end`, and optional `clearanceOpen`. Their sequence is driven by a normalized retraction progress value. The rig is posed at runtime, as with the A-10C controls.
- `HP_01` through `HP_09`, `HP_Cannon_Muzzle`, and `Engine_Exhaust_Left/Right` are visual sockets. Each points along its intended local **+Z** direction. `manifest.json` records the body-space positions and marks the provisional Hornet placements as approximate. A future aircraft spec can use reviewed positions in loadout stations, muzzle effects, and engine effects.
- `damageComponent` maps visual groups to the naming convention used in `src/sim/aircraft-damage.js` and the aircraft specs. Future visual damage code can group or hide nodes by that tag. Collision volumes and damage capacities belong in a corresponding aircraft spec.

## Browser verification

```sh
npx playwright install chromium
npm run aircraft:viewer:check
```

The check runs the built viewer in Chromium with software WebGL. It verifies GLB and texture loading through Three.js, visible pose changes, manual and automatic LOD selection, actual renderer triangle counts, overlays, and loading a local package. Use `AIRCRAFT_VIEWER_CHROMIUM` to select an installed Chromium and `AIRCRAFT_VIEWER_SCREENSHOTS` to retain captures. Physical GPU performance varies with viewport, resolution, and lighting.

See the [Hornet import report](hornet.md) for the source survey and remaining modeling work.
