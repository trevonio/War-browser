# War Browser · Fighting Falcon

A single-player, desktop browser flight simulator. Stage 1 includes a coastal
free-flight range with an airborne F-16C start and a runway start for takeoff and
landing practice.

## Run locally

Requires Node.js 22.12 or later in the 22.x line, or Node.js 24 or later, and
a desktop browser with WebGL 2.

```sh
npm ci
npm run dev
```

Open the URL Vite prints. Run `npm test` for fixed-step simulation checks and
`npm run build` to produce the static site in `dist/`. For a local production
check use `npm run preview`. Append `?debug` to the **development** URL for
frame timing, draw calls, triangles, and angle of attack.

GitHub Actions runs the production build in Chromium. To repeat its browser
checks locally after building, run `npx playwright install chromium` and
`npx playwright test`. The frame-pacing check uses software WebGL in CI.

## Default controls

| Input | Action |
| --- | --- |
| Mouse | Command bank and flight path in Mouse assist mode |
| W / S | Pitch up / down |
| A / D | Roll left / right |
| Q / E | Yaw left / right |
| Left Shift / Left Ctrl | Raise / lower throttle |
| B | Toggle afterburner. Engagement requires engine spool-up. |
| G | Extend or retract landing gear in the air |
| H | Show or remove the external stores and change the loaded mass |
| X | Toggle the airbrake or wheel brakes |
| V | Switch between chase and nose HUD views |
| Right mouse or F + move | Free look |
| Mouse wheel | Adjust chase distance |
| Esc / R | Pause or resume / restart from the selected start |

Settings let you rebind keys, select direct keyboard controls, invert vertical
mouse aim, adjust sensitivity, and choose a graphics preset.

For a runway start, keep the controls centered, apply full throttle, then hold
W near 125 knots to rotate. Retract the gear once safely airborne. The runway
contact model requires extended gear, alignment with the runway, a shallow
descent, and a manageable touchdown attitude.

## Stage 0 inspection

The GitHub repository started with no refs, source, or framework. The supplied
F-16 file is a standalone Spanish Three.js r128 viewer. It contains the geometry
and materials inline. The fuselage uses indexed cross-section lofts. The
lifting surfaces are extrusions. The canopy, wheels, nozzle, and stores use
procedural primitives and lathes. The skin uses generated canvas maps. There
are no external meshes or textures.

The original aircraft group is centered near the fuselage, faces local +Z,
uses +Y up, and has a 0.93 visual scale, giving roughly one meter per modeling
unit. The viewer uses an orbit camera, directional and hemisphere lighting,
environment reflections, and a shadow map. The canopy has exterior detail
and basic pilot geometry.

- The afterburner is a group containing two additive exhaust cones and a
  point light. The original loop pulses the cones when the group is visible.
- The armament toggle shows or hides a group of mirrored wingtip and
  underwing meshes. The adapter exposes the existing station transforms.
- The landing gear is made of separate strut, wheel, and door meshes. The
  original toggle changes group visibility instantly. The adapter adds an
  eased transition to the same geometry.
- The viewer has no bones or animation clips. It changes object transforms
  and visibility and blinks a tail strobe.

The simulator uses current Three.js and WebGL 2 through Vite. It reuses the
user-supplied geometry and materials. The flight scene uses image-based
reflections and direct lighting with no per-frame aircraft shadow map. Terrain
tiles use bounded memory and are regenerated as the aircraft moves. The
graphics presets adjust render resolution, terrain subdivisions, and visible
cloud count.

## Flight model

The flight state advances in fixed 1/120-second steps independently of the
Three.js view. It uses SI units and integrates force into velocity and position.
Lift and drag are proportional to dynamic pressure and wing area. Induced drag
scales with the square of lift coefficient. The model includes an approximate
standard atmosphere, Mach-dependent drag and control effectiveness, a
post-stall lift falloff, thrust and spool lag, fuel burn, and gear and airbrake
drag. Positive and negative G-load drive timed visual effects, and sustained
overload can end a flight.

Nominal dimensions and engine ratings anchor the F-16 configuration. The
aerodynamic curves, loaded masses, fuel flows, low-speed and transonic control
limits, and fly-by-wire response are game-tuned approximations. Angular rates
follow damped control laws. The ground model uses a single aircraft clearance
point and a simplified runway surface.

The aircraft-specific data and visual adapter live in `src/aircraft/`.
`src/sim/` owns flight state and terrain queries. `src/view/` owns scene
rendering and the camera. At this stage the external stores only affect
appearance, mass, and drag. The next milestone is a small single-player
intercept scenario with one AI aircraft and game-tuned combat systems.
