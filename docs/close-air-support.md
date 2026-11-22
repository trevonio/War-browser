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
