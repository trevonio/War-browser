import { groundVehicles, GroundVehicle } from './vehicles.js';
import { GroundEngagement, GroundProjectiles, groundDifficulty } from './engagement.js';
import { moveVehicle, RoadNetwork } from './navigation.js';

const routePoints = {
  inbound: [-270, -2800], south: [-268, -2370], bend: [-277, -1900], relay: [-226, -1570],
  north: [-220, -1260], exit: [-179, -793], branchSouth: [-186, -2100], branch: [-163, -1850],
  branchNorth: [-156, -1580], flankSouth: [-329, -2140], flank: [-325, -1690], flankNorth: [-295, -1320],
};
const links = [
  ['inbound', 'south'], ['south', 'bend'], ['bend', 'relay'], ['relay', 'north'], ['north', 'exit'],
  ['south', 'branchSouth'], ['branchSouth', 'branch'], ['branch', 'branchNorth'], ['branchNorth', 'north'],
  ['south', 'flankSouth'], ['flankSouth', 'flank'], ['flank', 'flankNorth'], ['flankNorth', 'north'],
];
const relay = { x: -234, z: -1637, radius: 124, label: 'Relay crossing' };
export const groundMissions = {
  battlefield: {
    label: 'Battlefield Support', briefing: 'Help the friendly column secure Relay crossing. Both forces advance and fight on their own.',
    timeLimit: 145, objective: relay,
  },
  qualification: {
    label:'A-10C Gun and Rocket Qualification',
    briefing:'Identify friendly vehicles and disable the marked stationary and moving hostile targets.',
    timeLimit:260,objective:{x:-225,z:-1650,radius:125,label:'Qualification range'},
  },
  convoy: {
    label: 'Convoy Interdiction', briefing: 'Stop all three designated transports before they reach the end of the road.',
    timeLimit: 170, objective: { x: -179, z: -793, radius: 31, label: 'Convoy exit' },
  },
};

function supportVehicles(friendlyAdvance) {
  const units = [];
  const teams = [
    ['friendly', -1, -2285 + friendlyAdvance, 0, ['tank', 'ifv', 'tank', 'apc', 'ifv', 'truck']],
    ['opposing', 1, -1145, Math.PI, ['tank', 'ifv', 'tank', 'ifv', 'apc', 'truck']],
  ];
  for (const [faction, direction, z, yaw, types] of teams) {
    for (const [index, type] of types.entries()) {
      const x = [-272, -195, -326][index % 3];
      units.push({
        id: `${faction}-${index + 1}`, type, faction, x, z: z + direction * Math.floor(index / 3) * 32, yaw,
        route: direction < 0 ? [ [x, -1946], [x, -1640], [x, -1490] ]
          : [ [x, -1340], [x, -1636], [x, -1800] ],
        objective: 'capture',
      });
    }
  }
  return units;
}

function qualificationVehicles() {
  const staticTargets=[
    {id:'qual-static-tank',type:'tank',faction:'opposing',x:-225,z:-1675,yaw:Math.PI,route:[],objective:'qualify'},
    {id:'qual-static-ifv',type:'ifv',faction:'opposing',x:-295,z:-1640,yaw:Math.PI,route:[],objective:'qualify'},
  ];
  const movers=[
    {id:'qual-moving-truck',type:'truck',faction:'opposing',x:-270,z:-2650,yaw:0,
      route:[[-270,-2370],[-277,-1900],[-226,-1570]],formation:'convoy',objective:'qualify'},
    {id:'qual-moving-apc',type:'apc',faction:'opposing',x:-270,z:-2700,yaw:0,
      route:[[-270,-2370],[-277,-1900],[-226,-1570]],formation:'convoy',objective:'qualify'},
  ];
  const friendlies=[
    {id:'qual-friendly-ifv',type:'ifv',faction:'friendly',x:-115,z:-1700,yaw:0,route:[],objective:'identify'},
    {id:'qual-friendly-truck',type:'truck',faction:'friendly',x:-115,z:-1600,yaw:0,route:[],objective:'identify'},
  ];
  return [...staticTargets,...movers,...friendlies];
}
function convoyVehicles(roads) {
  const road = roads.route('inbound', 'exit').slice(1).map((node) => roads.points[node]);
  return ['ifv', 'truck', 'apc', 'truck', 'truck', 'ifv'].map((type, index) => ({
    id: `convoy-${index + 1}`, type, faction: 'opposing', x: -270, z: -2610 - index * 31, yaw: 0,
    route: road, formation: 'convoy', objective: type === 'truck' ? 'deliver' : 'escort',
  }));
}

