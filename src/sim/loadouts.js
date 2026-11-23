// These are fictional simulator quantities and limits for the coastal range.
export const stores = {
  infrared: { label: 'Sidewinder', type: 'infrared', domain: 'air', category: 'Infrared missile', mass: 86, drag: 0.0009, quantity: 1, detail: 'Short-range air combat.' },
  radar: { label: 'AMRAAM', type: 'radar', domain: 'air', category: 'Radar missile', mass: 142, drag: 0.0014, quantity: 1, detail: 'Air intercepts with radar support.' },
  bomb: { label: 'Range bomb', type: 'bomb', domain: 'ground', category: 'Unguided bomb', mass: 215, drag: 0.0021, quantity: 1, detail: 'A free-falling practice store. Supports single, pair, and ripple release.' },
  rocket: { label: 'Range rocket pod', type: 'rocket', domain: 'ground', category: 'Unguided rockets', mass: 102, drag: 0.0034, quantity: 7, roundMass: 9, detail: 'Seven unguided rockets. The empty pod stays attached.' },
  pod: { label: 'EO targeting pod', type: 'pod', domain: 'ground', category: 'Sensor', mass: 112, drag: .0016, quantity: 1, detail: 'Stabilized day and thermal views. Fits the centerline.' },
  laser: { label: 'Laser practice bomb', type: 'laser', domain: 'ground', category: 'Laser guided', mass: 239, drag: .0027, quantity: 1, detail: 'Follows the pod’s illuminated area while the laser remains on target.' },
  gps: { label: 'Coordinate glide bomb', type: 'gps', domain: 'ground', category: 'Coordinate guided', mass: 248, drag: .0026, quantity: 1, detail: 'Flies to the coordinates saved at release. The aim point stays fixed.' },
  optical: { label: 'Optical strike missile', type: 'optical', domain: 'ground', category: 'Optical guided', mass: 177, drag: .0024, quantity: 1, detail: 'Acquires a visible ground vehicle through the pod’s point track.' },
  tank: { label: 'External fuel tank', type: 'tank', domain: 'air', category: 'External fuel', mass: 108, drag: 0.0044, quantity: 1, fuel: 620, detail: 'Feeds the engine before internal fuel. The tank can be jettisoned.' },
};

export const storeStationPair = (id, name, [x, y, z], allowed, limit) => [1, -1].map((side) => ({
  name: `${id}-${side > 0 ? 'left' : 'right'}`, label: `${side > 0 ? 'Left' : 'Right'} ${name}`,
  offset: [side * x, y, z], wing: side > 0 ? 'leftWing' : 'rightWing',
  rotation: [0, 0, 0], release: [0, -0.08, 0], allowed, limit, symmetry: id,
}));

export const centerFuelStation = {
  name: 'center', label: 'Centerline', offset: [0, -0.88, -0.70], wing: 'fuselage',
  rotation: [0, 0, 0], release: [0, -0.11, 0], allowed: ['tank'], limit: 800,
};

export function configurableStations(spec) {
  const standard = spec.hardpoints.map(({ type, name, offset, wing }) => ({
    name, label: name.replaceAll('-', ' '), offset, wing,
    rotation: [0, 0, 0], release: [0, -0.04, 0], allowed: [type],
    limit: type === 'infrared' ? 100 : 165, symmetry: name.replace(/-(left|right)$/, ''),
    ...spec.storeStations?.overrides?.[name],
  }));
  return [...standard, ...(spec.storeStations?.extra ?? [])];
}

export function availablePresets(spec) {
  if (spec.id === 'a10c') return {
    'Gun Run': {HP_01:'infrared',HP_11:'infrared'},
    'Mixed CAS': {HP_03:'bomb',HP_04:'rocket',HP_08:'rocket',HP_09:'bomb'},
    'Precision Support': {HP_03:'laser',HP_05:'optical',HP_06:'pod',HP_07:'gps',HP_09:'laser'},
    'Clean': {},
    'Ground Attack': {HP_03:'bomb',HP_04:'rocket',HP_08:'rocket',HP_09:'bomb'},
    'Precision Strike': {HP_03:'laser',HP_05:'optical',HP_06:'pod',HP_07:'gps'},
    'Armored Target Attack': {HP_05:'optical',HP_06:'pod',HP_07:'optical'},
    'Air Superiority': {HP_01:'infrared',HP_11:'infrared'},
  };
  const air = Object.fromEntries(spec.hardpoints.map(({ name, type }) => [name, type]));
  const ir = Object.fromEntries(Object.entries(air).filter(([, type]) => type === 'infrared'));
  const radar = Object.fromEntries(Object.entries(air).filter(([, type]) => type === 'radar'));
  if (spec.weaponDomains.includes('ground')) return {
    'Air Superiority': air, Dogfight: ir,
    'Ground Attack': { 'outer-left': 'bomb', 'outer-right': 'bomb', 'inboard-left': 'rocket', 'inboard-right': 'rocket' },
    'Precision Strike': { 'outer-left': 'laser', 'outer-right': 'gps', 'inboard-left': 'optical', 'inboard-right': 'rocket', center: 'pod' },
    'Armored Target Attack': { 'inboard-left': 'optical', 'inboard-right': 'optical', center: 'pod' },
    'Mixed CAS': { 'outer-left': 'laser', 'outer-right': 'gps', 'inboard-left': 'rocket', 'inboard-right': 'bomb', center: 'pod' },
    'Multirole Support': { ...air, 'inboard-left': 'optical', 'inboard-right': 'gps', center: 'pod' },
    'Mixed Multirole': { ...air, 'inboard-left': 'bomb', 'inboard-right': 'rocket', center: 'tank' },
    'Clean Aircraft': {},
  };
  return {
    'Air Superiority': air, 'BVR Combat': radar, 'Short-Range Combat': ir,
    'External Fuel Configuration': { ...air, 'reserve-left': 'tank', 'reserve-right': 'tank' },
    'Clean Aircraft': {},
  };
}

