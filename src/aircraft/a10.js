import { horizontalSteering } from '../sim/instructor.js';
import { f16 } from './f16.js';

const hp = (num, x, y, z, allowed, limit = 700) => ({
  name: 'HP_' + String(num).padStart(2, '0'), label: 'Station ' + num,
  offset: [x, y, z], rotation: [0, 0, 0], release: [0, -0.12, 0],
  wing: x > 0 ? 'leftWing' : x < 0 ? 'rightWing' : 'fuselage',
  symmetry: 'a10-' + Math.min(num, 12 - num), allowed, limit,
});
const positions = [7.35,6.25,5.15,4.05,3.15];
const stations = [
  ...positions.map((x, i) => hp(i + 1, x, -.70, .75, i === 0 ? ['infrared'] : ['bomb','rocket','laser','gps','optical','tank'], i === 0 ? 120 : 850)),
  hp(6,0,-1.205,.425,['pod','bomb','tank'],850),
  ...positions.map((x,i) => hp(i+7,-positions[4-i],-.70,.75, i === 4 ? ['infrared'] : ['bomb','rocket','laser','gps','optical','tank'], i === 4 ? 120 : 850)),
];
const components = {
  fuel: { label: 'Fuel system', capacity: 25, volumes: [[0,-.15,0,1.35]] },
  fuselage: { label: 'Fuselage', capacity: 62, volumes: [[0,0,4.7,1.35],[0,0,-1.5,1.4],[0,.05,-5.8,1.15]] },
  pilot: { label: 'Pilot', capacity: 10, volumes: [[0,1.1,3.9,.64]] },
};
for (const [side,sign] of [['left',1],['right',-1]]) {
  components[side+'Engine'] = { label: side+' engine',capacity:28,volumes:[[sign*1.95,.9,-2.15,.86]] };
  components[side+'Wing'] = { label: side+' wing',capacity:34,volumes:[[sign*3.15,-.25,-.65,1.35],[sign*6,-.25,-.55,1.0]] };
  components[side+'Stabilator'] = { label:side+' elevator',capacity:15,volumes:[[sign*1.7,.3,-7.5,.8]] };
  components[side+'Flaperon'] = { label:side+' aileron',capacity:13,volumes:[[sign*4.65,-.27,-.55,.83]] };
  components[side+'Fin'] = { label:side+' vertical tail',capacity:14,volumes:[[sign*2.95,1.05,-7.3,.83]] };
  components[side+'Gear'] = { label:side+' landing gear',capacity:12,volumes:[[sign*2.35,-1,-.3,.70]] };
}
const ir = [1,11].map(i=>({...stations[i-1],type:'infrared'}));
export const a10 = {
  id:'a10c',shortName:'A-10C',name:'A-10C Thunderbolt II',
  manufacturer:'Fairchild Republic',role:'Close air support',
  description:'Twin-engine subsonic attack aircraft built for stable low-speed ground support and heavy cannon employment.',
  weaponDomains:['air','ground'],hardpoints:ir,
  storeStations:{overrides:Object.fromEntries(ir.map(s=>[s.name,{allowed:s.allowed,limit:s.limit}])),
    extra:stations.slice(1,10),tankLimit:2},
  loadouts:{
    intercept:{stations:ir,flare:22,chaff:14},
    short:{stations:ir,flare:22,chaff:14},
    outnumbered:{stations:ir,flare:12,chaff:8},
  },
  radar:{label:'Visual/EO support',ranges:[900,2500,4700],bearing:.65,lockBearing:.68,elevation:.53,
    searchInterval:.8,twsInterval:.45,lockInterval:.3,capacity:1},
  engines:[
    {component:'leftEngine',lateral:1.95,share:.5,exhaust:[1.95,.9,-2.15]},
    {component:'rightEngine',lateral:-1.95,share:.5,exhaust:[-1.95,.9,-2.15]},
  ],
  emptyMass:11600,fuelCapacity:4800,storesMass:920,wingArea:47.0,opticalSpan:17.5,
  militaryThrust:80400,afterburnerThrust:0,idleFuelFlow:.24,militaryFuelFlow:2.35,
  afterburnerFuelFlow:2.35,spoolResponse:1.08,thrustLapse:.60,yawInertia:48,
  baseLift:.12,liftSlope:4.9,stallAngle:.37,baseDrag:.035,inducedDrag:.115,waveDrag:.054,maxMach:.82,
  horizontalSteering:{...horizontalSteering,fineAngle:.10,fullBankAngle:.68,rollGain:2.2,response:6.4,highSpeedRudder:.56},
  controlSpeed:87,pitchRate:.61,rollRate:1.2,yawRate:.33,maxG:7.3,minG:-2.4,
  gearClearance:2.1,gearTime:2.25,chaseDistance:35,
  surfaces:{separateFlaps:true,speedBrake:true,
    limits:{Flap:[0,40],SpeedBrake:[0,55],LeftFlaperon:[-25,20],RightFlaperon:[-25,20],LeftStabilator:[-30,20],RightStabilator:[-30,20]}},
  damageComponents:components,
  damageEmitters:{leftEngine:[1.95,.9,-2.15],rightEngine:[-1.95,.9,-2.15],fuel:[0,-.65,.3]},
  cannon:{...f16.cannon,name:'GAU-8/A',caliber:30,rpm:3900,capacity:1174,
    muzzle:[0,-.60,8.15],bore:[0,0,1],projectileSpeed:950,
    lifetime:2.7,maxDistance:2450,tracerEvery:7,damage:1.65},
  audio:{pitch:.66,gain:1.24},
  tactics:{energySpeed:.68,extendAt:118,pursuitLag:50},
};