export class GroundBattle {
  constructor(world, effects = {}) {
    this.world = world;
    this.effects = effects;
    this.roads = new RoadNetwork(world, routePoints, links);
    this.weapons = new GroundProjectiles(world, effects);
    this.weapons.query = (from, to, owner) => this.query(from, to, owner);
    this.targets = [];
    this.candidates = [];
    this.queryPlayer = (from, to) => this.query(from, to);
    this.reset(null);
  }

  reset(id, difficulty = 'regular', limit, seed = 87351, director = null) {
    this.director = director;
    this.mission = director?.plan ?? groundMissions[id];
    this.key = id;
    this.enabled = Boolean(this.mission);
    this.difficulty = groundDifficulty[difficulty] ?? groundDifficulty.regular;
    this.time = this.hitCount = this.destroyed = this.friendlyFire = 0;
    this.controls = { friendly: 0, opposing: 0 };
    this.losses = { friendly: 0, opposing: 0, neutral: 0 };
    this.hits = new Set();
    this.playerDisabled = new Set();
    this.outcome = '';
    this.reason = '';
    this.notice = '';
    this.noticeUntil = 0;
    this.randomState = seed;
    this.weapons.clear();
    let definitions = director?.plan.definitions ?? (id === 'qualification' ? qualificationVehicles() : id === 'convoy' ? convoyVehicles(this.roads) : id === 'battlefield' ? supportVehicles((seed % 266 + 266) % 266 - 103) : []);
    if (limit !== undefined) {
      const template = id === 'battlefield' && limit < definitions.length
        ? definitions.map((_, index) => definitions[Math.floor(index / 2) + index % 2 * (definitions.length / 2)])
        : definitions;
      definitions = Array.from({ length: limit }, (_, index) => {
        const base = template[index % template.length];
        return { ...base, id: `${base.id}-${index}`, z: base.z + (base.faction === 'friendly' ? -1 : 1)
          * Math.floor(index / template.length) * 67 };
      });
    }
    this.targets = [];
    this.spawn(definitions);
    this.transports = this.targets.filter((unit) => unit.objective === 'deliver');
    this.engagement = new GroundEngagement(this.world, this.targets, this.weapons, () => this.random());
    this.occupied = (owner, x, z, radius) => this.occupiedAt(owner, x, z, radius);
  }

  spawn(definitions) {
    for (const definition of definitions) {
      this.targets.push(new GroundVehicle(this.world, definition, groundVehicles[definition.type],
        (vehicle, context, destroyed) => this.damaged(vehicle, context, destroyed)));
    }
  }

