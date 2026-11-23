# Close air support architecture

Stage 2.8 adds two preliminary F-16C missions on the coastal terrain.
Battlefield Support simulates two six-vehicle forces fighting for Relay
crossing. Convoy Interdiction tracks three transports and their escorts on
a shared route. Both missions use their actual vehicle state to decide the
outcome. The F-15C continues to accept air-to-air stores.

## Ground state and navigation

`src/sim/ground/vehicles.js` defines original tank, infantry fighting
vehicle, armored personnel carrier, and logistics truck profiles. Each role
supplies dimensions, movement, directional protection, component durability,
detection, and any weapon. Missions assign faction and objective when
spawning vehicles. Ground controllers run separately from air AI.

The road graph validates slopes, water, and solid obstacles against the
coastal terrain. It supplies a shortest valid route for the convoy.
Battlefield columns advance on parallel waypoints. Vehicles accelerate,
brake and steer with bounded rates. Terrain samples set height, pitch,
and roll. Clearance checks space the convoy around other vehicles and
wrecks. A timed recovery tries local detours when a vehicle stops making
progress. Wrecks obstruct movement for 15 simulated seconds and remain
visible for up to 47.

## Engagement and damage

Units scan a limited sector and range, check terrain and structure
occlusion, react after a delay, and forget unseen contacts. Tanks favor
enemy armor. IFVs favor lighter targets and may reposition away from
tanks. APCs use short-range weapons, and transport trucks prioritize
delivery. Difficulty changes awareness, reaction and aiming without
changing the vehicle specification.

Turrets traverse and elevate independently within bounded angles and
rates. A weapon uses its muzzle position, alignment, clear line of
sight, reload time, and remaining ammunition. Ground rounds reuse
the flight projectile integrator and swept collision. Accidental
hits can occur when an ally crosses a projectile path.

Similarly to aircraft, vehicles use the shared `ComponentHealth` pool.
Front, side, rear and upper armor change the amount of damage reaching
the hull, engine, running gear, turret, weapon, ammo or crew. An
immobilized vehicle can keep fighting. The cannon uses moving component
colliders, rockets apply direct and local impact damage, and bomb
damage falls off across nearby vehicles. Damage attribution feeds the
debrief and records friendly fire. Protection and ammunition tuning use
fictional game values.

## Identification and performance

The mission announces a known objective. A separate optical observer
provides contact identity, faction, range, recent position, and expiry.
The sight remains the existing ballistic predictor. Displaying a
contact has no effect on flight or weapon behavior. The development URL
`?debug` adds vehicle state, route, target, line of sight and component
health to the HUD.

Navigation planning and scans use multiple update rates based on
distance and active engagement. Vehicle position and swept collision
remain continuous at the sortie's fixed simulation step. Shared
instanced meshes, per-vehicle frustum checks, simplified silhouettes,
and pooled rounds, tracers and effects limit rendering work. Projectile
queries narrow their collision candidates against the current segment.

## Limits and next stage

The two missions share one coastal battlefield. Navigation follows
authored routes with local detours and can be constrained by tightly
clustered permanent obstacles. Ground models use procedural silhouettes
and simple running gear animations. Detection is optical and local.
The current air-to-ground weapons share the existing unguided ballistic
model. The missions do not include targeting pods, CCRP, dedicated air
defenses, or campaign progression.

A next CAS stage can connect mission reports and a targeting pod to a
shared observation feed. Aircraft-specific hardpoints and the existing
payload accounting already supply mass, drag, and compatibility data.
Add a mission-specific provider for CCRP when it needs an observed
target and a release cue. Profile hardware-accelerated WebGL and use
a spatial index for collision and detection before increasing the
density of active ground forces beyond the current benchmark.

## Stage 2.9 mission director

The dedicated CAS briefing creates a plan from a template, seed, and
difficulty. It passes the plan to the existing ground battle. The seed
sets starting locations, vehicle roles, convoy road branches, and the relief
window. Route segments use the coastal terrain and road graph. Normal
missions cap active ground forces at 18.

Armored Breakthrough accumulates time with superior friendly strength inside
the crossing. Convoy Protection requires transports to reach a checkpoint.
Emergency Air Support measures operational vehicles in the surrounded group
and time under reduced pressure. Battlefield Interdiction measures actual
transport arrivals and immobilizations. Each mission has a scenario deadline
and a separate secondary objective.

The director runs several times per simulated second. Its support calls come
from friendly observers with a current sightline to a threat in weapons range.
Calls expire, withdraw, or close when the reported threat is stopped. Ground
reports store snapshots rounded to an area. Recent cockpit observations have
their own source and expiry. The tactical map draws those records, friendly
positions, objectives, and route intelligence over a cached terrain raster.
The map pauses flight while the pointer is available. A saved aim direction
carries back into flight when capture is restored.

Battle damage changes the simulated force before the director evaluates the
next objective update. The director also records distinct friendly vehicles
struck by the player and emits radio warnings. Development `?debug` shows
the seed, director phase, unit counts, relief status, contact count, and
support requests alongside the ground and renderer diagnostics. The briefing
reuses a rendered backdrop until the view changes. The debrief keeps the
last view after a short period for impact and smoke effects.

Stage 2.9 uses text radio on the authored coastal sector. Further priorities
are hardware-WebGL profiling, additional route networks and terrain sectors,
and a shared sensor feed for future CAS avionics.

## Stage 3.0 precision avionics

The pod owns an independent perspective camera. Aircraft orientation
defines which points are inside the mount's view limits. During area or
point tracking, the camera follows a world-space ray with a damped
transition and a world-level up vector. Pod slew consumes captured mouse
movement while the existing flight input retains its aim. The day and two
thermal presentations share the same scene and use one render pass.
Graphics presets set the pod pixel ratio. Thermal materials shade the
cold terrain independently from moving vehicle engines, cooling wrecks
and hot particles.

A designation carries a position, target identity where observed, a
timestamp, confidence and validity. The map can cue the pod using
known reports. A point track updates its reported position only while
the pod has a valid sightline. The coordinate weapon uses a separate
saved snapshot.

All three precision stores use the same release inventory, flight integrator,
swept collision, and ground component damage as range ordnance. The laser
store coasts if its spot is masked. The coordinate store retains its release
fix. The optical store has a limited in-flight seeker and a finite motor
burn. The combat camera can follow an actual launched optical store.

A mobile gun and a radar launcher use ground vehicle damage and scheduled
terrain visibility queries. Ground gunfire uses pooled ballistic rounds.
The launcher reuses the existing air missile pool, seeker, and chaff
response. The RWR instruments actual emissions. Specific dynamic seeds can
also spawn one allied support aircraft with one optical store, using the
same observation and release checks as the player.

Precision Strike ends when its assigned targets are disabled. Air Defense
Suppression ends when the gun and launcher lose firing capability.
The current release uses game-tuned sensors, signatures, propulsion, and
guidance on the coastal terrain.
