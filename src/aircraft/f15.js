import { horizontalSteering } from '../sim/instructor.js';
import { centerFuelStation, storeStationPair } from '../sim/loadouts.js';
import { f16 } from './f16.js';

const paired = (type, names, coordinates) => coordinates.flatMap(([x, y, z], index) =>
  [1, -1].map((sign) => ({
    type, name: `${names[index]}-${sign > 0 ? 'left' : 'right'}`,
    offset: [sign * x, y, z], wing: sign > 0 ? 'leftWing' : 'rightWing',
  })));
const infrared = paired('infrared', ['shoulder-a', 'shoulder-b'], [[3.25, -0.53, -0.85], [3.95, -0.53, -0.85]]);
const radar = paired('radar', ['intake-forward', 'intake-aft'], [[1.22, -0.84, 1.1], [1.34, -0.84, -3.0]]);

const components = {
  fuel: { label: 'Fuel system', capacity: 23, volumes: [[0, 0, -1.45, 1.40]] },
  fuselage: { label: 'Fuselage', capacity: 56, volumes: [[0, 0, 4.3, 1.4], [0, 0, -4.0, 1.4], [0, 0, 7.05, 0.9]] },
  pilot: { label: 'Pilot', capacity: 9, volumes: [[0, 1.03, 4.65, 0.62]] },
};
for (const [side, sign] of [['left', 1], ['right', -1]]) {
  components[`${side}Engine`] = { label: `${side} engine`, capacity: 28, volumes: [[1.13 * sign, -0.17, -5.32, 0.91]] };
  components[`${side}Wing`] = { label: `${side} wing`, capacity: 30, volumes: [[4 * sign, -0.12, -1.0, 1.2], [5.4 * sign, -0.17, -2, 0.91]] };
  components[`${side}Stabilator`] = { label: `${side} stabilator`, capacity: 16, volumes: [[2.7 * sign, 0.03, -7.4, 0.88]] };
  components[`${side}Flaperon`] = { label: `${side} aileron`, capacity: 13, volumes: [[5.08 * sign, -0.14, -2.91, 0.63]] };
  components[`${side}Fin`] = { label: `${side} vertical tail`, capacity: 15, volumes: [[1.73 * sign, 2.26, -6.85, 0.79]] };
}

// Public dimensions and approximate rated thrust anchor the model. The
// coefficients, envelopes, and stores counts are tuned for the game's map.
export const f15 = {
  id: 'f15c', shortName: 'F-15C', name: 'F-15C Eagle', manufacturer: 'McDonnell Douglas',
  role: 'Air-superiority fighter',
  description: 'Twin-engine power and a wider radar picture. Best when it maintains speed through the fight.',
  emptyMass: 12800, fuelCapacity: 6100, storesMass: 830, wingArea: 56.5, opticalSpan: 13.05,
  militaryThrust: 148000, afterburnerThrust: 219000, idleFuelFlow: 0.31, militaryFuelFlow: 3.5,
  afterburnerFuelFlow: 10.4, spoolResponse: 1.36, thrustLapse: 0.54, yawInertia: 42,
  engines: [
    { component: 'leftEngine', lateral: 1.13, share: 0.5, exhaust: [1.13, -0.16, -7.98] },
    { component: 'rightEngine', lateral: -1.13, share: 0.5, exhaust: [-1.13, -0.16, -7.98] },
  ],
  baseLift: 0.063, liftSlope: 3.94, stallAngle: 0.285,
  baseDrag: 0.019, inducedDrag: 0.092, waveDrag: 0.026, maxMach: 2.5,
  horizontalSteering: { ...horizontalSteering, fineAngle: .086, fullBankAngle: .57, rollGain: 3, response: 8.6, highSpeedRudder: .48 },
  controlSpeed: 124, pitchRate: 0.79, rollRate: 1.94, yawRate: 0.42, maxG: 9, minG: -2.7,
  gearClearance: 1.79, gearTime: 1.14, chaseDistance: 37,
  damageComponents: components,
  damageEmitters: { fuel: [0, -0.72, -1.4] },
  surfaces: {
    separateFlaps: true, speedBrake: true,
    limits: { Flap: [0, 35], SpeedBrake: [0, 48], LeftFlaperon: [-20, 20], RightFlaperon: [-20, 20] },
  },
  cannon: { ...f16.cannon, capacity: 940, muzzle: [-1.49, 0.32, 3.03] },
  weaponDomains: ['air'],
  hardpoints: [...infrared, ...radar],
  storeStations: {
    extra: [...storeStationPair('reserve', 'fuel pylon', [2.70, -0.67, -1.24], ['tank'], 820),
      { ...centerFuelStation, offset: [0, -0.96, -0.24] }],
    tankLimit: 2,
  },
  loadouts: {
    short: { stations: infrared, flare: 10, chaff: 6 },
    intercept: { stations: [...infrared, ...radar], flare: 10, chaff: 12 },
    outnumbered: { stations: [infrared[0], radar[1]], flare: 4, chaff: 4 },
  },
  radar: {
    label: 'APG-63 inspired', ranges: [3200, 9000, 16000], bearing: 0.97, lockBearing: 1.08,
    elevation: 0.68, searchInterval: 0.52, twsInterval: 0.29, lockInterval: 0.13, capacity: 8,
  },
  rwr: { hold: 0.42 },
  dispensers: [1.47, -0.76, -5.0],
  audio: { pitch: 0.87, gain: 1.18 },
  tactics: { energySpeed: 1.09, extendAt: 210, pursuitLag: 70 },
};
