import {SemanticHeadSurface as ApprovedHeadSurface} from './head-core-v22.mjs';
import {torsoHeadDelta} from '../v16/torso-motion-v16.mjs';
// Preserve the approved head's material, proportions, facial deformation,
// angle selection and hair atlas. The torso transports it as a rigid unit.
export class SemanticHeadSurface extends ApprovedHeadSurface{
 mapSkull(x,y,state,global=false,binding=null){const point=super.mapSkull(x,y,state,global,binding);if(!global){const u=Math.max(0,-(state.pitch??0))/30;point[1]+=18*u*u*(3-2*u);}return point;}
 transform(x,y,state){
  const point=super.transform(x,y,state);const up=Math.max(0,-(state.pitch??0))/30,drop=18*up*up*(3-2*up),body=(state.bodyRoll??0)*Math.PI/180;point[0]-=drop*Math.sin(body);point[1]+=drop*Math.cos(body);
  if(!(state.torsoYaw||state.torsoPitch||state.upperLean||state.hipRoll))return point;
  const [dx,dy]=torsoHeadDelta(state),a=(state.bodyRoll??0)*Math.PI/180;
  return[point[0]+dx*Math.cos(a)-dy*Math.sin(a),point[1]+dx*Math.sin(a)+dy*Math.cos(a)];
 }
}
