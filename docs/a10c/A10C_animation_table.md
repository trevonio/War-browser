# A-10C animation mapping table (auto-generated)

All angles in **degrees**, applied as `node.rotation.<axis> = radians(angle)` on the **named** node.
The `*_Pivot` parent is static: it carries the hinge position/orientation, so the animated node is at identity (0°) in its neutral pose.
Left/right pairs share the same sign convention (e.g. positive aileron/elevator/flap angle = trailing edge DOWN on both sides).

| Node | Static pivot (parent) | Pivot pos (m) | Axis | Positive direction | Min | Max | Neutral |
|---|---|---|---|---|---|---|---|
| `Canopy` | `Canopy_Pivot` (in `A10C_ROOT`) | (0, 0.4853, -2.38) | X | front edge lifts (opens) | 0 | 55 | 0 |
| `Flap_Right` | `Flap_Right_Pivot` (in `A10C_ROOT`) | (1.2, -0.4485, 0.9932) | X | trailing edge down (deploy) | 0 | 40 | 0 |
| `Flap_Left` | `Flap_Left_Pivot` (in `A10C_ROOT`) | (-1.2, -0.4485, 0.9932) | X | trailing edge down (deploy) | 0 | 40 | 0 |
| `Aileron_Right` | `Aileron_Right_Pivot` (in `A10C_ROOT`) | (4.6546, -0.2743, 0.5653) | X | trailing edge down | -25 | 20 | 0 |
| `Deceleron_Right_Upper` | `Deceleron_Right_Upper_Pivot` (in `Aileron_Right`) | (-0.002, 0.1201, 0.0117) | X | NEGATIVE angle opens (trailing edge up) | -55 | 0 | 0 |
| `Deceleron_Right_Lower` | `Deceleron_Right_Lower_Pivot` (in `Aileron_Right`) | (-0.0011, -0.1209, 0.0117) | X | positive angle opens (trailing edge down) | 0 | 55 | 0 |
| `Aileron_Left` | `Aileron_Left_Pivot` (in `A10C_ROOT`) | (-4.6546, -0.2743, 0.5653) | X | trailing edge down | -25 | 20 | 0 |
| `Deceleron_Left_Upper` | `Deceleron_Left_Upper_Pivot` (in `Aileron_Left`) | (0.002, 0.1201, 0.0117) | X | NEGATIVE angle opens (trailing edge up) | -55 | 0 | 0 |
| `Deceleron_Left_Lower` | `Deceleron_Left_Lower_Pivot` (in `Aileron_Left`) | (0.0011, -0.1209, 0.0117) | X | positive angle opens (trailing edge down) | 0 | 55 | 0 |
| `Elevator_Right` | `Elevator_Right_Pivot` (in `A10C_ROOT`) | (0.6, 0.3, 7.643) | X | trailing edge down (nose-down command) | -30 | 20 | 0 |
| `Elevator_Left` | `Elevator_Left_Pivot` (in `A10C_ROOT`) | (-0.6, 0.3, 7.643) | X | trailing edge down (nose-down command) | -30 | 20 | 0 |
| `Rudder_Right` | `Rudder_Right_Pivot` (in `A10C_ROOT`) | (2.9674, 0.4992, 7.3411) | Y | trailing edge toward +X (starboard) | -30 | 30 | 0 |
| `Rudder_Left` | `Rudder_Left_Pivot` (in `A10C_ROOT`) | (-2.9674, 0.4992, 7.3411) | Y | trailing edge toward +X (starboard) | -30 | 30 | 0 |
| `EngineFan_Right` | `EngineFan_Right_Pivot` (in `Engine_Right`) | (0, 0, 0) | Z | right-hand about +Z (continuous spin) | continuous | continuous | 0 |
| `EngineFan_Left` | `EngineFan_Left_Pivot` (in `Engine_Left`) | (0, 0, 0) | Z | right-hand about +Z (continuous spin) | continuous | continuous | 0 |
| `LandingGear_Right` | `LandingGear_Right_Pivot` (in `A10C_ROOT`) | (2.35, -0.9, -0.3) | X | POSITIVE = retract (leg swings forward/up into sponson) | 0 | 86 | 0 |
| `Wheel_Right` | `Wheel_Right_Pivot` (in `LandingGear_Right`) | (0, -0.75, 0) | X | spin (rolling forward = negative) | continuous | continuous | 0 |
| `LandingGear_Left` | `LandingGear_Left_Pivot` (in `A10C_ROOT`) | (-2.35, -0.9, -0.3) | X | POSITIVE = retract (leg swings forward/up into sponson) | 0 | 86 | 0 |
| `Wheel_Left` | `Wheel_Left_Pivot` (in `LandingGear_Left`) | (0, -0.75, 0) | X | spin (rolling forward = negative) | continuous | continuous | 0 |
| `GearDoor_Main_Right` | `GearDoor_Main_Right_Pivot` (in `GearDoors`) | (2.6116, -1.0816, -0.1) | Z | Right: +Z opens; Left: -Z opens (swing outboard/down) | 0 | 80 | 0 |
| `GearDoor_Main_Left` | `GearDoor_Main_Left_Pivot` (in `GearDoors`) | (-2.6116, -1.0816, -0.1) | Z | Right: +Z opens; Left: -Z opens (swing outboard/down) | -80 | 0 | 0 |
| `GearDoor_Nose_Right` | `GearDoor_Nose_Right_Pivot` (in `GearDoors`) | (0.64, -0.722, -4.7) | Z | Right: +Z opens; Left: -Z opens | 0 | 80 | 0 |
| `GearDoor_Nose_Left` | `GearDoor_Nose_Left_Pivot` (in `GearDoors`) | (0.04, -0.8567, -4.7) | Z | Right: +Z opens; Left: -Z opens | -80 | 0 | 0 |
| `LandingGear_Nose` | `LandingGear_Nose_Pivot` (in `A10C_ROOT`) | (0.34, -0.55, -4.85) | X | NEGATIVE = retract (leg swings rearward into fuselage) | -90 | 0 | 0 |
| `Wheel_Nose` | `Wheel_Nose_Pivot` (in `LandingGear_Nose`) | (0, -1.25, 0) | X | spin | continuous | continuous | 0 |
| `GAU8_Barrels` | `GAU8_Barrels_Pivot` (in `CannonMuzzle`) | (0, -0.6, -7.7) | Z | barrel cluster spin (optional, continuous) | continuous | continuous | 0 |

