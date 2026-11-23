# F/A-18 Hornet proof of concept

The supplied Sketchfab GLB embeds the title **F/A-18 Hornet Low Poly** and credits **HeriFajar** under **CC BY 4.0**. The optimized files carry the original credit and disclose the modifications. [Original model](https://sketchfab.com/3d-models/fa-18-hornet-low-poly-25a2485d6eb4428f89c014e03fb42047) · [Creator](https://sketchfab.com/HeriFajar) · [License](https://creativecommons.org/licenses/by/4.0/)

## Source survey

- The jet uses 51 meshes, 105 scene nodes, and three materials. There are 12 embedded 2,048 × 2,048 PNG maps. The source has two degenerate triangles and zero animation clips, skins, or morph targets.
- The two conversion nodes cancel out. The original nose already points toward +Z, with +Y up and +X toward the left wing. The raw mesh spans about 8.90 units nose to tail and 6.28 laterally, including its stores.
- The inboard trailing-edge flaps, outboard ailerons, rudders, doors, and detailed wheels and linkages were separate source meshes. The horizontal tails were paired in one mesh and the leading edges were part of the wing. The source used blending on the opaque airframe and gear, producing incorrect face ordering and redundant draw passes.
- The conversion scales the clean model to **17.07 m long × 11.70 m wide × 4.53 m tall** including the tip rails and deployed gear. The dimensions describe this artist's mesh and the resulting scene, which is a visual approximation of the airframe.
- The recipe separates both stabilators, leading-edge surfaces, and mirrored main-gear assemblies. It fits physical hinges to the meshes, gives the nose brace independent motion, preserves the canopy blend, and removes the three baked external store meshes. Gear motion opens the doors for clearance, folds the struts, then closes the doors. The model uses the texture atlases and mapped material assignments from the original.

## Geometry review

The gear wheels and doors both move and the wheels tuck away in the endpoint pose. The mesh uses shallow bay openings and simplified links. The 10% sweep still identifies main-gear contacts with the fuselage and doors in transit. The canopy, surface limits, rudder roots, and thin wing cuts are visible in the viewer. The thin cut edges and bay openings can show seams in close-up. For flight-ready gear, revise the bay lining and main strut linkage and repeat the clearance sweep.

The cannon, exhaust, and store sockets are visual attachment estimates fitted to the source mesh. Stage 3.2 uses these sockets in the [playable Hornet](hornet-flight.md).

## Size and rendering

The full report is [report.json](../../tools/aircraft-viewer/public/fa-18-hornet/report.json). The renderer submits one call per visible mesh primitive plus the grid. A software WebGL test verified texture rendering, surface motion, the gear cycle, and switching all three levels. FPS and median CPU submission time are shown live in the viewer.

| Model | File size | Triangles | Mesh primitives | Texture resolution |
| --- | ---: | ---: | ---: | ---: |
| Supplied GLB | 17,418,260 bytes | 30,946 | 51 | 2,048 × 2,048 |
| LOD 0 | 3,824,660 bytes | 27,506 | 28 | 1,024 × 1,024 |
| LOD 1 | 1,318,344 bytes | 13,624 | 28 | 512 × 512 |
| LOD 2 | 504,544 bytes | 6,183 | 28 | 256 × 256 |

Khronos validation reported zero errors on the three GLBs. Chromium software WebGL measured 29 draw calls per level with the grid active at a 1,260 × 820 viewport. The test environment measured 2–4 FPS across runs. That environment uses SwiftShader and provides no hardware GPU benchmark.
