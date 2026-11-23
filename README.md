# War Browser · Fighting Falcon

A single-player, desktop browser flight simulator. Fly the F-16C or F-15C,
practice on the coastal range, or take on AI opponents. The F-16C can also
support a moving ground battle and intercept a convoy.

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
frame timing, draw calls, triangles, and angle of attack. In the two dynamic
ground missions, it also shows each ground unit’s route, contacts, and damage.

GitHub Actions runs the production build in Chromium and Firefox. To repeat
the browser checks after building, run `npx playwright install chromium firefox`
and `npx playwright test` from a graphical session. On headless Linux, run
`xvfb-run -a npx playwright test`. The frame-pacing check uses software WebGL in CI.

## Default controls

| Input | Action |
| --- | --- |
| Mouse | Move the world-space aim point in Mouse assist mode |
| Hold left mouse | Fire the internal cannon while in flight |
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
| Esc / Enter / R | Release the mouse and pause / start or resume / restart |

Start or resume with a click or Enter to capture the mouse. Switching tabs or
losing window focus pauses the flight and clears held inputs. If capture is
denied, the pause menu lets you retry or fly with the keyboard. The small
circle marks the desired direction within a bounded area of the HUD. A
chevron indicates when the view is still catching up to a large input. The
wing-shaped boresight marks the F-16's nose. The mouse keeps turning the view
through that boundary and across vertical.

Settings let you rebind keys, select direct keyboard controls, set mouse and
camera sensitivity, invert mouse Y, tune instructor responsiveness, adjust
mouse-camera turning and chase smoothing separately, and choose a graphics
preset.

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
cloud count and water detail.

## Flight model

The flight state advances in fixed 1/120-second steps independently of the
Three.js view. It uses SI units and integrates force into velocity and position.
Lift and drag are proportional to dynamic pressure and wing area. Induced drag
scales with the square of lift coefficient. The model includes an approximate
standard atmosphere, Mach-dependent drag and control effectiveness, a
post-stall lift falloff, thrust and spool lag, fuel burn, and gear and airbrake
drag. Positive and negative G-load drive timed visual effects, and sustained
overload can end a flight. The HUD indicates high positive or negative G
from the measured load factor. Mouse aim feeds the chase camera and instructor
a shared direction in three dimensions. The instructor computes a turn plane
from the current flight path and target, banks the lift vector toward that
plane, and uses available positive G for large turns and dives. It allows
gentle pushovers using negative G. The chase camera follows the requested view
while its boom stays anchored to the jet. The flight model sets available
trim, angular authority, and lift.

Nominal dimensions and engine ratings anchor the F-16 configuration. The
aerodynamic curves, loaded masses, fuel flows, low-speed and transonic control
limits, and fly-by-wire response are game-tuned approximations. Angular rates
follow damped control laws. The ground model uses a single aircraft clearance
point and a simplified runway surface.

The aircraft-specific data and visual adapter live in `src/aircraft/`.
`src/sim/` owns flight state and terrain queries. `src/view/` owns scene
rendering and the camera. The external stores affect appearance, mass, and drag.


## Cannon range

Select **Cannon range** in the briefing for one stationary sighting drone and two
crossing drones. The wing-shaped sight stays aligned with the cannon. The mouse
circle commands the aircraft's maneuver. The launcher supplies 510 rounds and
fires 100 rounds per simulated second (6,000 RPM). The same loadout is available
in free flight. Restarting restores ammunition and the exercise. The external
stores toggle controls the separate wing stores.

The emitter sits on the port side of the supplied procedural model. Projectiles
inherit aircraft velocity and travel under gravity and simplified drag. Sweeps
test the height field, water, hangars, and moving drone hit volumes. One round in
five has a tracer. All rounds share the collision simulation. Projectile speed,
drag, drone durability, and the model attachment are game-tuned approximations.

An original synthesized loop provides cannon audio without requiring a download.
Tracers use one line batch, and muzzle smoke, dust, splashes, and sparks use a
fixed particle pool sized by the graphics preset. Drone damage is represented
by durability per target.

## Dogfight

Choose **Dogfight** in the briefing and select an AI opponent. Passive flies
a patrol, Defensive breaks away if pursued, and Aggressive tries to intercept
and fire its cannon. The amber diamond marks the other F-16 when it is in
view. The combat readout shows range and airframe integrity. Restarting
restores both aircraft, their ammunition, and the selected opponent's spawn.

The opponent uses the same fixed-step flight model, instructor, and cannon
simulation as the player. Its alternate paint shares the existing F-16
geometry and texture maps. Aircraft hit volumes follow each airframe through
the same swept projectile checks used on training targets.

## Flight controls and component damage

The supplied rigged F-16 uses separate named mesh pivots. The adapter keeps
its body axes, 0.93 scale, and existing cannon and stores attachments. The
leading-edge flaps, left and right flaperons and stabilators, and rudder take
their positions from the fixed-step control outputs. The low-speed gear
configuration deploys both flaperons together, and roll adds differential
travel. The supplied struts, wheels, gear doors, and airbrakes have their
own pivots. Player and opponent instances share geometry and textures.

