import { Vector3 } from 'three';
import { CombatExercise } from '../src/sim/combat/exercise.js';
import { Flight } from '../src/sim/flight.js';
import { GroundBattle } from '../src/sim/ground/battlefield.js';
import { RangeOrdnance } from '../src/sim/range-ordnance.js';
import { range } from '../src/sim/range.js';
import { runwayPilot } from './a10-pilot.js';

export function setUpQualification() {
  const state = { tookOff: false, releases: [], input: 'takeoff' };
  const pilot = { phase: 'roll' };
  const forward = new Vector3(0, 0, 1);
  const heading = new Vector3();
  const aim = new Vector3();
  const point = new Vector3();
  const prediction = new Vector3();
  const predictor = new RangeOrdnance(range);
  const step = Flight.prototype.step;
  const combatReset = CombatExercise.prototype.reset;
  const groundReset = GroundBattle.prototype.reset;
  const spawn = RangeOrdnance.prototype.spawn;

  CombatExercise.prototype.reset = function (mission, ...args) {
    combatReset.call(this, mission, ...args);
    if (mission === 'hornetQualification') state.combat = this;
  };
  GroundBattle.prototype.reset = function (mission, ...args) {
    groundReset.call(this, mission, ...args);
    if (mission === 'hornetQualification') state.battle = this;
  };
  RangeOrdnance.prototype.spawn = function (kind, flight, station, pod) {
    const result = spawn.call(this, kind, flight, station, pod);
    if (result && flight === state.combat?.player.flight) {
      const round = this.rounds.find(({ serial }) => serial === this.serial);
      const expected = new Vector3().fromArray(station.offset).add(new Vector3().fromArray(station.release))
        .applyQuaternion(flight.orientation).add(flight.position);
      state.releases.push({ kind, station: station.name, error: round.position.distanceTo(expected) });
    }
    return result;
  };
  function frame(flight, altitude, speed) {
    flight.position.copy(point);
    if (altitude !== undefined) flight.position.y = altitude;
    flight.orientation.setFromUnitVectors(forward, aim);
    flight.velocity.copy(heading).multiplyScalar(speed);
    flight.rates.set(0, 0, 0);
  }
  Flight.prototype.step = function (controls, dt) {
    const enemy = state.combat?.enemy;
    if (this !== state.combat?.player.flight) return step.call(this, controls, dt);
    const flight = this;
    if (state.input === 'takeoff') {
      const command = runwayPilot(flight, pilot, controls);
      step.call(flight, command, dt);
      if (!state.tookOff && !flight.grounded && flight.position.y > 34) {
        state.tookOff = true;
        state.input = 'climb';
      }
      return;
    }
    if (state.input === 'missile' || state.input === 'gun') {
      const target = enemy.flight;
      // Use a repeatable target course while the weapon and collision simulation
      // remain live. Full exercises retain the opponent's countermeasures.
      enemy.fight.pilot.mode = 'passive';
      enemy.nextEvade = Infinity;
      const gun = state.input === 'gun';
      heading.copy(forward).applyQuaternion(target.orientation).normalize();
      point.copy(target.position).addScaledVector(heading, gun ? -153 : -740);
      aim.copy(target.position).addScaledVector(target.velocity, gun ? .18 : 0).sub(point);
      if (gun) aim.y -= .18;
      aim.normalize();
      frame(flight, undefined, Math.max(110, target.velocity.length() + (gun ? 0 : 94)));
    }
    if (state.input === 'gps' || state.input === 'bomb') {
      const bomb = state.input === 'bomb';
      const target = state.battle.qualificationTargets[bomb ? 1 : 0];
      heading.set(0, 0, 1);
      aim.copy(heading);
      const height = bomb ? 127 : 187;
      const speed = 158;
      point.copy(target.position);
      point.z -= bomb ? 675 : 620;
      frame(flight, target.position.y + height, speed);
      if (bomb && !state.releases.some(({ kind }) => kind === 'bomb')) {
        const rack = state.combat.player.rack;
        // Use the production CCIP solution to establish a stable release pass.
        for (let i = 0; i < 2; i++) {
          if (!predictor.predict('bomb', flight, rack.station('bomb'), [], prediction)) break;
          flight.position.x += target.position.x - prediction.x;
          flight.position.z += target.position.z - prediction.z;
        }
      }
    }
    return step.call(flight, {
      ...controls, assisted: false, roll: 0, yaw: 0,
      pitch: state.input === 'climb' ? .34 : 0, throttle: state.input === 'climb' ? 1 : 0,
    }, dt);
  };
  return state;
}
