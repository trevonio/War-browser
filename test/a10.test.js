import test from 'node:test';
import assert from 'node:assert/strict';
import { a10 } from '../src/aircraft/a10.js';
import { aircraftRegistry } from '../src/aircraft/registry.js';
import { Flight, neutralControls, STEP } from '../src/sim/flight.js';
import { range, scenarios } from '../src/sim/range.js';
import { availablePresets, configurableStations, resolveLoadout } from '../src/sim/loadouts.js';
import { GroundBattle } from '../src/sim/ground/battlefield.js';

test('A-10C is registered as a third playable aircraft with an unguided CAS configuration', () => {
  assert.deepEqual(Object.keys(aircraftRegistry).sort(), ['a10c','f15c','f16c']);
  assert.equal(a10.engines.length,2);
  assert.equal(a10.afterburnerThrust,0);
  assert.deepEqual(a10.weaponDomains,['air','ground']);
  assert.equal(configurableStations(a10).length,11);
  assert.equal(a10.cannon.name,'GAU-8/A');
  assert.equal(a10.cannon.capacity,1174);
  assert.ok(a10.cannon.rpm < aircraftRegistry.f16c.spec.cannon.rpm);
});

test('A-10C four CAS presets are physically valid', () => {
  const presets=availablePresets(a10);
  for(const name of ['Gun Run','Mixed CAS','Precision Support','Clean']) {
    assert.ok(presets[name],name);
    assert.deepEqual(resolveLoadout(a10,presets[name]).errors,[],name);
  }
  assert.equal(resolveLoadout(a10,presets.Clean).stations.length,0);
  assert.ok(resolveLoadout(a10,presets['Mixed CAS']).mass > 0);
  assert.ok(presets['Precision Support'].HP_06==='pod');
  assert.ok(resolveLoadout(a10,{HP_01:'bomb'}).errors.length>0);
});

test('A-10C shares flight mechanics but cannot arm afterburner', () => {
  const flight=new Flight(a10,range);
  flight.reset(scenarios.runway);
  assert.equal(flight.grounded,true);
  assert.ok(Math.abs(flight.position.y-range.heightAt(flight.position.x,flight.position.z)-a10.gearClearance)<.01);
  flight.toggleAfterburner();
  assert.equal(flight.burnerArmed,false);
  assert.equal(flight.engines.states.length,2);
  for(let i=0;i<90;i++)flight.step(neutralControls,STEP);
  assert.equal(flight.afterburner,false);
});

test('A-10C engine damage reduces thrust asymmetrically without instantly losing aircraft', () => {
  for(const [engineIndex,component] of ['leftEngine','rightEngine'].entries()) {
    const flight=new Flight(a10,range);
    flight.reset({...scenarios.air,y:2100,speed:135,throttle:1});
    flight.damage.hit(component,a10.damageComponents[component].capacity);
    for(let i=0;i<150;i++)flight.step({...neutralControls,assisted:false},STEP);
    assert.equal(flight.engines.states[engineIndex].thrust,0);
    assert.ok(flight.engines.states[1-engineIndex].thrust>1000);
    assert.notEqual(flight.engines.yawMoment,0);
    assert.equal(flight.failure,'');
  }
});

test('A-10C qualification has static/moving targets and protected identification friendlies', () => {
  const battle=new GroundBattle(range);
  battle.reset('qualification','regular');
  assert.equal(battle.targets.filter(v=>v.objective==='qualify').length,4);
  assert.equal(battle.targets.filter(v=>v.faction==='friendly').length,2);
  assert.equal(battle.targets.filter(v=>v.objective==='qualify'&&v.route.length===0).length,2);
  assert.equal(battle.targets.filter(v=>v.objective==='qualify'&&v.route.length>0).length,2);
  for(let i=0;i<120;i++)battle.step(STEP);
  assert.ok(battle.targets.filter(v=>v.faction==='friendly').every(v=>v.active));
  for(const target of battle.targets.filter(v=>v.objective==='qualify')) {
    target.hit('hull',999,{source:'player',kind:'rocket'});
  }
  battle.step(STEP);
  assert.equal(battle.outcome,'win');
  assert.equal(battle.losses.friendly,0);
});