## Gear sequencing

`g` = retraction 0..1 (0 = down & locked, 1 = up & locked)

- Main legs: `rotation.x = +86° * g` (swing forward into the sponsons; wheels stay partly exposed like the real jet)
- Nose leg: `rotation.x = -90° * g` (swings rearward into the fuselage)
- Doors: open fraction `d = clamp((1-g)*1.6, 0, 1)`; right doors `rotation.z = +80°*d`, left doors `rotation.z = -80°*d`
- Wheel spin: `Wheel_*` rotation.x -= groundSpeed*dt/radius (radius 0.45 m main, 0.30 m nose)

## Speed-brake (deceleron) mixing

For roll command `r` (-1..1, +1 = roll right) and brake `b` (0..1): `Aileron_Right.rotation.x = -r*20°` (up), `Aileron_Left.rotation.x = +r*20°` (down);
upper skins `rotation.x = -55°*b`, lower skins `rotation.x = +55°*b` (they are children of the aileron, so roll and braking add).

## Hierarchy

```
A10C_ROOT
  Fuselage [mesh]
  Nose [mesh]
  Fuselage_Details [mesh]
  Canopy_Pivot   (static pivot)
    Canopy   <-- ANIMATED (canopy, axis X)
      Canopy_Glass [mesh]
      Canopy_Frame [mesh]
  Cockpit
    Cockpit_Interior [mesh]
    HUD_Glass [mesh]
  Wing_Right [mesh]
  Wing_Left [mesh]
  Flap_Right_Pivot   (static pivot)
    Flap_Right [mesh]   <-- ANIMATED (flap, axis X)
  Flap_Left_Pivot   (static pivot)
    Flap_Left [mesh]   <-- ANIMATED (flap, axis X)
  Aileron_Right_Pivot   (static pivot)
    Aileron_Right [mesh]   <-- ANIMATED (aileron, axis X)
      Deceleron_Right_Upper_Pivot   (static pivot)
        Deceleron_Right_Upper [mesh]   <-- ANIMATED (speedbrake, axis X)
      Deceleron_Right_Lower_Pivot   (static pivot)
        Deceleron_Right_Lower [mesh]   <-- ANIMATED (speedbrake, axis X)
  Aileron_Left_Pivot   (static pivot)
    Aileron_Left [mesh]   <-- ANIMATED (aileron, axis X)
      Deceleron_Left_Upper_Pivot   (static pivot)
        Deceleron_Left_Upper [mesh]   <-- ANIMATED (speedbrake, axis X)
      Deceleron_Left_Lower_Pivot   (static pivot)
        Deceleron_Left_Lower [mesh]   <-- ANIMATED (speedbrake, axis X)
  HorizontalTail_Right [mesh]
  HorizontalTail_Left [mesh]
  Elevator_Right_Pivot   (static pivot)
    Elevator_Right [mesh]   <-- ANIMATED (elevator, axis X)
  Elevator_Left_Pivot   (static pivot)
    Elevator_Left [mesh]   <-- ANIMATED (elevator, axis X)
  VerticalTail_Right [mesh]
  VerticalTail_Left [mesh]
  Rudder_Right_Pivot   (static pivot)
    Rudder_Right [mesh]   <-- ANIMATED (rudder, axis Y)
  Rudder_Left_Pivot   (static pivot)
    Rudder_Left [mesh]   <-- ANIMATED (rudder, axis Y)
  Engine_Right [mesh]
    EngineFan_Right_Pivot   (static pivot)
      EngineFan_Right [mesh]   <-- ANIMATED (fan, axis Z)
  Engine_Left [mesh]
    EngineFan_Left_Pivot   (static pivot)
      EngineFan_Left [mesh]   <-- ANIMATED (fan, axis Z)
  Sponson_Right [mesh]
  LandingGear_Right_Pivot   (static pivot)
    LandingGear_Right [mesh]   <-- ANIMATED (gear, axis X)
      Wheel_Right_Pivot   (static pivot)
        Wheel_Right [mesh]   <-- ANIMATED (wheel, axis X)
  Sponson_Left [mesh]
  LandingGear_Left_Pivot   (static pivot)
    LandingGear_Left [mesh]   <-- ANIMATED (gear, axis X)
      Wheel_Left_Pivot   (static pivot)
        Wheel_Left [mesh]   <-- ANIMATED (wheel, axis X)
  GearDoors
    GearDoor_Main_Right_Pivot   (static pivot)
      GearDoor_Main_Right [mesh]   <-- ANIMATED (geardoor, axis Z)
    GearDoor_Main_Left_Pivot   (static pivot)
      GearDoor_Main_Left [mesh]   <-- ANIMATED (geardoor, axis Z)
    GearDoor_Nose_Right_Pivot   (static pivot)
      GearDoor_Nose_Right [mesh]   <-- ANIMATED (geardoor, axis Z)
    GearDoor_Nose_Left_Pivot   (static pivot)
      GearDoor_Nose_Left [mesh]   <-- ANIMATED (geardoor, axis Z)
  LandingGear_Nose_Pivot   (static pivot)
    LandingGear_Nose [mesh]   <-- ANIMATED (gear, axis X)
      Wheel_Nose_Pivot   (static pivot)
        Wheel_Nose [mesh]   <-- ANIMATED (wheel, axis X)
  WeaponHardpoints
    HP_01   (attachment empty)
    HP_02   (attachment empty)
    HP_03   (attachment empty)
    HP_04   (attachment empty)
    HP_05   (attachment empty)
    HP_06   (attachment empty)
    HP_07   (attachment empty)
    HP_08   (attachment empty)
    HP_09   (attachment empty)
    HP_10   (attachment empty)
    HP_11   (attachment empty)
  Pylons [mesh]
  CannonMuzzle
    GAU8_Barrels_Pivot   (static pivot)
      GAU8_Barrels [mesh]   <-- ANIMATED (gau8, axis Z)
    HP_GAU8_Muzzle   (attachment empty)
  NavigationLights
    Nav_Left_Red [mesh]
    Nav_Right_Green [mesh]
    Nav_Tail_White [mesh]
    Nav_Beacon_Top [mesh]
```