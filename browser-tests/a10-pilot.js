export { Vector3 } from 'three';

// Deterministic controls for a straight-ahead circuit on the simulated runway.
export function runwayPilot(flight, state, controls) {
  const height = flight.position.y - flight.world.heightAt(flight.position.x, flight.position.z) - flight.spec.gearClearance;
  let throttle = 0;
  let pitch = 0;
  let brakes = false;
  if (state.phase === 'roll') {
    throttle = 1;
    if (flight.airspeed > 118) pitch = .55;
    if (!flight.grounded) state.phase = 'climb';
  } else if (state.phase === 'climb') {
    if (height > 9) flight.gearDown = false;
    if (flight.gear < .005) {
      state.retracted = true;
      state.phase = 'approach';
      flight.gearDown = true;
      flight.cycleFlaps();
    }
    pitch = Math.max(-.30, Math.min(.25, (3 - flight.velocity.y) * .055));
    if (flight.throttle > .72) throttle = -.25;
  } else if (state.phase === 'approach' && !flight.grounded) {
    const target = -Math.max(1.7, Math.min(8, height * .30));
    pitch = Math.max(-.33, Math.min(.38, (target - flight.velocity.y) * .055));
    throttle = flight.airspeed > 138 ? -.75 : flight.airspeed < 130 ? .55 : 0;
  } else {
    state.phase = 'stop';
    throttle = -1;
    brakes = true;
  }
  return { ...controls, throttle, pitch, assisted: false, brakes };
}

export function lineUpGunPass(flight, target, forward, aim, path) {
  const rear = path.copy(forward).applyQuaternion(target.orientation).normalize();
  const engine = target.colliders.find(({ component }) => component === 'engine').position;
  flight.position.copy(engine).addScaledVector(rear, -175);
  flight.position.y = Math.max(engine.y + 54, flight.world.heightAt(flight.position.x, flight.position.z) + 25);
  aim.copy(engine).addScaledVector(rear, target.speed * .17);
  // Compensate for the offset muzzle and the short ballistic arc.
  aim.y += .68;
  aim.sub(flight.position).normalize();
  flight.orientation.setFromUnitVectors(forward, aim);
  flight.velocity.copy(aim).multiplyScalar(82);
  flight.rates.set(0, 0, 0);
  flight.grounded = flight.gearDown = false;
  flight.gear = 0;
}