  random() {
    this.randomState = (Math.imul(1664525, this.randomState) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }

  query(from, to, owner) {
    const left = Math.min(from.x, to.x) - 7;
    const right = Math.max(from.x, to.x) + 7;
    const near = Math.min(from.z, to.z) - 7;
    const far = Math.max(from.z, to.z) + 7;
    const results = this.candidates;
    results.length = 0;
    for (const structure of this.world.structures) {
      if (structure.max[0] >= left && structure.min[0] <= right && structure.max[2] >= near && structure.min[2] <= far) results.push(structure);
    }
    for (const unit of this.targets) {
      if (unit === owner || unit.arrived || (!unit.active && !(unit.wreckUntil > this.time))) continue;
      const { x, z } = unit.position;
      if (x >= left && x <= right && z >= near && z <= far) {
        for (const part of unit.colliders) if (part.active) results.push(part);
      }
    }
    return results;
  }

  occupiedAt(owner, x, z, radius) {
    for (const obstacle of this.targets) {
      if (obstacle === owner || obstacle.arrived || (!obstacle.active && !(obstacle.wreckUntil > this.time))) continue;
      const gap = radius + obstacle.radius + (owner.formation && obstacle.formation ? 5 : 1.5);
      if ((obstacle.position.x - x) ** 2 + (obstacle.position.z - z) ** 2 < gap ** 2) return true;
    }
    return this.world.structures.some(({ min, max }) =>
      x >= min[0] - radius && x <= max[0] + radius && z >= min[2] - radius && z <= max[2] + radius);
  }

  step(dt, observer) {
    if (!this.enabled || this.outcome) return;
    this.time += dt;
    for (const unit of this.targets) {
      if (!unit.active) {
        if (unit.wreckUntil && this.time >= unit.wreckUntil && unit.colliders[0].active) {
          for (const part of unit.colliders) part.active = false;
        }
        continue;
      }
      if (unit.arrived) continue;
      const distance = observer ? unit.position.distanceToSquared(observer) : Infinity;
      const detail = distance < 950 ** 2 || unit.lineOfSight ? 2 : distance < 3100 ** 2 ? 1 : 0;
      unit.detail = detail;
      const profile = unit.faction === 'opposing' ? this.difficulty : groundDifficulty.regular;
      this.engagement.step(unit, this.time, dt, profile, detail);
      moveVehicle(unit, dt, this.time, detail === 2 ? .045 : detail === 1 ? .08 : .125, this.occupied);
    }
    this.weapons.step(dt);
    if (this.director) this.director.update(this);
    else this.evaluate(dt);
  }

  damaged(unit, hit, destroyed) {
    this.director?.damageEvent(this, unit, hit, destroyed);
    if (hit.amount > 0 && hit.source === 'player') {
      this.hits.add(unit.id);
      this.hitCount = this.hits.size;
      if (unit.faction === 'opposing' && unit.disabled) this.playerDisabled.add(unit.id);
      if (unit.faction === 'friendly') this.friendlyFire++;
      this.notice = unit.faction === 'friendly' ? 'FRIENDLY FIRE'
        : destroyed ? `${unit.name.toUpperCase()} DISABLED` : `${unit.name.toUpperCase()} HIT`;
      this.noticeUntil = this.time + 2.2;
    }
    if (!destroyed) return;
    this.losses[unit.faction]++;
    if (hit.source === 'player' && unit.faction === 'opposing') this.destroyed++;
    unit.wreckUntil = this.time + 15;
    unit.visibleUntil = this.time + 47;
    unit.colliders[0].active = true;
    this.effects.destroyed?.(unit, hit, this.time);
  }

  evaluate(dt) {
    if (this.key === 'qualification') {
      const targets=this.targets.filter(unit=>unit.objective==='qualify');
      if (targets.every(unit=>unit.disabled)) this.finish('win',
        this.friendlyFire ? 'Qualification targets disabled; friendly-fire incidents recorded.' : 'All qualification targets disabled. Friendlies protected.');
      else if(this.time>=this.mission.timeLimit) this.finish('loss','Qualification time limit expired.');
      return;
    }
    if (this.key === 'convoy') {
      if (this.transports.some((unit) => unit.arrived)) this.finish('loss', 'A designated transport reached the exit.');
      else if (this.transports.length && this.transports.every((unit) => unit.disabled)) this.finish('win', 'Every designated transport was stopped.');
      else if (this.time >= this.mission.timeLimit) this.finish('loss', 'The interception window expired.');
      return;
    }
    const zone = this.mission.objective;
    let friendly = 0;
    let opposing = 0;
    let mobileFriendly = 0;
    let mobileOpposing = 0;
    for (const unit of this.targets) {
      if (unit.disabled) continue;
      const inside = (unit.position.x - zone.x) ** 2 + (unit.position.z - zone.z) ** 2 <= zone.radius ** 2;
      if (unit.faction === 'friendly') {
        mobileFriendly++;
        if (inside) friendly++;
      } else if (unit.faction === 'opposing') {
        mobileOpposing++;
        if (inside) opposing++;
      }
    }
    if (friendly > opposing) this.controls.friendly += dt * (opposing ? .32 : 1);
    if (opposing > friendly) this.controls.opposing += dt * (friendly ? .32 : 1);
    if (this.controls.friendly >= 26 || (!mobileOpposing && friendly)) this.finish('win', 'Friendly units secured Relay crossing.');
    else if (this.controls.opposing >= 26 || (!mobileFriendly && opposing)) this.finish('loss', 'Opposing units secured Relay crossing.');
    else if (this.time >= this.mission.timeLimit || !mobileFriendly && !mobileOpposing) {
      const score = this.controls.friendly - this.controls.opposing + (mobileFriendly - mobileOpposing) * 2;
      this.finish(score > 1.5 ? 'win' : score < -1.5 ? 'loss' : 'draw', 'Control and surviving mobile units decided the crossing.');
    }
  }

  finish(outcome, reason) {
    this.outcome = outcome;
    this.reason = reason;
    this.director?.finish(this, outcome, reason);
  }

  get convoyStopped() { return this.transports.filter((unit) => unit.disabled).length; }
}
