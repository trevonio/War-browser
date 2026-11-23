# A-10C · integración en Three.js

## Archivos
| Archivo | Uso |
|---|---|
| `A10C.glb` | LOD0 (≈22 k tris, 92 nodos, texturas incrustadas) |
| `A10C_LOD1.glb`, `A10C_LOD2.glb` | LOD1 ≈11 k / LOD2 ≈6,5 k tris, **mismos nombres de nodo y rig** |
| `A10C_animation_table.md` / `A10C_rig.json` | Tabla de animación (generada del propio modelo) + jerarquía completa |
| `build_a10c.py` | Generador. `python build_a10c.py --out export` (solo numpy) o `blender -b -P build_a10c.py -- --out export` |
| `A10C_viewer.html` | Visor de pruebas (GLB incrustado; necesita internet para cargar three desde CDN) |

## Convención
`+X` derecha · `+Y` arriba · **`-Z` proa** · metros · origen ≈ centro de masas · suelo en `y = -2.10` (tren extendido).
El GLB no necesita rotaciones correctivas.

## Carga y animación
```js
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const {scene: jet} = await new GLTFLoader().loadAsync('A10C.glb');
const n = name => jet.getObjectByName(name);

// Regla de oro: gira el nodo CON NOMBRE (p. ej. Aileron_Left), nunca el *_Pivot.
// En reposo todos están a rotación 0; el pivote estático ya orienta el eje de bisagra.
n('Aileron_Right').rotation.x = THREE.MathUtils.degToRad(-roll * 20);   // + = borde de salida abajo
n('Aileron_Left').rotation.x  = THREE.MathUtils.degToRad(+roll * 20);
n('Elevator_Left').rotation.x = n('Elevator_Right').rotation.x = degToRad(-pitch * 25);
n('Rudder_Left').rotation.y   = n('Rudder_Right').rotation.y   = degToRad(yaw * 30);
n('Flap_Left').rotation.x     = n('Flap_Right').rotation.x     = degToRad(flapDeg);   // 0..40
// Decelerones (hijos del alerón, se suman al alabeo)
for (const s of ['Left','Right']) {
  n(`Deceleron_${s}_Upper`).rotation.x = degToRad(-55 * brake);
  n(`Deceleron_${s}_Lower`).rotation.x = degToRad(+55 * brake);
}
// Tren: g = 0 (abajo) .. 1 (recogido)
n('LandingGear_Left').rotation.x = n('LandingGear_Right').rotation.x = degToRad(86 * g);
n('LandingGear_Nose').rotation.x = degToRad(-90 * g);
const d = Math.min(1, Math.max(0, (1 - g) * 1.6));          // puertas
n('GearDoor_Main_Right').rotation.z = n('GearDoor_Nose_Right').rotation.z = degToRad(80 * d);
n('GearDoor_Main_Left').rotation.z  = n('GearDoor_Nose_Left').rotation.z  = degToRad(-80 * d);
n('EngineFan_Left').rotation.z += rpmRadPerSec * dt;        // continuo
n('Canopy').rotation.x = degToRad(canopyOpen);              // 0..55
```
Los límites y sentidos también están en `node.userData.anim` (`min`, `max`, `axis`, `positive`, `group`), así que el simulador puede leerlos sin hardcodear.

## Armamento
```js
const hp = n('HP_03');                    // HP_01 (ala izq. exterior) … HP_06 (línea central) … HP_11 (ala der. exterior)
hp.add(bombMesh);                         // el origen del arma = origen del HP; morro del arma hacia -Z, arriba +Y
// al soltar: hp.getWorldPosition / getWorldQuaternion y mover el arma al mundo
n('HP_GAU8_Muzzle').getWorldPosition(p);  // aparición de proyectiles y fogonazo, dirección = eje local -Z
```
Los HP no giran con la deflexión de superficies y apuntan siempre a ejes del avión (orientación identidad).
Posiciones X de las estaciones: ±7.35, ±6.25, ±5.15, ±4.05, ±3.15 y 0 (ventral).

## LOD
```js
const lod = new THREE.LOD(); lod.addLevel(jet0, 0); lod.addLevel(jet1, 350); lod.addLevel(jet2, 1200);
```
Los tres comparten nombres: puedes animar solo el nodo visible o sincronizar los tres con la misma función `applyPose(jet)`.

## Limitaciones conocidas (lee esto antes de integrar)
- **Ruta Blender sin probar.** No tengo Blender en mi entorno: el GLB lo genera directamente el script (validado y renderizado aquí), pero `build_in_blender()` / el `.blend` **no se ejecutaron**. Si falla, el GLB directo es equivalente.
- **Aspecto procedural**: proporciones y rig son fieles, pero no iguala el detalle de un modelo esculpido a mano (sin remaches reales en geometría; paneles/remaches/mugre van en una textura procedural 512² con normal map).
- Flaps = abisagrados simples (sin traslación Fowler). Camuflaje: un solo gris + banda azul en deriva; sin decales.
- El visor y la carga en Three.js **no se probaron en navegador** (solo comprobada la sintaxis JS con Node); el GLB se validó con un parser propio (accesores, límites, índices, nombres únicos).
- Longitud 16,32 m · envergadura 17,49 m · altura 4,53 m medidas sobre el GLB exportado.

## War Browser integration

The detailed GLB in the game is the supplied repository asset. The two
lower-detail GLBs were regenerated with the supplied Python generator.
The generator reproduced the detailed asset's vertex and texture buffer
and its node transforms. The original detailed GLB remains the source for
the highest detail level. Each asset is cached, and aircraft instances
share its geometry and materials. Lower detail omits selected cosmetic
meshes and keeps the animated hinges and attachment nodes.

The runtime rotates the cloned visual subtree once into simulator
coordinates. It checks every store attachment and cannon muzzle against
the aircraft configuration in all three assets. Rendering selects the
detail level with distance hysteresis and applies the current pose when
switching levels. The A-10C uses the shared flight, damage, weapons, and
targeting systems. All flight and weapon parameters are game-tuned.
