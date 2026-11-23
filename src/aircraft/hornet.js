import model from '../../tools/aircraft-viewer/public/fa-18-hornet/manifest.json' with { type: 'json' };
import { horizontalSteering } from '../sim/instructor.js';
import { resolveLoadout } from '../sim/loadouts.js';

export { model as hornetModel };

const attachments = Object.fromEntries(model.attachments.map((anchor) => [anchor.name, anchor]));
const wingStores = ['infrared', 'radar', 'bomb', 'laser', 'gps', 'optical', 'rocket'];
const rules = [
  ['Left tip', ['infrared'], 120, 'leftWing'],
  ['Left outer', wingStores, 560, 'leftWing'],
  ['Left inboard', [...wingStores, 'tank'], 850, 'leftWing'],
  ['Left cheek', ['radar', 'pod'], 190, 'fuselage'],
  ['Centerline', ['pod', 'tank', 'bomb'], 850, 'fuselage'],
  ['Right cheek', ['radar'], 190, 'fuselage'],
  ['Right inboard', [...wingStores, 'tank'], 850, 'rightWing'],
  ['Right outer', wingStores, 560, 'rightWing'],
  ['Right tip', ['infrared'], 120, 'rightWing'],
];
const stations = model.attachments.filter(({ kind }) => kind === 'store').map(({ name, position: offset }, index) => {
  const [label, allowed, limit, wing] = rules[index];
  return { name, label: `Station ${index + 1} · ${label}`, offset, rotation: [0, 0, 0], release: [0, -.10, 0],
    allowed, limit, wing, symmetry: `hornet-${Math.min(index, 8 - index)}` };
});

const dogfight = { HP_01: 'infrared', HP_09: 'infrared' };
const airSuperiority = { ...dogfight, HP_02: 'radar', HP_04: 'radar', HP_06: 'radar', HP_08: 'radar', HP_05: 'tank' };
const multirole = { ...dogfight, HP_03: 'laser', HP_04: 'pod', HP_05: 'tank', HP_06: 'radar', HP_07: 'gps', HP_08: 'bomb' };
const precision = { HP_01: 'infrared', HP_02: 'gps', HP_03: 'laser', HP_04: 'pod', HP_07: 'optical', HP_08: 'laser' };
const groundAttack = { HP_02: 'rocket', HP_03: 'bomb', HP_04: 'pod', HP_07: 'bomb', HP_08: 'rocket' };
const armored = { ...dogfight, HP_03: 'optical', HP_04: 'pod', HP_07: 'optical' };

const components = {
  fuselage: { label: 'Fuselage', capacity: 47, volumes: [[0, .05, 5.6, .72], [0, -.03, 1.05, 1.20], [0, 0, -6.1, .73]] },
  fuel: { label: 'Fuel system', capacity: 25, volumes: [[0, .27, -1.7, 1.07]] },
  pilot: { label: 'Pilot', capacity: 9, volumes: [[0, 1.1, 3.1, .52]] },
  noseGear: { label: 'Nose landing gear', capacity: 12, volumes: [[0, -1.24, 3.3, .42]] },
};

for (const [side, sign] of [['left', 1], ['right', -1]]) {
  components[side + 'Engine'] = { label: `${side} engine`, capacity: 26, volumes: [[sign * .61, .04, -5.1, .58]] };
  components[side + 'Wing'] = { label: `${side} wing`, capacity: 29, volumes: [[sign * 2.6, .22, -1.95, .91], [sign * 4.6, .23, -2.45, .69]] };
  components[side + 'Stabilator'] = { label: `${side} stabilator`, capacity: 14, volumes: [[sign * 2.12, -.025, -6.92, .60]] };
  components[side + 'Flaperon'] = { label: `${side} aileron`, capacity: 13, volumes: [[sign * 4.85, .25, -3.40, .52]] };
  components[side + 'Fin'] = { label: `${side} vertical stabilizer`, capacity: 15, volumes: [[sign * 1.28, 1.67, -4.92, .54]] };
  components[side + 'Rudder'] = { label: `${side} rudder`, capacity: 10, volumes: [[sign * 1.21, 1.22, -5.58, .43]] };
  components[side + 'Gear'] = { label: `${side} main gear`, capacity: 12, volumes: [[sign * 1.3, -1.12, -2.04, .46]] };
}

const engines = ['Left', 'Right'].map((side) => {
  const { position: exhaust } = attachments['Engine_Exhaust_' + side];
  return { component: side.toLowerCase() + 'Engine', lateral: exhaust[0], share: .5, exhaust };
});
const muzzle = attachments.HP_Cannon_Muzzle;

