import {makeChain,stepChain,resamplePath} from './xpbd-chains-v13.mjs';
// Local physics for painted ribbon tails and bow loops. Coordinates are in the
// 1122 x 1402 source artwork; this runs before the owning body/cloth transform.
// No timers, images, event listeners, or renderer resources are owned here.
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const smooth = (lo, hi, value) => {
  const t = clamp((value - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};
const radians = value => value * Math.PI / 180;

// Compact C2 kernel: zero displacement AND zero derivative at its outer edge.
const kernel = distance => {
  const t = clamp(distance, 0, 1);
  return (1 - t * t) ** 3;
};
const rotateDelta = (x, y, pivot, angle) => {
  const a = radians(angle), c = Math.cos(a), s = Math.sin(a);
  const dx = x - pivot[0], dy = y - pivot[1];
  return [dx * (c - 1) - dy * s, dx * s + dy * (c - 1)];
};

export const GARMENT_RIG = Object.freeze({
  chestKnot: [537, 355],
  roseKnot: [635, 531],
  waistTails: [
    [[637, 550], [637, 555], [639, 575], [641, 595], [643, 615],
      [645, 635], [646, 655], [648, 675], [646, 695], [647, 715],
      [644, 742], [640, 766]],
    [[646, 550], [650, 555], [657, 575], [662, 595], [666, 615],
      [670, 635], [673, 655], [675, 675], [678, 695], [678, 715],
      [677, 728]],
  ],
  chestTails: [
    [[528, 365], [518, 388], [508, 412]],
    [[545, 365], [554, 390], [562, 412]],
  ],
  chestLoops: [
    { center: [511, 354], radius: [27, 16] },
    { center: [560, 355], radius: [27, 16] },
  ],
});

function chainSample(nodes, fraction) {
  if (!nodes?.length) return [0, 0];
  const level = clamp(fraction, 0, 1) * (nodes.length - 1);
  const i = Math.min(nodes.length - 2, Math.floor(level));
  const u = level - i, mix = u * u * (3 - 2 * u);
  return [
    nodes[i][0] + (nodes[i + 1][0] - nodes[i][0]) * mix,
    nodes[i][1] + (nodes[i + 1][1] - nodes[i][1]) * mix,
  ];
}

function pathX(path, y) {
  for (let i = 1; i < path.length; i++) {
    if (y <= path[i][1]) {
      const a = path[i - 1], b = path[i];
      const t = clamp((y - a[1]) / (b[1] - a[1]), 0, 1);
      return a[0] + (b[0] - a[0]) * t;
    }
  }
  return path[path.length - 1][0];
}

/**
 * Advances subordinate garment springs. Call once per frame after the body's
 * root and cloth pose have settled. The host is the existing ShioPuppet spring
 * owner; pose.garment contains only this module's numeric simulation state.
 */
export function updateGarmentMotion(host, pose, dt) {
  const h=clamp(finite(dt),0,.05),t=finite(pose.time),activity=clamp(finite(pose.activity),0,1.5),wind=clamp(finite(pose.wind),-1.6,1.6);
  const vx=clamp(finite(host.springs?.pelvisX?.velocity),-60,60),vy=clamp(finite(host.springs?.pelvisY?.velocity),-60,60),rv=clamp(finite(host.springs?.bodyRoll?.velocity),-35,35);
  const g=pose.garment??={};
  g.waistTails??=Array.from({length:2},()=>Array.from({length:6},()=>[0,0]));
  g.chestTails??=Array.from({length:2},()=>Array.from({length:4},()=>[0,0]));
  g.chestLoops??=[0,0];g.solvers??={};
  const kinetics=pose.kinetics??{acceleration:{},velocity:{}};
  const ax=h?clamp((vx-finite(g.previousRootVelocity,vx))/Math.max(h,.008),-170,170):0;
  g.previousRootVelocity=vx;
  const spring=(key,target,k,d,limit)=>{
    const value=host.spring(key,clamp(target,-limit,limit),h,k,d),bounded=clamp(finite(value),-limit,limit);
    const s=host.springs?.[key];if(s&&value!==bounded){s.value=bounded;if(Math.sign(s.velocity)===Math.sign(value))s.velocity=0;}
    return bounded;
  };
  const rig=host.model?.physics?.garmentRig??GARMENT_RIG;
  function angularChain(path,nodes,key,drive,limit,frequency,damping,phase){
    const chain=g.solvers[key]??=makeChain(resamplePath(path,nodes.length),'silk');
    if(!chain.silkTuned){chain.material={...chain.material,shape:18,damping:4.3};chain.silkTuned=true;}stepChain(chain,h,[drive*100,-(kinetics.acceleration.y??0)*.18],wind*24);
    for(let n=0;n<nodes.length;n++)nodes[n]=[chain.points[n][0]-chain.rest[n][0],chain.points[n][1]-chain.rest[n][1]];
  }
  for(let side=0;side<2;side++){
    const inertial=-vx*.035-ax*.013-rv*.055-(kinetics.velocity.yaw??0)*.035-(kinetics.acceleration.yaw??0)*.009-(kinetics.acceleration.hipRoll??0)*.04;
    const idle=Math.sin(t*1.28-side*.65)*.65*activity;
    const drive=clamp(inertial+wind*(4.6+side*.65)+idle,-9,9);
    angularChain(rig.waistTails[side],g.waistTails[side],'garment8-waist-angle-'+side+'-',drive,3,70-side*3,9.2,side*.7);
    const bustVelocity=(finite(host.springs?.['secondary-bust-y0']?.velocity)+finite(host.springs?.['secondary-bust-y1']?.velocity))*.5;
    const bowDrive=clamp(-vx*.048-ax*.012-rv*.12-bustVelocity*.18+wind*4.2+Math.sin(t*1.38-side*.45)*1.8*activity-(kinetics.acceleration.yaw??0)*.012,-6,6);
    g.chestLoops[side]=spring('garment8-loop-'+side,bowDrive*(side?-.86:1),side?96:109,side?11:11.8,9);
    angularChain(rig.chestTails[side],g.chestTails[side],'garment8-chest-angle-'+side+'-',bowDrive*.65,4.1,108-side*4,12,side+1);
  }
  return g;
}


function tailField(x, y, paths, chains, knot, radius, maximum) {
  let dx = 0, dy = 0, total = 0;
  for (let side = 0; side < paths.length; side++) {
    const path = paths[side], start = path[0][1], end = path[path.length - 1][1];
    if (y <= start || y >= end + radius) continue;
    const center = pathX(path, clamp(y, start, end));
    const offsetY = Math.max(0, y - end);
    const q = Math.hypot((x - center) / radius, offsetY / radius);
    if (q >= 1) continue;
    const weight = kernel(q) * smooth(start, start + 20, y);
    const value = chainSample(chains[side], (y - start) / (end - start));
    dx += value[0] * weight;
    dy += value[1] * weight;
    total += weight;
  }
  if (total === 0) return [0, 0];
  // The regularized blend avoids a hard seam where the two painted tails
  // overlap. A compact collar fixes the knot and the fabric immediately under it.
  const pin = smooth(7, 23, Math.hypot(x - knot[0], y - knot[1]));
  const scale = pin / (.25 + total);
  dx *= scale;
  dy *= scale;
  const length = Math.hypot(dx, dy);
  if (length > maximum) {
    dx *= maximum / length;
    dy *= maximum / length;
  }
  return [dx, dy];
}

/**
 * Returns garment-local coordinates. Invoke BEFORE jewellery attachment and
 * local cloth/body transforms, which then carry these details with their owner.
 * Other layers (hair, arms, face, neck-front) are deliberately unaffected.
 * physics.garmentRig may override the artwork paths without changing simulation.
 */
export function deformGarment(layer, x, y, pose, physics) {
  const g = pose.garment;
  if (!g) return [x, y];
  const rig = physics?.garmentRig ?? GARMENT_RIG;
  const body = layer.kind === 'body' && layer.name === 'body';
  const skirt = layer.kind === 'cloth' && layer.side === 1;
  if (!body && !skirt) return [x, y];
  if (skirt && y > 544 && y < 840 && x > 565 && x < 755) {
    const value = tailField(x, y, rig.waistTails, g.waistTails, rig.roseKnot, 28, 14);
    return [x + value[0], y + value[1]];
  }
  if (!body || y < 330 || y > 444 || x < 475 || x > 598) return [x, y];

  let dx = 0, dy = 0, total = 0;
  const pin = smooth(7, 20, Math.hypot(x - rig.chestKnot[0], y - rig.chestKnot[1]));
  for (let side = 0; side < rig.chestLoops.length; side++) {
    const loop = rig.chestLoops[side];
    const q = Math.hypot((x - loop.center[0]) / loop.radius[0], (y - loop.center[1]) / loop.radius[1]);
    if (q >= 1) continue;
    const weight = kernel(q) * pin;
    const d = rotateDelta(x, y, rig.chestKnot, g.chestLoops[side]);
    dx += d[0] * weight;
    dy += d[1] * weight;
    total += weight;
  }
  if (total > 0) {
    dx /= .25 + total;
    dy /= .25 + total;
  }
  const tails = tailField(x, y, rig.chestTails, g.chestTails, rig.chestKnot, 20, 7.2);
  return [x + dx + tails[0], y + dy + tails[1]];
}



