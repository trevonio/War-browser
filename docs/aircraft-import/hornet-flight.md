# F/A-18C Hornet integration

Select **Fly F/A-18C** in the aircraft hangar. The optimized model from the
[import pipeline](hornet.md) supplies the full airframe and all three detail
levels. It uses HeriFajar's **F/A-18 Hornet Low Poly**, adapted under
**CC BY 4.0**. [Original model](https://sketchfab.com/3d-models/fa-18-hornet-low-poly-25a2485d6eb4428f89c014e03fb42047) · [License](https://creativecommons.org/licenses/by/4.0/)

## Flight and rig

The Hornet uses separate engine states for thrust, spool, fuel flow,
afterburner, and damage. Losing one engine removes its afterburner and thrust
and induces yaw. The other engine can keep the aircraft flying. A Hornet
with both engines out can still glide if its controls remain functional.

Aircraft-specific tuning gives the Hornet more approach authority than the
F-15C, slower roll response than the F-16C, and a higher critical angle of
attack than either fighter. It loses energy as incidence climbs, and the
shared stall, load, and G limits still apply. The instructor keeps fine
rudder correction, progressive banking, and pitch priority.

Each flight step computes the control-surface state. The visual adapter
applies independent aileron, stabilator, and rudder angles, plus scheduled
leading-edge and pilot-selected trailing-edge flaps. It animates the
imported gear and door pivots. Structural components control the visibility
of corresponding meshes, and damaged controls affect flight authority.
The visual adapter loads the three GLBs once. Player and enemy instances
share geometry and materials and have independent poses and engine effects.

The imported model has approximate socket locations and shallow gear bays.
The original clearance sweep still detects main-gear contacts during transit,
though the wheels tuck into the endpoint pose. The airbrake affects flight
drag through the shared system. The model has no independent speedbrake
surface or articulated wing fold. Carrier launch and recovery are outside
this stage.

## Stores and missions

| Preset | In-game role |
| --- | --- |
| Air Superiority | Radar and infrared missiles with a centerline tank |
| Dogfight | Two infrared missiles |
| Precision Strike | Targeting pod, laser and coordinate bombs, optical missile, and an infrared missile |
| Multirole | Air-to-air missiles, targeting pod, guided and unguided bombs, and fuel |
| Clean | No external stores |

The nine configurable stations use the imported model sockets. Mounts,
launch origins, payload moment, mass, drag, and released store visibility
use the same station definitions. The Hornet shares the existing cannon
ballistics, missile seekers and effects, countermeasures, radar and warning
receiver, targeting pod, and dynamic CAS systems. Its M61A2-inspired cannon
and APG-73-inspired radar use game values.

**F/A-18C Multirole Qualification** starts on the runway. Score a hit on
the designated aircraft and defeat it, then disable the two designated
vehicles while protecting the friendly observers. The same sortie carries
into the strike phase. The debrief counts air and ground results, missiles
and weapon releases, cannon rounds fired, friendly fire, damaged components,
and time from simulation events. The mission choice appears when the Hornet
is selected.

## Verification

Unit tests cover compatible stores and positions, a runway circuit, independent
engine failures, high-incidence energy loss, the mouse instructor, visual
rig synchronization and damage, and phase scoring. Browser tests exercise
the production hangar, saved loadouts, CAS pod tracking, and qualification
with controlled flight paths and real weapon impacts.

A production-build smoke run measured 2.3-second warmed samples with the
Low preset at 960 × 600 on Chromium software WebGL.

| Scenario | FPS | 95th-percentile frame time |
| --- | ---: | ---: |
| Hornet free flight | 8.0 | 166.7 ms |
| Hornet vs F-16C | 7.8 | 150.0 ms |
| Hornet vs F-15C | 9.7 | 133.4 ms |
| Outnumbered vs F-15C and AI Hornet | 6.3 | 216.7 ms |
| Active CAS battlefield | 6.9 | 183.3 ms |
| CAS thermal pod with guided ordnance in flight | 47.4 | 33.4 ms |

These samples characterize SwiftShader in the test environment. The renderer
uses a lower resolution and simpler terrain presentation for the thermal view.
Hardware-accelerated frame rates have not been measured.
