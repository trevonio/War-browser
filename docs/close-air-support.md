# Close air support architecture

Stage 2.6 exposes extension points for a future single-player ground battle.
Current missions use the existing cannon and air-to-air weapon paths.

## Aircraft and stores

The aircraft registry continues to supply aircraft-specific station names,
body-space offsets, and attachment components. The F-16C profile allows
the `ground` weapon domain for future loadouts. The F-15C profile allows
the `air` domain only. A station without a domain keeps the current air
default. This capability describes which future loadouts the registry
can accept. Current weapon selection and firing only offer the implemented
air combat weapons.

A mission can assign a store to a station with optional
`payload: { mass, drag }`, in kilograms and additive drag-coefficient units.
The weapon rack contributes the total for attached items to `Flight`.
It recalculates the total after an existing weapon successfully leaves its
station or after the rack observes that an attachment has failed. Legacy
loadouts retain their existing aggregate stores mass and drag. A future
loadout should account for any equipment already included in that aggregate
before assigning per-store values. The stores visibility key continues to
control the legacy presentation and aggregate terms.

When adding simulated unguided bombs, guided bombs, rockets, and guided
missiles, define each as a store with a release behavior. Keep station
compatibility and model attachment in aircraft data. The existing air
missile seeker and its flight loop can stay specific to air combat. A
future release controller can consume the same inventory and payload
accounting after validating its own conditions.

## Battlefield state and damage

A future battle should live with the sortie so restarts reset ground
units, objectives, sensor observations, and effects together. Use stable
entity identities and mission-defined factions, with friendly and hostile
relationships resolved by the mission. Tank, armored vehicle, truck,
artillery, and air-defense definitions can provide their own movement,
component layout, and visual assets.

The shared `ComponentHealth` pool already supports named components,
independent wear, excess damage, and reset. Ground vehicle code can use
it for crew, mobility, and equipment while applying vehicle-specific
disable and destruction rules. Projectile colliders can associate a
component with a `damageTarget` that handles the impact. The cannon
dispatcher can call that receiver alongside its existing aircraft and
practice-drone paths.

Use an independent ground controller for ground movement and engagement,
with air AI retaining its own flight controller. Both consume the
current simulation state and publish changes for the mission. Advance
the ground battle even when the pilot is elsewhere. Objectives such as
protecting a friendly unit, holding an area, or disabling a formation
can evaluate mission events and produce the existing win, loss, or draw
outcome.

## Sensors and sights

Keep ground detection with a ground sensor adapter. Publish observed
target identity, position, observation time, and quality. Display and
targeting consumers can then work from those observations, including
when the target becomes obscured or the observation expires. A future
targeting pod can publish the same observations. Assign permission to
observe a target and permission to engage it separately, using the
mission's faction relationships.

The existing cannon CCIP and lead computer stays on the airframe. Future
bomb CCIP and CCRP can have their own cue providers using the selected
store, observed target, and simulated terrain. Keep cues, release decisions,
and mission scoring separate so changing a display mode has no effect on
the underlying ground battle.

## Scale and lifecycle

The browser's fixed-step loop can advance a sortie-owned ground battle
alongside air combat, before collision checks use the frame's previous
and current positions. A future spatial index can supply nearby collision
volumes through the ballistic segment query. That query must return all
candidate structures and entities for the sweep. The existing collision
code still selects the closest impact and handles terrain independently.

Share geometry and materials by unit type. Use batched instances and
low-detail silhouettes for distant units, and separate the rate of AI
decisions and rendering updates from the rate at which mission outcomes
advance. Distant battles can continue at a coarser simulation cadence
while preserving unit state, events, and objective progress. Remove the
ground battle and its render resources during sortie disposal.
