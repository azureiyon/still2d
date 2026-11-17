const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {MotionMesh}=require('./engine.js'),{MotionMesh:OldMesh}=require('./reference-study/engine-v1.js');
const mesh=new MotionMesh(720,956),old=new OldMesh(720,956),n=mesh.count;
function weights(fn){return Float32Array.from({length:n},(_,i)=>fn(mesh.rest[i*2],mesh.rest[i*2+1]));}
const good={weights:weights((x,y)=>{const d=Math.hypot((x-510)/110,(y-710)/130);return d<1?(1-d*d)**2:0;}),preset:'oscillate',cx:510,cy:710,amplitude:8,direction:15,speed:.3,phase:0,enabled:true};
const bad={weights:weights((x,y)=>x>125&&x<165&&y>200&&y<400?1:0),preset:'oscillate',cx:145,cy:300,amplitude:50,direction:0,speed:.3,phase:0,enabled:true};
function maxDelta(a,b,condition=()=>true){let max=0;for(let i=0;i<n;i++)if(condition(i))max=Math.max(max,Math.hypot(a[i*2]-b[i*2],a[i*2+1]-b[i*2+1]));return max;}
const goodOnly=new Float32Array(mesh.deform([good],.7)),oldOnly=new Float32Array(old.deform([good],.7));const both=new Float32Array(mesh.deform([good,bad],.7)),oldBoth=new Float32Array(old.deform([good,bad],.7));
const newDistantError=maxDelta(goodOnly,both,i=>good.weights[i]>0),oldDistantError=maxDelta(oldOnly,oldBoth,i=>good.weights[i]>0);assert.equal(newDistantError,0);assert.ok(oldDistantError>1);
const combined=new Float32Array(mesh.deform([good,bad],.7));mesh.deform([bad,good],.7);assert.ok(maxDelta(combined,mesh.positions)<1e-5,'Overlap/order stability');mesh.deform([bad,good],2.1);assert.deepEqual(new Float32Array(mesh.deform([good,bad],.7)),combined,'No time integration drift');
// Adversarial overlap, holes, sharp boundaries and pinned anchors at many phases.
let minimumArea=Infinity,maximumGradient=0,fallbackIslands=0;
for(let scenario=0;scenario<5;scenario++){
 mesh.protection=weights((x,y)=>scenario%2&&x>300&&x<330&&y>100&&y<850?1:0);
 const a={...bad,weights:weights((x,y)=>x>140&&x<530&&y>200&&y<750?(scenario===2&&Math.floor(x/15)%2?0:1):0),direction:scenario*45,preset:['sway','oscillate','bounce','breathing','oscillate'][scenario],hair:null};
 const b={...good,amplitude:50,weights:weights((x,y)=>Math.hypot(x-370,y-450)<170?1:0),direction:-80,phase:160};
 for(let t=0;t<3;t+=.19){mesh.deform([a,b],t);fallbackIslands+=mesh.fallbackIslands;for(let i=0;i<n;i++){assert.ok(Number.isFinite(mesh.positions[i*2]));if(mesh.protection[i]===1)assert.equal(Math.hypot(mesh.delta[i*2],mesh.delta[i*2+1]),0,'Pinned anchor drift');}
  for(let k=0;k<mesh.edgeLengths.length;k++){const a=mesh.edges[k*2],b=mesh.edges[k*2+1];const gradient=Math.hypot(mesh.delta[b*2]-mesh.delta[a*2],mesh.delta[b*2+1]-mesh.delta[a*2+1])/mesh.edgeLengths[k];maximumGradient=Math.max(maximumGradient,gradient);assert.ok(gradient<.421);}
  for(let k=0;k<mesh.indices.length;k+=3){const a=mesh.indices[k]*2,b=mesh.indices[k+1]*2,c=mesh.indices[k+2]*2,p=mesh.positions;const area=(p[b]-p[a])*(p[c+1]-p[a+1])-(p[b+1]-p[a+1])*(p[c]-p[a]);minimumArea=Math.min(minimumArea,area);assert.ok(area>0);}
 }
}
mesh.protection.fill(0);const hair={...good,preset:'sway',weights:weights((x,y)=>x>300&&x<400&&y>150&&y<650?1:0),cx:350,cy:400,root:{x:350/720,y:160/956},hair:null};mesh.deform([hair],.9);let roots=0,tips=0,rootMotion=0,tipMotion=0;for(let i=0;i<n;i++)if(hair.weights[i]>.9){const d=Math.hypot(mesh.delta[i*2],mesh.delta[i*2+1]);if(hair.hair.travel[i]<.06){roots++;rootMotion+=d;}if(hair.hair.travel[i]>.85){tips++;tipMotion+=d;}}assert.ok(roots&&tips);assert.ok(tipMotion/tips>rootMotion/roots+1);
const result={unrelatedRegionChangePx:newDistantError,oldGlobalLimiterUnrelatedRegionChangePx:oldDistantError,overlapOrderIndependent:true,deterministic:true,stressScenarios:5,minimumSignedDoubleArea:minimumArea,maximumDisplacementGradient:maximumGradient,pinnedAnchorsStable:true,fallbackIslandActivations:fallbackIslands,rootMeanMotionPx:rootMotion/roots,tipMeanMotionPx:tipMotion/tips};fs.writeFileSync(path.join(__dirname,'test-output/engine-validation.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