Shots can hit the engine, wings, stabilators, flaperons, fuel system,
fuselage, or pilot. Wing damage changes lift, drag, roll balance, and load
limits. Severe actuator damage can jam a surface at its current angle.
Engine fires can lead to power loss, and a fuel leak drains the remaining
fuel. The AI disengages or glides when damage warrants it. A wing or flight
surface can disappear at its modeled attachment point. Craft loss ends the
dogfight, and restarting repairs both aircraft.

## Gun computer

Press **C** to toggle the gun computer and **M** to switch between CCIP
and lead. Both bindings are configurable. CCIP shows the first terrain,
water, or structure intersection predicted by the cannon's projectile
model. In a dogfight, lead requires a visible contact near the gun axis.
The visual track estimates range from apparent size and estimates velocity
from successive observations. **Training Lead** in the cannon range uses
drone telemetry. The computer displays a cue and leaves the rounds on
their simulated trajectory.

## Missile exercises

**Missile dogfight** starts a close-range encounter with two IR missiles.
**BVR intercept** adds two active radar missiles and starts with an inbound
contact beyond the visual marker range. **Outnumbered** starts two inbound
F-16Cs with staggered arrivals and gives the player 260 cannon rounds, one IR
missile, one radar missile, four flares, and four chaff releases. Destroy both
opponents to win. **Dogfight** remains the guns-only exercise. Rookie, Regular,
and Veteran change
the AI's decision and reaction timing. Both sides use the same launch checks,
aircraft physics, and quantities.

| Input | Action |
| --- | --- |
| 1 / 2 / 3 / 4 | Select cannon / IR / radar missile / cycle |
| Left click / Space | Fire the selected weapon |
| P / T / L | Power the radar / select contact / lock or unlock |
| Y / U / I | Change search mode / scan range / show or hide the scope |
| J / K | Release a flare / chaff |
| N / O | Cycle missile views / switch between your active missiles |
| Z / V | Toggle selected-target view / return to aircraft view |

The scope shows sampled, approximate observations. Search has a slower scan.
TWS refreshes multiple contacts, and STT supports one radar missile track at a
time. **CLEARED** indicates that the selected missile can be launched. The
radar missile initially uses the aircraft's available track and can coast if
updates stop. Its active seeker can attempt to acquire the contact later in
flight. The warning receiver reacts to in-game search, track, and active
seeker emissions.

The missile envelopes, seeker signals, clutter and countermeasure effects are
gameplay approximations tuned for the coastal map. Missiles travel as separate
objects with time-limited boost, steering, and life. Flares and chaff drift and
fade, and can interfere with their matching seekers. A blast can damage several
nearby aircraft components. The existing stores toggle controls their
appearance, and an available hardpoint can fire while its model is hidden.

Target markers use radar or recent visual observations. A fading edge arrow
indicates the last known direction until the observation expires. The optional
target and missile cameras leave flight and keyboard controls active. Combat
results report opponents down, rounds fired and hits, missiles launched and hits,
damaged aircraft components, and mission time.

## Aircraft selection and flight testing

Use **Choose aircraft** in the briefing to compare and rotate the F-16C and
F-15C. The selected airframe persists in the browser. Combat briefings also
let you assign either type to the opposing side and choose the second
opponent independently in Outnumbered. Restarting a mission keeps those
choices. Free flight includes air and runway starts, with optional live mass,
thrust, angle-of-attack, heading-rate, engine and fuel measurements. Test
options can refill the cannon and disable structural wear. Terrain and runway
collisions still end a failed flight.

The F-16C has faster roll response. The heavier F-15C uses two engines, a
slower roll response, different lift and drag, greater combined thrust and a
different radar scan profile. The Eagle’s cannon carries 940 rounds at full
capacity. Its intercept loadout carries four IR and four radar missiles,
while Outnumbered limits both aircraft to 260 cannon rounds, one missile of
each type, four flares and four chaff releases. These quantities and all
displayed performance figures describe this simulation. Public descriptions
of the Eagle anchor the airframe’s twin-engine layout and general dimensions.
[U.S. Air Force F-15 fact sheet](https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104501/f-15-eagle/)

Aircraft entries in `src/aircraft/registry.js` pair configuration with a
lazy-loaded visual adapter. The shared flight solver, instructor, weapons,
sensor, damage and AI systems consume those profiles. Each engine tracks
its own spool, thrust, fuel consumption, burner and component damage.
Unequal thrust creates a yaw moment. The visual adapters bind the final
simulated surface positions and gear state to their respective models.

