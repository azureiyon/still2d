/* Manual one-eye patch. Original texture is immutable. The eye interior is
   occluded, nearby skin is resampled, and a source lash ribbon follows the lid. */
(function(root){
'use strict';
const curves=['supportUpper','upper','closed','lower','supportLower'];
const curveColors={supportUpper:'#80cfff',upper:'#ffdf6b',closed:'#ff8bd5',lower:'#80f0ad',supportLower:'#80cfff'};
function bezier(pair,t){return 3*t*(1-t)*((1-t)*pair[0]+t*pair[1]);}
function curveX(pair,t){return bezier(pair,t)+t*t*t;}
function ordinate(eye,key,x){const xp=eye.controlsX?.[key]||[1/3,2/3];let lo=0,hi=1;for(let i=0;i<16;i++){const t=(lo+hi)/2;if(curveX(xp,t)<x)lo=t;else hi=t;}return bezier(eye[key],(lo+hi)/2);}
function basis(eye,width,height){const [a,b]=eye.corners.map(p=>({x:p.x*width,y:p.y*height})),length=Math.hypot(b.x-a.x,b.y-a.y);return {a,b,length,ux:(b.x-a.x)/length,uy:(b.y-a.y)/length,nx:-(b.y-a.y)/length,ny:(b.x-a.x)/length};}
function point(eye,key,t,width,height){const b=basis(eye,width,height),x=curveX(eye.controlsX?.[key]||[1/3,2/3],t)*b.length,y=bezier(eye[key],t)*b.length;return {x:b.a.x+b.ux*x+b.nx*y,y:b.a.y+b.uy*x+b.ny*y};}
function handles(eye,width,height){const b=basis(eye,width,height),list=eye.corners.map((p,index)=>({key:'corner',index,x:p.x*width,y:p.y*height}));for(const key of curves)for(let index=0;index<2;index++){const t=(eye.controlsX?.[key]||[1/3,2/3])[index];list.push({key,index,x:b.a.x+b.ux*t*b.length+b.nx*eye[key][index]*b.length,y:b.a.y+b.uy*t*b.length+b.ny*eye[key][index]*b.length});}return list;}
function createEye(a,b,width,height){if(a.x>b.x)[a,b]=[b,a];return {kind:'curve-eye-v1',lidMotion:'upper-led',lowerLidLift:0,corners:[{x:a.x/width,y:a.y/height},{x:b.x/width,y:b.y/height}],upper:[-.18,-.18],lower:[.14,.14],closed:[.065,.065],supportUpper:[-.43,-.43],supportLower:[.43,.43],lashWidth:Math.max(.5,Math.min(12,Math.hypot(b.x-a.x,b.y-a.y)*.025)),closure:0,enabled:true,showGuides:true};}
// Older files retain their authored shared seam. New eyes land on the lower
// curve, with optional lift limited to 15% of the original aperture height.
function lidMotion(eye){return eye.lidMotion??'shared-seam';}
function lids(eye,x,c=eye.closure){const u=ordinate(eye,'upper',x),l=ordinate(eye,'lower',x),target=lidMotion(eye)==='upper-led'?l-(l-u)*(eye.lowerLidLift??0):ordinate(eye,'closed',x);return {upper:u+(target-u)*c,lower:l+(target-l)*c,target};}
function validate(eye,width,height){if(!eye||eye.kind!=='curve-eye-v1'||!Array.isArray(eye.corners)||eye.corners.length!==2)return false;for(const p of eye.corners)if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1)return false;const b=basis(eye,width,height);if(b.length<8||b.length>Math.max(width,height)||b.b.x<=b.a.x)return false;
 for(const k of curves)if(!Array.isArray(eye[k])||eye[k].length!==2||eye[k].some(v=>!Number.isFinite(v)||Math.abs(v)>1))return false;
 for(const k of curves){const x=eye.controlsX?.[k]||[1/3,2/3];if(!Array.isArray(x)||x.length!==2||x.some(v=>!Number.isFinite(v)||v<.005||v>.995)||x[0]>=x[1])return false;}
 // Monotone abscissae permit inverse sampling; validate support and lid order
 // densely in shared eye-local x even when control points have different x.
 for(let i=1;i<128;i++){const x=i/128,a=ordinate(eye,'supportUpper',x),u=ordinate(eye,'upper',x),l=ordinate(eye,'lower',x),c=ordinate(eye,'closed',x),b=ordinate(eye,'supportLower',x),gap=.015*x*(1-x);if(a+gap>=u||u+gap>=l||(lidMotion(eye)==='shared-seam'&&(c<u||c>l))||l+gap>=b)return false;}
 if(eye.lidMotion!==undefined&&!['upper-led','shared-seam'].includes(eye.lidMotion))return false;if(eye.lowerLidLift!==undefined&&(!Number.isFinite(eye.lowerLidLift)||eye.lowerLidLift<0||eye.lowerLidLift>.15))return false;
 if(eye.lashRoll!=null&&(!Number.isFinite(eye.lashRoll)||eye.lashRoll<0||eye.lashRoll>160))return false;if(eye.repairMargin!=null&&(!Number.isFinite(eye.repairMargin)||eye.repairMargin<0||eye.repairMargin>12))return false;if(root.Stillwave?.EyeTextures&&(!root.Stillwave.EyeTextures.validRecord(eye.lashMatte,width,height)||!root.Stillwave.EyeTextures.validDonor(eye.skinDonor,width,height)))return false;
 return Number.isFinite(eye.closure)&&eye.closure>=0&&eye.closure<=1&&Number.isFinite(eye.lashWidth)&&eye.lashWidth>=.25&&eye.lashWidth<=20&&typeof eye.enabled==='boolean'&&typeof eye.showGuides==='boolean';}
function moveHandle(eye,handle,p,width,height){const candidate=structuredClone(eye);if(handle.key==='corner')candidate.corners[handle.index]={x:Math.max(0,Math.min(1,p.x/width)),y:Math.max(0,Math.min(1,p.y/height))};else{const b=basis(eye,width,height);candidate[handle.key][handle.index]=((p.x-b.a.x)*b.nx+(p.y-b.a.y)*b.ny)/b.length;candidate.controlsX??={};candidate.controlsX[handle.key]??=[1/3,2/3];candidate.controlsX[handle.key][handle.index]=Math.max(.005,Math.min(.995,((p.x-b.a.x)*b.ux+(p.y-b.a.y)*b.uy)/b.length));}return validate(candidate,width,height)?candidate:null;}
const vertex=`attribute vec2 vertex; varying vec2 uv; void main(){uv=vertex*.5+.5;gl_Position=vec4(vertex,0.,1.);}`;
const fragment=`precision highp float;
varying vec2 uv;
uniform sampler2D source,skinPlate,lashTexture;
uniform vec4 plateRect;
uniform vec2 size,origin,axis,upper,lower,seam,xUpper,xLower,xSeam;
uniform float length,closure,lashWidth,lashRoll,lashExtent,upperLed,lowerLift;
float curve(vec2 p,vec2 xp,float x){float lo=0.,hi=1.;for(int i=0;i<14;i++){float t=(lo+hi)*.5;float bx=3.*t*(1.-t)*((1.-t)*xp.x+t*xp.y)+t*t*t;if(bx<x)lo=t;else hi=t;}float t=(lo+hi)*.5;return 3.*t*(1.-t)*((1.-t)*p.x+t*p.y)*length;}
float U(float q){return curve(upper,xUpper,q);}
float C(float q){if(upperLed>.5)return mix(curve(lower,xLower,q),U(q),lowerLift);return curve(seam,xSeam,q);}
float D(float q){return mix(U(q),C(q),closure);}
vec2 originalUV(vec2 p){return (origin+axis*p.x+vec2(-axis.y,axis.x)*p.y)/size;}
vec4 lashAt(vec2 p){vec2 pixel=originalUV(p)*size;vec2 q=(pixel-plateRect.xy)/plateRect.zw;if(q.x<0.||q.y<0.||q.x>1.||q.y>1.)return vec4(0.);return texture2D(lashTexture,q);}
void main(){
 vec4 original=texture2D(source,uv);vec2 pos=uv*size;
 if(pos.x<plateRect.x||pos.y<plateRect.y||pos.x>plateRect.x+plateRect.z||pos.y>plateRect.y+plateRect.w||original.a<.0001){gl_FragColor=original;return;}
 vec2 normal=vec2(-axis.y,axis.x),delta=pos-origin;float x=dot(delta,axis),y=dot(delta,normal),t=x/length;
 vec4 color=texture2D(skinPlate,(pos-plateRect.xy)/plateRect.zw);
 // The stationary lower rim is source artwork, not part of the moving skin
 // cover. Keep it even where the repair feather extends below the aperture;
 // the transported upper lashes may still naturally overlap it at closure.
 if(upperLed>.5&&lowerLift<.00001&&t>0.&&t<1.&&y>=curve(lower,xLower,t))color=original;
 if(t>0.&&t<1.&&closure<.999){float u=U(t),l=curve(lower,xLower,t),s=C(t),uc=mix(u,s,closure),lc=mix(l,s,closure);float opening=smoothstep(uc-.5,uc+.5,y)*(1.-smoothstep(lc-.5,lc+.5,y));opening*=1.-lashAt(vec2(x,y)).a;color=mix(color,original,opening);}
 // Closest point in the destination lid's local frame. Tangent/normal transport
 // bends the original RGBA patch, including individual lash tips and end caps.
 float q=clamp(t,0.,1.);float eps=.002;
 for(int i=0;i<5;i++){float f=D(q),qa=max(0.,q-eps),qb=min(1.,q+eps),slope=(D(qb)-D(qa))/max(.0001,(qb-qa)*length);float step=((x-q*length)+(y-f)*slope)/(length*(1.+slope*slope));q=clamp(q+clamp(step,-.15,.15),0.,1.);}
 float qa=max(0.,q-eps),qb=min(1.,q+eps),denom=max(.0001,(qb-qa)*length),ss=(U(qb)-U(qa))/denom,ds=(D(qb)-D(qa))/denom;
 vec2 st=normalize(vec2(1.,ss)),sn=vec2(-st.y,st.x),dt=normalize(vec2(1.,ds)),dn=vec2(-dt.y,dt.x),r=vec2(x-q*length,y-D(q));
 float roll=cos(closure*closure*lashRoll),scale=(roll<0.?-1.:1.)*max(.12,abs(roll));vec2 p=vec2(q*length,U(q))+st*dot(r,dt)+sn*(dot(r,dn)/scale);vec4 lash=abs(dot(r,dn))<=lashExtent*abs(scale)+2.?lashAt(p):vec4(0.);
 color=lash+color*(1.-lash.a);
 if(color.a>.0001)color.rgb*=original.a/color.a;else color=original;color.a=original.a;gl_FragColor=color;
}`;
class BlinkPatch{
 constructor(gl){this.gl=gl;const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};const p=this.program=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));this.vertex=gl.getAttribLocation(p,'vertex');this.loc={};for(const k of ['source','skinPlate','lashTexture','plateRect','size','origin','axis','upper','lower','seam','xUpper','xLower','xSeam','length','closure','lashWidth','lashRoll','lashExtent','upperLed','lowerLift'])this.loc[k]=gl.getUniformLocation(p,k);this.quad=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);}
 reset(width,height){const gl=this.gl;for(const t of [this.output,this.plate,this.lashTexture])if(t)gl.deleteTexture(t);if(this.framebuffer)gl.deleteFramebuffer(this.framebuffer);this.output=this.plate=this.lashTexture=this.framebuffer=null;this.assets=null;this.assetKey='';this.width=width;this.height=height;this.cache='';}
 ensureAssets(eye){const key=JSON.stringify([eye.corners,eye.upper,eye.lower,eye.closed,eye.supportUpper,eye.supportLower,eye.controlsX,eye.lashWidth,eye.repairMargin,eye.skinDonor,eye.lashMatte]);if(key===this.assetKey&&this.assets)return this.assets;this.assets=root.Stillwave.EyeTextures.make(this.image,eye,this.width,this.height);this.assetKey=key;this.cache='';const a=this.assets;this.plateRect=a.rect;this.plateSize=[a.width,a.height];const gl=this.gl;
  const upload=(old,pixels)=>{const t=old||gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,a.width,a.height,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,k,gl.LINEAR);for(const k of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,k,gl.CLAMP_TO_EDGE);return t;};gl.activeTexture(gl.TEXTURE1);this.plate=upload(this.plate,a.clean);gl.activeTexture(gl.TEXTURE2);this.lashTexture=upload(this.lashTexture,a.lash);gl.activeTexture(gl.TEXTURE0);return a;
 }
 compose(source,eye){if(!eye||!eye.enabled||eye.closure===0)return source;const key=JSON.stringify(eye);if(key===this.cache&&this.output)return this.output;this.ensureAssets(eye);const gl=this.gl;
  if(!this.output){this.output=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.output);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,this.width,this.height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,k,gl.LINEAR);for(const k of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,k,gl.CLAMP_TO_EDGE);this.framebuffer=gl.createFramebuffer();}
  gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.output,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){gl.bindFramebuffer(gl.FRAMEBUFFER,null);throw Error('Could not allocate eye preview. Try a smaller illustration.');}
  const b=basis(eye,this.width,this.height);gl.viewport(0,0,this.width,this.height);gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);gl.enableVertexAttribArray(this.vertex);gl.vertexAttribPointer(this.vertex,2,gl.FLOAT,false,0,0);
  for(const [unit,loc,texture]of [[0,'source',source],[1,'skinPlate',this.plate],[2,'lashTexture',this.lashTexture]]){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(this.loc[loc],unit);}gl.uniform4fv(this.loc.plateRect,this.plateRect);gl.uniform2f(this.loc.size,this.width,this.height);gl.uniform2f(this.loc.origin,b.a.x,b.a.y);gl.uniform2f(this.loc.axis,b.ux,b.uy);gl.uniform1f(this.loc.length,b.length);gl.uniform1f(this.loc.closure,eye.closure);gl.uniform1f(this.loc.upperLed,lidMotion(eye)==='upper-led'?1:0);gl.uniform1f(this.loc.lowerLift,eye.lowerLidLift??0);gl.uniform1f(this.loc.lashWidth,eye.lashWidth);gl.uniform1f(this.loc.lashExtent,this.assets.extent);gl.uniform1f(this.loc.lashRoll,(eye.lashRoll??135)*Math.PI/180);
  for(const [k,v]of [['upper',eye.upper],['lower',eye.lower],['seam',eye.closed]])gl.uniform2fv(this.loc[k],v);for(const [k,v]of [['xUpper','upper'],['xLower','lower'],['xSeam','closed']])gl.uniform2fv(this.loc[k],eye.controlsX?.[v]||[1/3,2/3]);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.activeTexture(gl.TEXTURE0);this.cache=key;return this.output;
 }
}

root.Stillwave??={};Object.assign(root.Stillwave,{BlinkPatch,EyeGeometry:{curves,curveColors,bezier,ordinate,basis,point,handles,createEye,validate,moveHandle,lidMotion,lids}});
if(typeof module!=='undefined')module.exports={EyeGeometry:root.Stillwave.EyeGeometry};
})(typeof window!=='undefined'?window:globalThis);