// Handling, envelope, radar and payload values are tuned for the game's range.
export const hornet = {
  id: 'fa18c', shortName: 'F/A-18C', name: 'F/A-18C Hornet', manufacturer: 'McDonnell Douglas',
  role: 'Carrier-capable multirole fighter',
  description: 'Twin-engine multirole fighter combining air-to-air combat, precision strike capabilities, and strong low-speed handling.',
  modelCredit: model.attribution, weaponDomains: ['air', 'ground'], defaultLoadout: 'Air Superiority',
  previewDistance: 19.5, chaseDistance: 33, opticalSpan: 11.7,
  hardpoints: [], storeStations: { extra: stations, tankLimit: 2 },
  loadoutPresets: {
    'Air Superiority': airSuperiority, Dogfight: dogfight, 'Precision Strike': precision, Multirole: multirole, Clean: {},
    'Ground Attack': groundAttack, 'Armored Target Attack': armored,
  },
  loadouts: {},
  engines, emptyMass: 10500, fuelCapacity: 4700, storesMass: 0, wingArea: 38,
  militaryThrust: 99500, afterburnerThrust: 154000, idleFuelFlow: .30, militaryFuelFlow: 2.82,
  afterburnerFuelFlow: 8.8, spoolResponse: 1.42, thrustLapse: .60, yawInertia: 31,
  baseLift: .13, liftSlope: 4.43, stallAngle: .39,
  highAlpha: { commanded: .43, manual: .40, controlLoss: .58, separationEnd: .76, maneuverDrag: .065 },
  baseDrag: .027, inducedDrag: .123, waveDrag: .046, maxMach: 1.76,
  horizontalSteering: { ...horizontalSteering, fineAngle: .106, fullBankAngle: .69,
    rollGain: 2.55, response: 7.3, highSpeedRudder: .53 },
  controlSpeed: 102, pitchRate: .88, rollRate: 1.77, yawRate: .48, maxG: 7.7, minG: -2.7,
  gearClearance: 1.67, gearTime: 1.9, gearComponents: ['leftGear', 'rightGear', 'noseGear'],
  payloadHandling: { rollBias: .43, responseMass: 4900 },
  flaps: { labels: ['Up', 'Takeoff', 'Landing'], angles: [0, 16, 28], lift: .22, drag: .056 },
  surfaces: { separateFlaps: true, separateRudders: true, stabilatorRollMix: 5, limitLEF: 22,
    limits: {
      LeftLEF: [0, 22], RightLEF: [0, 22], Flap: [0, 28], LeftFlaperon: [-21, 21], RightFlaperon: [-21, 21],
      LeftStabilator: [-20, 20], RightStabilator: [-20, 20], LeftRudder: [-23, 23], RightRudder: [-23, 23],
    } },
  damageComponents: components,
  damageEmitters: { leftEngine: engines[0].exhaust, rightEngine: engines[1].exhaust, fuel: [0, -.62, -1.2] },
  cannon: {
    name: 'M61A2', caliber: 20, rpm: 5600, capacity: 560, muzzle: muzzle.position, bore: muzzle.direction,
    projectileSpeed: 840, drag: .00019, lifetime: 2.5, maxDistance: 2200, tracerEvery: 5,
    damage: 1.08, audio: { tone: 115, crack: .81, bass: .38 },
  },
  radar: {
    label: 'APG-73 inspired', ranges: [2800, 7000, 13200], bearing: .82, lockBearing: .98, elevation: .62,
    searchInterval: .62, twsInterval: .33, lockInterval: .135, capacity: 6,
  },
  rwr: { hold: .37 }, dispensers: [1.13, -.58, -4.45],
  audio: { pitch: 1.08, gain: 1.05 },
  tactics: { energySpeed: .89, extendAt: 154, pursuitLag: 32, missileFollowUp: 1.12 },
};

const exerciseLoadout = (assignment, flare, chaff) => ({ ...resolveLoadout(hornet, assignment), flare, chaff });
hornet.loadouts = {
  short: exerciseLoadout(dogfight, 16, 8),
  intercept: exerciseLoadout(airSuperiority, 18, 16),
  outnumbered: exerciseLoadout({ HP_01: 'infrared', HP_06: 'radar' }, 4, 4),
  hornetQualification: exerciseLoadout(multirole, 18, 16),
};
