import { MathUtils } from 'three';

const { clamp } = MathUtils;
const anySolid = (world, x, z, radius) => world.structures.some(({ min, max }) =>
  x >= min[0] - radius && x <= max[0] + radius && z >= min[2] - radius && z <= max[2] + radius);

export function traversable(world, x, z, nextX, nextZ, radius, maxSlope) {
  if (anySolid(world, nextX, nextZ, radius)) return false;
  const high = world.surfaceAt(nextX, nextZ);
  if (high <= 0) return false;
  const distance = Math.hypot(nextX - x, nextZ - z);
  return Math.abs(high - world.heightAt(x, z)) <= Math.max(.12, distance * maxSlope);
}

export class RoadNetwork {
  constructor(world, points, links) {
    this.points = points;
    this.edges = links.filter(([from, to]) => this.canJoin(world, points[from], points[to]));
    this.adjacent = Object.fromEntries(Object.keys(points).map((id) => [id, []]));
    for (const [a, b] of this.edges) {
      const cost = Math.hypot(points[a][0] - points[b][0], points[a][1] - points[b][1]);
      this.adjacent[a].push([b, cost]);
      this.adjacent[b].push([a, cost]);
    }
  }

  canJoin(world, a, b) {
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 12));
    let [x, z] = a;
    for (let index = 1; index <= steps; index++) {
      const nextX = MathUtils.lerp(a[0], b[0], index / steps);
      const nextZ = MathUtils.lerp(a[1], b[1], index / steps);
      if (!traversable(world, x, z, nextX, nextZ, 4, 0.22)) return false;
      x = nextX;
      z = nextZ;
    }
    return true;
  }

  route(from, to) {
    const open = new Set(Object.keys(this.points));
    const previous = new Map();
    const cost = new Map([[from, 0]]);
    while (open.size) {
      let best;
      let value = Infinity;
      for (const id of open) {
        if ((cost.get(id) ?? Infinity) < value) {
          best = id;
          value = cost.get(id);
        }
      }
      if (!best) return [];
      if (best === to) {
        const path = [to];
        while (previous.has(path[0])) path.unshift(previous.get(path[0]));
        return path;
      }
      open.delete(best);
      for (const [edge, length] of this.adjacent[best]) {
        if (!open.has(edge) || value + length >= (cost.get(edge) ?? Infinity)) continue;
        cost.set(edge, value + length);
        previous.set(edge, best);
      }
    }
    return [];
  }
}

export function moveVehicle(unit, seconds, time, cadence, occupied) {
  const { position, drive, world, spec, route } = unit;
  unit.previous.copy(position);
  if (drive.planAt <= time) {
    const dt = Math.min(0.25, Math.max(cadence, time - drive.planAt + cadence));
    drive.planAt = time + cadence;
    planMotion(unit, dt, time, occupied);
  }
  if (drive.x || drive.z) {
    const x = position.x + drive.x * seconds;
    const z = position.z + drive.z * seconds;
    if (occupied(unit, x, z, unit.radius)) {
      drive.x = drive.z = drive.dy = 0;
      unit.speed = Math.max(0, unit.speed - spec.braking * seconds);
    } else {
      position.x = x;
      position.z = z;
      position.y += drive.dy * seconds;
      unit.travel += Math.hypot(drive.x, drive.z) * seconds;
    }
  }
  if (route.length && drive.waypoint >= route.length && unit.formation) {
    unit.arrived = true;
    for (const part of unit.colliders) part.active = false;
  }
  unit.syncPose();
}

function planMotion(unit, dt, time, occupied) {
  const { position, drive, world, spec, route, mobility } = unit;
  const blocked = unit.travel - drive.progressAt < 0.09;
  drive.progressAt = unit.travel;
  const moving = mobility > .02 && ['MOVING', 'REPOSITIONING', 'RETREATING', 'PATROLLING'].includes(unit.phase);
  const waypoint = route[drive.waypoint];
  if (moving && waypoint && Math.hypot(waypoint[0] - position.x, waypoint[1] - position.z) < 8.5) drive.waypoint++;
  const intended = unit.retreatTo ?? route[drive.waypoint];
  if (moving && intended) drive.stuck = blocked ? drive.stuck + dt : Math.max(0, drive.stuck - dt);
  else drive.stuck = 0;

  if (moving && intended && drive.stuck > 1.2 && !drive.detour) {
    const angle = Math.atan2(intended[0] - position.x, intended[1] - position.z);
    for (const direction of [1, -1]) {
      const x = position.x + Math.sin(angle + direction * 1.12) * 25;
      const z = position.z + Math.cos(angle + direction * 1.12) * 25;
      if (!occupied(unit, x, z, unit.radius + 3)
        && traversable(world, position.x, position.z, x, z, unit.radius, spec.slope)) {
        drive.detour = [x, z];
        drive.detourUntil = time + 7;
        unit.phase = 'REPOSITIONING';
        break;
      }
    }
  }
  if (drive.detour && (time >= drive.detourUntil
    || Math.hypot(drive.detour[0] - position.x, drive.detour[1] - position.z) < 4)) drive.detour = null;
  const target = drive.detour ?? intended;
  let wanted = 0;
  if (moving && target) {
    const yaw = Math.atan2(target[0] - position.x, target[1] - position.z);
    unit.steering = clamp(Math.sin(yaw - unit.yaw), -.65, .65);
    unit.steer(yaw, dt);
    const turn = Math.max(0, Math.cos(yaw - unit.yaw));
    wanted = spec.speed * mobility * turn * (unit.formation ? 0.64 : 0.77);
    if (drive.detour) wanted *= 0.68;
    const lead = Math.max(unit.radius + 4, unit.speed * 0.78);
    if (occupied(unit, position.x + Math.sin(unit.yaw) * lead, position.z + Math.cos(unit.yaw) * lead, unit.radius)) wanted = 0;
  }
  if (!moving && !mobility) unit.speed = 0;
  unit.speed = Math.max(0, unit.speed + clamp(wanted - unit.speed, -spec.braking * dt, spec.acceleration * dt));
  let x = Math.sin(unit.yaw) * unit.speed;
  let z = Math.cos(unit.yaw) * unit.speed;
  const nextX = position.x + x * dt;
  const nextZ = position.z + z * dt;
  if (unit.speed > 0 && !traversable(world, position.x, position.z, nextX, nextZ, unit.radius, spec.slope)) {
    unit.speed = x = z = 0;
  }
  drive.x = x;
  drive.z = z;
  drive.dy = unit.speed > 0 ? clamp((world.heightAt(nextX, nextZ) - position.y) / dt, -unit.speed * spec.slope, unit.speed * spec.slope) : 0;
  const length = spec.dimensions[2] * 0.38;
  const width = spec.dimensions[0] * 0.44;
  const sin = Math.sin(unit.yaw);
  const cos = Math.cos(unit.yaw);
  const along = world.heightAt(position.x + sin * length, position.z + cos * length)
    - world.heightAt(position.x - sin * length, position.z - cos * length);
  const across = world.heightAt(position.x + cos * width, position.z - sin * width)
    - world.heightAt(position.x - cos * width, position.z + sin * width);
  unit.pitch = MathUtils.lerp(unit.pitch, -Math.atan2(along, length * 2), dt * 4);
  unit.roll = MathUtils.lerp(unit.roll, Math.atan2(across, width * 2), dt * 4);
}
