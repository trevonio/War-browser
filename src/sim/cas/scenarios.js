import { scenarios } from '../range.js';

export const casMissions = {
  breakthrough: {
    label: 'Armored Breakthrough', description: 'Help a friendly armored column secure a defended crossing.',
    primary: 'Secure the crossing', secondary: 'Keep at least three friendly combat vehicles operational.',
    intel: 'Defending armor and a possible relief column.', time: 190, start: 'battlefield',
  },
  protection: {
    label: 'Convoy Protection', description: 'Keep a friendly logistics convoy moving through hostile territory.',
    primary: 'Escort the designated transports to the exit', secondary: 'Deliver every friendly transport.',
    intel: 'Armored patrols on one of the approaches.', time: 235, start: 'convoy',
  },
  emergency: {
    label: 'Emergency Air Support', description: 'Relieve a friendly group already under pressure.',
    primary: 'Relieve the friendly group', secondary: 'Preserve every vehicle in the surrounded group.',
    intel: 'A stronger armored group has closed on the friendly line.', time: 150, start: 'battlefield',
  },
  interdiction: {
    label: 'Battlefield Interdiction', description: 'Stop hostile reinforcements before they reach the front.',
    primary: 'Stop the designated transports', secondary: 'Prevent every designated vehicle from arriving.',
    intel: 'A transport column with armored escorts is expected along the marked corridor.', time: 205, start: 'convoy',
  },
};

export const casDifficulties = {
  rookie: { time: 25, request: 39, grid: 44, intelAge: 43, friendly: 1, opposing: 0, survival: 1, transfer: 1 },
  regular: { time: 0, request: 28, grid: 68, intelAge: 33, friendly: 0, opposing: 0, survival: 2, transfer: 2 },
  veteran: { time: -14, request: 20, grid: 94, intelAge: 23, friendly: 0, opposing: 2, survival: 2, transfer: 3 },
};

function randomGenerator(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(1664525, value) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export function createCasScenario(key, seed, difficulty, roads) {
  const template = casMissions[key];
  const rules = casDifficulties[difficulty];
  const random = randomGenerator(seed);
  const choose = (values) => values[Math.floor(random() * values.length)];
  const branch = choose([
    ['south', 'bend', 'relay', 'north'],
    ['south', 'branchSouth', 'branch', 'branchNorth', 'north'],
    ['south', 'flankSouth', 'flank', 'flankNorth', 'north'],
  ]);
  const candidate = ['inbound', ...branch, 'exit'];
  const road = candidate.every((id, index) => !index || roads.adjacent[id].some(([node]) => node === candidate[index - 1]))
    ? candidate : roads.route('inbound', 'exit');
  const [exitX, exitZ] = roads.points.exit;
  const convoy = key === 'protection' || key === 'interdiction';
  const guard = key === 'emergency';
  const [centerX, centerZ] = roads.points[guard ? choose(['relay', 'branchNorth', 'flank']) : choose(['bend', 'relay', 'branch', 'flank'])];
  const zone = convoy ? { x: exitX, z: exitZ, radius: 38, label: key === 'protection' ? 'Friendly checkpoint' : 'Frontline junction' }
    : { x: centerX, z: centerZ, radius: 128, label: guard ? 'Friendly position' : 'Contested crossing' };
  const definitions = [];
  const relief = [];
  const targets = [];
  const terrainColumn = (list, faction, role, types, distance, direction, x = centerX) => {
    for (const [index, type] of types.entries()) {
      const lane = [-42, 0, 42][index % 3];
      const spawnX = Math.max(-306, x) + lane;
      const spawnZ = centerZ - direction * (distance + Math.floor(index / 3) * 36 + Math.floor(random() * 14));
      const arriveX = Math.max(-306, convoy ? roads.points.north[0] : centerX) + lane;
      const arriveZ = convoy ? -1485 + direction * (index % 3) * 38 : centerZ + direction * (guard ? 22 : 40);
      const spawn = [spawnX, spawnZ];
      const end = [arriveX, arriveZ];
      const join = [arriveX, centerZ - direction * Math.min(170, distance * .58)];
      const route = roads.canJoin(roads.world, spawn, join) && roads.canJoin(roads.world, join, end)
        ? [join, end] : [end].filter((point) => roads.canJoin(roads.world, spawn, point));
      const id = `${role}-${index + 1}`;
      list.push({ id, faction, type, x: spawnX, z: spawnZ, yaw: direction > 0 ? 0 : Math.PI, route, objective: role });
    }
  };
  const troops = ['tank', 'ifv', 'tank', choose(['ifv', 'apc'])];
  const rivals = ['tank', 'ifv', choose(['tank', 'ifv']), choose(['ifv', 'apc'])];
  if (convoy) {
    const faction = key === 'protection' ? 'friendly' : 'opposing';
    const convoyRoute = road.slice(1).map((id) => roads.points[id]);
    for (const [index, type] of [choose(['ifv', 'apc']), 'truck', 'truck', 'truck', choose(['tank', 'ifv'])].entries()) {
      const id = `column-${index + 1}`;
      definitions.push({ id, type, faction, x: -269, z: -2580 - index * 34, yaw: 0,
        route: convoyRoute, formation: 'convoy', objective: type === 'truck' ? 'deliver' : 'escort' });
      if (type === 'truck') targets.push(id);
    }
    terrainColumn(definitions, 'friendly', 'screen', troops.slice(0, 3 + rules.friendly), 285, 1, -350);
    terrainColumn(definitions, 'opposing', 'patrol', rivals.concat(Array(rules.opposing).fill('ifv')).slice(0, key === 'protection' ? 6 : 4),
      405, -1, choose([-338, -178]));
  } else {
    terrainColumn(definitions, 'friendly', 'assault', troops.concat(Array((guard ? 0 : 2) + rules.friendly).fill('ifv')),
      guard ? 92 : 510 + Math.floor(random() * 110), 1);
    terrainColumn(definitions, 'opposing', 'defense', rivals.concat(Array((guard ? 2 : 1) + rules.opposing).fill('ifv')),
      guard ? 295 + Math.floor(random() * 38) : 205 + Math.floor(random() * 90), -1);
  }
  terrainColumn(relief, key === 'emergency' ? 'friendly' : 'opposing', 'relief', ['ifv', choose(['ifv', 'tank'])],
    convoy ? 520 : guard ? 580 : 575, key === 'emergency' ? 1 : -1, centerX - 20);
  const start = { ...scenarios[template.start] };
  if (guard) Object.assign(start, { z: centerZ - 1380, x: centerX + 38 });
  return {
    key, seed, difficulty, rules, ...template, timeLimit: template.time + rules.time, start,
    objective: zone, definitions, targets, relief, reliefAt: 35 + Math.floor(random() * 31),
    road: road.map((id) => roads.points[id]), activeLimit: 18,
  };
}