The Eagle is an original procedural prototype. Its ailerons, stabilators,
rudders, flaps, speed brake, gear and exhaust move, with simplified linkage
geometry and no cockpit interior. The visual adapter can accept a replacement
model while retaining the same flight and combat configuration. The hangar
reuses the main WebGL renderer to generate previews. Within a session,
templates share geometry and materials across aircraft, distant opponents
use simpler silhouettes, and switching releases the outgoing effects pools.

The [close air support architecture notes](docs/close-air-support.md)
describe how the current ground missions use the aircraft registry, store
payloads, visual contacts, and mission lifecycle.

## Custom loadouts and ground attack range

Open **Loadout** from mission preparation or **Configure loadout** in aircraft
selection. Choose a preset or mount stores by station, then apply the loadout.
Saved names and the active configuration live in the browser. **Restore
mission default** restores the original mission equipment.

The F-16C has seven configurable stations. Its wingtips take infrared
missiles, the outer pylons take radar missiles or range bombs, the inboard
pylons take bombs, rocket pods, or tanks, and the centerline takes a fuel
tank. The F-15C has eight air-to-air missile stations and three possible
fuel tank locations. The simulator validates station capacity and clearance.
Air combat missions retain their existing equipment restrictions. Outnumbered
uses its fixed mission loadout.

Custom loads replace the legacy aggregate store terms with attached mass,
drag, remaining rocket and cannon ammunition, and external fuel. Tanks feed
the aircraft before its internal supply. Press **8** to jettison one tank.
The stores visibility toggle hides the models and leaves custom store mass
and drag attached. The shared solver accounts for total mass and drag.
Asymmetric store placement has no separate inertia or center-of-mass model.

Choose **Ground attack range** with the F-16C to practice on two trucks, two
armored targets, and a shelter. Use **5** for bombs, **6** for rockets, and
**1** for the cannon. **C** toggles the impact cue and **Space** releases the
selected weapon. Set single, paired, ripple, or salvo release in the
briefing. **9** rearms the range weapons without clearing the mission tally.
The first ground impact comes from the same fixed-step movement and collision
calculation used by prediction. The mission tracks actual releases, rounds,
targets hit, and targets disabled. Ground equipment, payload restrictions,
projectile behavior, and effects use simulator tuning for this map. The
[CAS extension notes](docs/close-air-support.md) describe the next steps for
ground AI, sensors, additional weapon families, and battlefield objectives.

## Dynamic ground missions

Choose the **F-16C** and select **Battlefield support** or **Convoy
interdiction**. Both missions supply the **Ground Attack** preset by default.
You can use your own compatible loadout.

- In **Battlefield support**, two ground columns advance and fight for Relay
  crossing. Ground forces can capture it while you fly elsewhere. The HUD
  shows accumulated control and losses.
- In **Convoy interdiction**, stop the three marked transports before any
  reaches the exit. Immobilizing a transport counts. Escorts can survive.
- Press **T** to cycle among visually identified contacts. The optional
  briefing checkbox marks all current visual contacts. Both displays rely
  on line of sight. The mission objective is shown on the terrain.
- Use **1**, **5**, and **6** to select the cannon, bombs, and rockets.
  **C** toggles the ballistic sight and **Space** fires the selected weapon.
  Aircraft weapons can hit either faction. The debrief reports friendly fire.
  Weapons rearm on restart. The separate **Ground attack range** still
  supports in-flight rearming.

Ground battles and convoy movement advance during unpaused flight regardless
of player distance. The F-15C retains its air-to-air role.

## Close Air Support

Choose **Close Air Support** from mission preparation and select **Armored
Breakthrough**, **Convoy Protection**, **Emergency Air Support**, or
**Battlefield Interdiction**. The briefing shows the primary and secondary
objectives, friendly starting forces, available intelligence, and the
recommended **Ground Attack** preset. CAS uses the F-16C. Its existing loadout
editor and gun, bomb, and rocket controls apply.

Enter a mission seed to reproduce its starting conditions or choose **Generate
scenario** to draw another setup. Difficulty changes force composition,
deadlines, AI reactions, and the detail and lifetime of ground reports.
Training contact markers have their own checkbox.

Press **Tab** for the tactical map. The map pauses the sortie and releases the
mouse. Use the wheel or zoom buttons to zoom and drag or use the arrow keys
to pan. Select an objective, known contact, or support request. Choose
**Return to flight** to recapture the mouse. The reported area marker is an
estimate from the call. Use the separate visual contact and existing CCIP
cues for the attack. Press **T** to cycle current visual contacts or available
ground reports.

After a mission, use **Restart same scenario** to replay its seed, **Generate
another scenario** for a new setup, or return to the CAS briefing to change
the loadout or difficulty. The debrief includes objective states, accepted
calls completed, actual unit losses, friendly fire, ammunition spent, airframe
damage, and sortie duration.

During mouse-aim flight, small sideways aiming errors use rudder assistance
and limited bank. Larger errors progressively command a coordinated turn.
Free flight's **Measurements** option includes bank and sideslip.
