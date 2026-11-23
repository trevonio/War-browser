import { horizontalSteering } from '../sim/instructor.js';
import { f16 } from './f16.js';

const wingStores = ['bomb', 'rocket', 'laser', 'gps', 'optical', 'tank'];
// GLB attachment positions rotated into the simulator's +Z-forward, +X-left space.
const leftMounts = [
  [7.35, -.381540, .757816], [6.25, -.535647, .732529], [5.15, -.691490, .707241],
  [4.05, -.805186, .681115], [3.15, -.819383, .658269],
];
const mounts = [...leftMounts, [0, -1.205, .425], ...leftMounts.slice().reverse().map(([x, y, z]) => [-x, y, z])];
const stations = mounts.map((offset, index) => {
  const [x] = offset;
  const number = index + 1;
  const tip = number === 1 || number === 11;
  return {
    name: 'HP_' + String(number).padStart(2, '0'), label: 'Station ' + number,
    offset, rotation: [0, 0, 0], release: [0, -.12, 0],
    wing: x > 0 ? 'leftWing' : x < 0 ? 'rightWing' : 'fuselage',
    symmetry: 'a10-' + Math.min(number, 12 - number),
    allowed: tip ? ['infrared'] : x ? wingStores : ['pod', 'bomb', 'tank'],
    limit: tip ? 120 : 850,
  };
});
const infrared = [stations[0], stations[10]].map((station) => ({ ...station, type: 'infrared' }));
const gunRun = { HP_01: 'infrared', HP_11: 'infrared' };
const mixed = { HP_03: 'bomb', HP_04: 'rocket', HP_08: 'rocket', HP_09: 'bomb' };
const precision = { HP_03: 'laser', HP_05: 'optical', HP_06: 'pod', HP_07: 'gps', HP_09: 'laser' };

const components = {
  fuel: { label: 'Fuel system', capacity: 25, volumes: [[0, -.15, 0, 1.35]] },
  fuselage: { label: 'Fuselage', capacity: 62, volumes: [[0, 0, 4.7, 1.35], [0, 0, -1.5, 1.4], [0, .05, -5.8, 1.15]] },
  pilot: { label: 'Pilot', capacity: 10, volumes: [[0, 1.1, 3.9, .64]] },
  noseGear: { label: 'Nose landing gear', capacity: 12, volumes: [[-.34, -1.2, 4.85, .53]] },
};
for (const [side, sign] of [['left', 1], ['right', -1]]) {
  components[side + 'Engine'] = { label: side + ' engine', capacity: 28, volumes: [[sign * 1.95, .9, -2.15, .86]] };
  components[side + 'Wing'] = { label: side + ' wing', capacity: 34, volumes: [[sign * 3.15, -.25, -.65, 1.35], [sign * 6, -.25, -.55, 1]] };
  components[side + 'Stabilator'] = { label: side + ' elevator', capacity: 15, volumes: [[sign * 1.7, .3, -7.5, .8]] };
  components[side + 'Flaperon'] = { label: side + ' aileron', capacity: 13, volumes: [[sign * 4.65, -.27, -.55, .83]] };
  components[side + 'Fin'] = { label: side + ' vertical tail', capacity: 14, volumes: [[sign * 2.95, 1.05, -7.3, .83]] };
  components[side + 'Gear'] = { label: side + ' landing gear', capacity: 12, volumes: [[sign * 2.35, -1, .3, .70]] };
}

// The handling, firing, and payload figures are balanced for the in-game range.
export const a10 = {
  id: 'a10c', shortName: 'A-10C', name: 'A-10C Thunderbolt II',
  manufacturer: 'Fairchild Republic', role: 'Close air support',
  description: 'Twin-engine attack aircraft with steady low-speed handling, a heavy cannon, and configurable ground stores.',
  weaponDomains: ['air', 'ground'],
  radarAvailable: false, previewDistance: 20,
  hardpoints: infrared,
  storeStations: { overrides: Object.fromEntries(infrared.map((station) => [station.name, station])),
    extra: stations.slice(1, 10), tankLimit: 2 },
  loadoutPresets: {
    'Gun Run': gunRun, 'Mixed CAS': mixed, 'Precision Support': precision, Clean: {},
    'Ground Attack': mixed, 'Precision Strike': precision,
    'Armored Target Attack': { HP_05: 'optical', HP_06: 'pod', HP_07: 'optical' },
    'Air Superiority': gunRun,
  },
  loadouts: {
    intercept: { stations: infrared, flare: 22, chaff: 14 },
    short: { stations: infrared, flare: 22, chaff: 14 },
    outnumbered: { stations: infrared, flare: 12, chaff: 8 },
  },
  engines: [
    { component: 'leftEngine', lateral: 1.95, share: .5, exhaust: [1.95, .9, -3.53] },
    { component: 'rightEngine', lateral: -1.95, share: .5, exhaust: [-1.95, .9, -3.53] },
  ],
  emptyMass: 11600, fuelCapacity: 4800, storesMass: 0, wingArea: 47, opticalSpan: 17.5,
  militaryThrust: 80400, afterburnerThrust: 0, idleFuelFlow: .24, militaryFuelFlow: 2.35,
  spoolResponse: 1.08, thrustLapse: .60, yawInertia: 48,
  baseLift: .12, liftSlope: 4.9, stallAngle: .37, baseDrag: .035, inducedDrag: .115, waveDrag: .054, maxMach: .82,
  horizontalSteering: { ...horizontalSteering, fineAngle: .10, fullBankAngle: .68, rollGain: 2.2, response: 6.4, highSpeedRudder: .56 },
  controlSpeed: 87, pitchRate: .61, rollRate: 1.2, yawRate: .33, maxG: 7.3, minG: -2.4,
  gearClearance: 2.1, gearTime: 2.25, gearComponents: ['leftGear', 'rightGear', 'noseGear'], chaseDistance: 38,
  payloadHandling: { rollBias: .42, responseMass: 6200 },
  flaps: { labels: ['Up', 'Takeoff', 'Landing'], angles: [0, 20, 40], lift: .27, drag: .068 },
  surfaces: { separateFlaps: true, speedBrake: true, stabilatorRollMix: 0, rudderDamage: true,
    limits: { Flap: [0, 40], SpeedBrake: [0, 55], LeftFlaperon: [-25, 20], RightFlaperon: [-25, 20],
      LeftStabilator: [-20, 30], RightStabilator: [-20, 30] } },
  damageComponents: components,
  damageEmitters: { leftEngine: [1.95, .9, -2.15], rightEngine: [-1.95, .9, -2.15], fuel: [0, -.65, .3] },
  cannon: { ...f16.cannon, name: 'GAU-8/A', caliber: 30, rpm: 3900, capacity: 1174,
    muzzle: [0, -.60, 8.15], bore: [0, 0, 1], projectileSpeed: 950,
    lifetime: 2.7, maxDistance: 2450, tracerEvery: 7, damage: 1.65,
    audio: { tone: 78, crack: .68, bass: .95 } },
  audio: { pitch: .66, gain: 1.24 },
  tactics: { energySpeed: .68, extendAt: 118, pursuitLag: 50 },
};