export function storeWeight(store) {
  return store.mass + (store.roundMass ?? 0) * store.quantity + (store.fuel ?? 0);
}

export function resolveLoadout(spec, assignment) {
  const errors = [];
  const stations = [];
  let mass = 0;
  let drag = 0;
  let tankCount = 0;
  const points = configurableStations(spec);
  if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) {
    return { errors: ['Invalid station assignment.'], stations, mass, drag };
  }
  for (const [name, id] of Object.entries(assignment)) {
    const point = points.find((item) => item.name === name);
    if (!point) {
      errors.push(`Unknown station ${name}.`);
      continue;
    }
    if (typeof id !== 'string' || !Object.hasOwn(stores, id)) {
      errors.push(`Unknown store at ${point.label}.`);
      continue;
    }
    const store = stores[id];
    if (!spec.weaponDomains.includes(store.domain) || !point.allowed.includes(id)) {
      errors.push(`${store.label} cannot mount on ${point.label}.`);
      continue;
    }
    const weight = storeWeight(store);
    if (weight > point.limit) {
      errors.push(`${point.label} supports up to ${point.limit} kg.`);
      continue;
    }
    if (id === 'tank') tankCount++;
    stations.push({
      ...point, id, type: store.type, domain: store.domain, quantity: store.quantity, fuel: store.fuel ?? 0,
      payload: { mass: store.mass, drag: store.drag }, roundMass: store.roundMass ?? 0,
    });
    mass += weight;
    drag += store.drag;
  }
  if (assignment.center === 'tank' && tankCount > (spec.storeStations?.tankLimit ?? Infinity)) errors.push('The center tank conflicts with a full pair of wing tanks.');
  return { errors, stations, mass, drag, physical: true };
}

export function missionLoadout(spec, assignment, mission) {
  const candidate = resolveLoadout(spec, assignment);
  if (candidate.errors.length || mission === 'outnumbered') return null;
  const allowed = { dogfight: ['tank'], short: ['infrared', 'tank'], intercept: ['infrared', 'radar', 'tank'] }[mission];
  const stations = allowed ? candidate.stations.filter(({ id }) => allowed.includes(id)) : candidate.stations;
  const exercise = spec.loadouts[mission] ?? spec.loadouts.intercept;
  return { ...candidate, stations, flare: exercise.flare, chaff: exercise.chaff,
    restricted: stations.length !== candidate.stations.length };
}

export class LoadoutBook {
  constructor(storage) {
    this.storage = storage;
    this.state = { version: 1, aircraft: {} };
    try {
      const saved = JSON.parse(storage.getItem('war-browser:loadouts'));
      if (saved?.version === 1 && saved.aircraft && typeof saved.aircraft === 'object' && !Array.isArray(saved.aircraft)) this.state = saved;
    } catch { /* Browser storage is optional. */ }
  }

  entry(spec) {
    const raw = this.state.aircraft[spec.id];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return this.state.aircraft[spec.id] = { saved: [], active: null };
    const saved = Array.isArray(raw.saved) ? raw.saved : [];
    const valid = saved.filter((item) => typeof item?.name === 'string' && item.name.trim() && !resolveLoadout(spec, item.assignment).errors.length);
    if (valid.length !== saved.length) raw.invalid = true;
    raw.saved = valid;
    if (raw.active && resolveLoadout(spec, raw.active).errors.length) {
      raw.invalid = true;
      raw.active = null;
    }
    return raw;
  }

  persist() {
    try {
      this.storage.setItem('war-browser:loadouts', JSON.stringify(this.state));
      return true;
    } catch { return false; }
  }
}
