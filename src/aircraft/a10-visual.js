import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cannonMount } from '../sim/cannon.js';
import { a10 } from './a10.js';
const rad=T.MathUtils.degToRad;
const lerp=T.MathUtils.lerp;
const rigNames=['Aileron_Left','Aileron_Right','Elevator_Left','Elevator_Right',
  'Rudder_Left','Rudder_Right','Flap_Left','Flap_Right',
  'Deceleron_Left_Upper','Deceleron_Left_Lower','Deceleron_Right_Upper','Deceleron_Right_Lower',
  'LandingGear_Left','LandingGear_Right','LandingGear_Nose','GearDoor_Main_Left',
  'GearDoor_Main_Right','GearDoor_Nose_Left','GearDoor_Nose_Right',
  'EngineFan_Left','EngineFan_Right','GAU8_Barrels'];
let loading;
export async function loadA10Visual() {
  loading ??= new GLTFLoader().loadAsync('/assets/A10C.glb').catch(error=>{loading=null;throw error;});
  const {scene}=await loading;
  for(const name of [...rigNames,'A10C_ROOT','HP_GAU8_Muzzle',...Array.from({length:11},(_,i)=>'HP_'+String(i+1).padStart(2,'0'))]){
    if(!scene.getObjectByName(name))throw new Error('A-10C rig missing '+name);
  }
  return {create:()=>createVisual(scene),clone:(_source,hostile=false)=>createVisual(scene,hostile)};
}
function createVisual(template,hostile=false) {
  const root=new T.Group();
  root.name=hostile?'A-10C opponent':'A-10C visual';
  const airframe=template.clone(true);
  // Native GLB: -Z nose, +X right. Physics: +Z nose, +X left.
  // Rotate only the visual subtree; all named animation hinges retain native axes.
  airframe.rotation.y=Math.PI;
  root.add(airframe);
  const arm=new T.Group();
  arm.name='External stores';root.add(arm);
  const muzzle=cannonMount(a10.cannon);root.add(muzzle);
  const nodes=Object.fromEntries(rigNames.map(name=>[name,airframe.getObjectByName(name)]));
  const get=name=>airframe.getObjectByName(name);
  const wings={Left:get('Wing_Left'),Right:get('Wing_Right')};
  const tails={Left:get('HorizontalTail_Left'),Right:get('HorizontalTail_Right')};
  const fins={Left:get('VerticalTail_Left'),Right:get('VerticalTail_Right')};
  return {root,airframe,arm,muzzle,paint:[],
    update(state,time,blend=1) {
      const surface=key=>lerp(state.surfaces.previous[key]??0,state.surfaces.angles[key]??0,blend);
      const brakes=Math.max(0,surface('SpeedBrake'));
      const rudder=surface('Rudder');
      for(const side of ['Left','Right']){
        const lower=side.toLowerCase();
        nodes['Aileron_'+side].rotation.x=rad(surface(side+'Flaperon'));
        nodes['Elevator_'+side].rotation.x=rad(surface(side+'Stabilator'));
        nodes['Rudder_'+side].rotation.y=rad(rudder);
        nodes['Flap_'+side].rotation.x=rad(surface('Flap'));
        nodes['Deceleron_'+side+'_Upper'].rotation.x=rad(-brakes);
        nodes['Deceleron_'+side+'_Lower'].rotation.x=rad(brakes);
        wings[side].visible=state.damage.condition(lower+'Wing')>0;
        tails[side].visible=state.damage.condition(lower+'Stabilator')>0;
        fins[side].visible=state.damage.condition(lower+'Fin')>0;
        nodes['Aileron_'+side].visible=state.damage.condition(lower+'Flaperon')>0;
      }
      const g=1-state.gear;
      nodes.LandingGear_Left.rotation.x=nodes.LandingGear_Right.rotation.x=rad(86*g);
      nodes.LandingGear_Nose.rotation.x=rad(-90*g);
      const doors=Math.min(1,Math.max(0,(1-g)*1.6));
      for(const side of ['Left','Right'])for(const section of ['Main','Nose'])
        nodes['GearDoor_'+section+'_'+side].rotation.z=rad((side==='Left'?-80:80)*doors);
      for(const [index,side] of ['Left','Right'].entries()) {
        nodes['EngineFan_'+side].rotation.z+=(state.engines.states[index]?.spool??0)*.065;
      }
      nodes.GAU8_Barrels.rotation.z=time*6.8;
      arm.visible=state.stores;
    },
  };
}
