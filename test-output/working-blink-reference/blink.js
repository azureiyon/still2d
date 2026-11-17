/* Manual one-eye patch. Original texture is immutable. The eye interior is
   occluded, nearby skin is resampled, and a source lash ribbon follows the lid. */
(function(root){
'use strict';
const curves=['supportUpper','upper','closed','lower','supportLower'];
const curveColors={supportUpper:'#80cfff',upper:'#ffdf6b',closed:'#ff8bd5',lower:'#80f0ad',supportLower:'#80cfff',crease:'#f5b077'};
// Raster records are immutable after a completed stroke. Compare their string
// references rather than serializing megabytes of alpha/RGBA every frame.
const rasterIds=new WeakMap();let rasterSerial=0;
function rasterRef(r){if(!r)return 0;let token=rasterIds.get(r);if(!token||token.data!==r.data){token={id:++rasterSerial,data:r.data};rasterIds.set(r,token);}return [token.id,r.rect,r.width,r.height];}
function assetKey(eye){return JSON.stringify([eye.corners,eye.upper,eye.lower,eye.closed,eye.supportUpper,eye.supportLower,eye.controlsX,eye.lashWidth,eye.repairMargin,eye.skinDonor,eye.repairMode,eye.repairFeather,eye.crease,eye.bends,...['lashMatte','repairLimit','protectMask','repairPaint'].map(k=>rasterRef(eye[k]))]);}
function bezier(pair,t){return 3*t*(1-t)*((1-t)*pair[0]+t*pair[1]);}
function curveX(pair,t){return bezier(pair,t)+t*t*t;}
function curvePair(eye,key){return eye[key]||(key==='crease'?eye.upper.map((v,i)=>(v+eye.supportUpper[i])*.5):null);}
function ordinate(eye,key,x){const xp=eye.controlsX?.[key]||[1/3,2/3];let lo=0,hi=1;for(let i=0;i<16;i++){const t=(lo+hi)/2;if(curveX(xp,t)<x)lo=t;else hi=t;}return bezier(curvePair(eye,key),(lo+hi)/2)+(eye.bends?.[key]||0)*16*x*x*(1-x)*(1-x);}
function basis(eye,width,height){const [a,b]=eye.corners.map(p=>({x:p.x*width,y:p.y*height})),length=Math.hypot(b.x-a.x,b.y-a.y);return {a,b,length,ux:(b.x-a.x)/length,uy:(b.y-a.y)/length,nx:-(b.y-a.y)/length,ny:(b.x-a.x)/length};}
function point(eye,key,t,width,height){const b=basis(eye,width,height),xn=curveX(eye.controlsX?.[key]||[1/3,2/3],t),x=xn*b.length,y=(bezier(curvePair(eye,key),t)+(eye.bends?.[key]||0)*16*xn*xn*(1-xn)*(1-xn))*b.length;return {x:b.a.x+b.ux*x+b.nx*y,y:b.a.y+b.uy*x+b.ny*y};}
function handles(eye,width,height){const b=basis(eye,width,height),list=eye.corners.map((p,index)=>({key:'corner',index,x:p.x*width,y:p.y*height}));for(const key of [...curves,'crease']){for(let index=0;index<2;index++){const t=(eye.controlsX?.[key]||[1/3,2/3])[index];list.push({key,index,x:b.a.x+b.ux*t*b.length+b.nx*curvePair(eye,key)[index]*b.length,y:b.a.y+b.uy*t*b.length+b.ny*curvePair(eye,key)[index]*b.length});}if(['upper','lower','crease'].includes(key)){const y=ordinate(eye,key,.5)*b.length;list.push({key,index:2,bend:true,x:b.a.x+b.ux*.5*b.length+b.nx*y,y:b.a.y+b.uy*.5*b.length+b.ny*y});}}return list;}
function createEye(a,b,width,height){if(a.x>b.x)[a,b]=[b,a];return {kind:'curve-eye-v1',lidMotion:'upper-led',lowerLidLift:0,repairMode:'soft',repairFeather:3,crease:[-.305,-.305],creaseMove:.08,creaseBand:8,lashRoll:40,corners:[{x:a.x/width,y:a.y/height},{x:b.x/width,y:b.y/height}],upper:[-.18,-.18],lower:[.14,.14],closed:[.065,.065],supportUpper:[-.43,-.43],supportLower:[.43,.43],lashWidth:Math.max(.5,Math.min(12,Math.hypot(b.x-a.x,b.y-a.y)*.025)),closure:0,enabled:true,showGuides:true};}
// Older files retain their authored shared seam. New eyes land on the lower
// curve, with optional lift limited to 15% of the original aperture height.
function lidMotion(eye){return eye.lidMotion??'shared-seam';}
function lids(eye,x,c=eye.closure){const u=ordinate(eye,'upper',x),l=ordinate(eye,'lower',x),target=lidMotion(eye)==='upper-led'?l-(l-u)*(eye.lowerLidLift??0):ordinate(eye,'closed',x);return {upper:u+(target-u)*c,lower:l+(target-l)*c,target};}
function validate(eye,width,height){if(!eye||eye.kind!=='curve-eye-v1'||!Array.isArray(eye.corners)||eye.corners.length!==2)return false;for(const p of eye.corners)if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1)return false;const b=basis(eye,width,height);if(b.length<8||b.length>Math.max(width,height)||b.b.x<=b.a.x)return false;
 if(eye.crease!==undefined&&(!Array.isArray(eye.crease)||eye.crease.length!==2||eye.crease.some(v=>!Number.isFinite(v)||Math.abs(v)>1)))return false;
 if(eye.bends!==undefined&&(!eye.bends||typeof eye.bends!=='object'||Object.entries(eye.bends).some(([k,v])=>!['upper','lower','closed','crease'].includes(k)||!Number.isFinite(v)||Math.abs(v)>.35)))return false;
 for(const [k,lo,hi]of [['creaseMove',0,.4],['creaseBand',1,60],['repairFeather',0,12]])if(eye[k]!==undefined&&(!Number.isFinite(eye[k])||eye[k]<lo||eye[k]>hi))return false;
 if(eye.repairMode!==undefined&&!['texture','soft','blend'].includes(eye.repairMode))return false;
 if(eye.repairColor!==undefined&&(!Array.isArray(eye.repairColor)||eye.repairColor.length!==3||eye.repairColor.some(v=>!Number.isInteger(v)||v<0||v>255)))return false;
 if(root.Stillwave?.EyeTextures){for(const k of ['repairLimit','protectMask'])if(!root.Stillwave.EyeTextures.validRecord(eye[k],width,height))return false;if(!root.Stillwave.EyeTextures.validRecord(eye.repairPaint,width,height,4))return false;}
 for(const k of curves)if(!Array.isArray(eye[k])||eye[k].length!==2||eye[k].some(v=>!Number.isFinite(v)||Math.abs(v)>1))return false;
 for(const k of [...curves,'crease']){const x=eye.controlsX?.[k]||[1/3,2/3];if(!Array.isArray(x)||x.length!==2||x.some(v=>!Number.isFinite(v)||v<.005||v>.995)||x[0]>=x[1])return false;}
 // Monotone abscissae permit inverse sampling; validate support and lid order
 // densely in shared eye-local x even when control points have different x.
 for(let i=1;i<128;i++){const x=i/128,a=ordinate(eye,'supportUpper',x),u=ordinate(eye,'upper',x),l=ordinate(eye,'lower',x),c=ordinate(eye,'closed',x),b=ordinate(eye,'supportLower',x),gap=.015*x*(1-x);if(a+gap>=u||u+gap>=l||(lidMotion(eye)==='shared-seam'&&(c<u||c>l))||l+gap>=b)return false;}
 if(eye.lidMotion!==undefined&&!['upper-led','shared-seam'].includes(eye.lidMotion))return false;if(eye.lowerLidLift!==undefined&&(!Number.isFinite(eye.lowerLidLift)||eye.lowerLidLift<0||eye.lowerLidLift>.15))return false;
 if(eye.lashRoll!=null&&(!Number.isFinite(eye.lashRoll)||eye.lashRoll<0||eye.lashRoll>160))return false;if(eye.repairMargin!=null&&(!Number.isFinite(eye.repairMargin)||eye.repairMargin<0||eye.repairMargin>12))return false;if(root.Stillwave?.EyeTextures&&(!root.Stillwave.EyeTextures.validRecord(eye.lashMatte,width,height)||!root.Stillwave.EyeTextures.validDonor(eye.skinDonor,width,height)))return false;
 return Number.isFinite(eye.closure)&&eye.closure>=0&&eye.closure<=1&&Number.isFinite(eye.lashWidth)&&eye.lashWidth>=.25&&eye.lashWidth<=20&&typeof eye.enabled==='boolean'&&typeof eye.showGuides==='boolean';}
function moveHandle(eye,handle,p,width,height){const candidate=structuredClone(eye);if(handle.key==='corner')candidate.corners[handle.index]={x:Math.max(0,Math.min(1,p.x/width)),y:Math.max(0,Math.min(1,p.y/height))};else{const b=basis(eye,width,height),ny=((p.x-b.a.x)*b.nx+(p.y-b.a.y)*b.ny)/b.length;if(handle.bend){candidate.bends??={};candidate.bends[handle.key]=0;candidate.bends[handle.key]=ny-ordinate(candidate,handle.key,.5);}else{candidate[handle.key]??=[...curvePair(eye,handle.key)];candidate[handle.key][handle.index]=ny;candidate.controlsX??={};candidate.controlsX[handle.key]??=[1/3,2/3];candidate.controlsX[handle.key][handle.index]=Math.max(.005,Math.min(.995,((p.x-b.a.x)*b.ux+(p.y-b.a.y)*b.uy)/b.length));}}return validate(candidate,width,height)?candidate:null;}
const vertex=`attribute vec2 vertex; varying vec2 uv; void main(){uv=vertex*.5+.5;gl_Position=vec4(vertex,0.,1.);}`;
const fragment=`precision highp float;
varying vec2 uv;
uniform sampler2D source,skinPlate,lashTexture,editControl;
uniform vec4 plateRect;
uniform vec2 size,origin,axis,upper,lower,seam,xUpper,xLower,xSeam,crease,xCrease;
uniform float length,closure,lashWidth,lashRoll,lashExtent,upperLed,lowerLift,upperBend,lowerBend,seamBend,creaseBend,creaseMove,creaseBand;
float curve(vec2 p,vec2 xp,float x){float lo=0.,hi=1.;for(int i=0;i<14;i++){float t=(lo+hi)*.5;float bx=3.*t*(1.-t)*((1.-t)*xp.x+t*xp.y)+t*t*t;if(bx<x)lo=t;else hi=t;}float t=(lo+hi)*.5;return 3.*t*(1.-t)*((1.-t)*p.x+t*p.y)*length;}
float bump(float q){return 16.*q*q*(1.-q)*(1.-q)*length;}
float U(float q){return curve(upper,xUpper,q)+upperBend*bump(q);}
float L(float q){return curve(lower,xLower,q)+lowerBend*bump(q);}
float C(float q){if(upperLed>.5)return mix(L(q),U(q),lowerLift);return curve(seam,xSeam,q)+seamBend*bump(q);}
float D(float q){return mix(U(q),C(q),closure);}
vec2 originalUV(vec2 p){return (origin+axis*p.x+vec2(-axis.y,axis.x)*p.y)/size;}
vec4 lashAt(vec2 p){vec2 pixel=originalUV(p)*size;vec2 q=(pixel-plateRect.xy)/plateRect.zw;if(q.x<0.||q.y<0.||q.x>1.||q.y>1.)return vec4(0.);return texture2D(lashTexture,q);}
void main(){
 vec4 original=texture2D(source,uv);vec2 pos=uv*size;
 if(pos.x<plateRect.x||pos.y<plateRect.y||pos.x>plateRect.x+plateRect.z||pos.y>plateRect.y+plateRect.w||original.a<.0001){gl_FragColor=original;return;}
 vec2 control=texture2D(editControl,(pos-plateRect.xy)/plateRect.zw).rg;float allowed=control.r*(1.-control.g);
 if(allowed<=0.){gl_FragColor=original;return;}
 vec2 normal=vec2(-axis.y,axis.x),delta=pos-origin;float x=dot(delta,axis),y=dot(delta,normal),t=x/length;
 vec4 color=texture2D(skinPlate,(pos-plateRect.xy)/plateRect.zw);
 // Keep the ceiling fixed above the crease. Unlike the original fixed strip,
 // its lower falloff grows with travel so follow is not capped at a few pixels.
 // Smooth Hermite interpolation has unit derivative at the outer boundaries;
 // skinPlate is already iris-free and source/destination protection both apply.
 if(creaseMove>0.&&t>.04&&t<.96){
  float k=curve(crease,xCrease,t)+creaseBend*bump(t),band=min(creaseBand,max(0.,(U(t)-k)*.65));
  float shift=max(0.,D(t)-U(t))*creaseMove*smoothstep(.04,.18,t)*(1.-smoothstep(.82,.96,t));
  float top=k-band,bottom=k+band+2.*shift,center=k+shift;
  if(band>.5&&shift>.0001&&y>top&&y<bottom){
   float h=y<center?center-top:bottom-center,ratio=(y<center?band:bottom-k)/h,z=y<center?(y-top)/h:(y-center)/h;
   // Monotone cubic mapping: endpoint slopes are clamped to prevent folds.
   float outer=min(1.,2.*ratio),inner=min(band/(band+shift),ratio*2.);
   float z2=z*z,z3=z2*z,delta=y<center?band:bottom-k,m0=y<center?outer:inner,m1=y<center?inner:outer;
   float srcY=(y<center?top:k)+(-2.*z3+3.*z2)*delta+(z3-2.*z2+z)*h*m0+(z3-z2)*h*m1;
   vec2 src=originalUV(vec2(x,srcY))*size,sc=(src-plateRect.xy)/plateRect.zw;vec2 safe=texture2D(editControl,sc).rg;
   if(sc.x>=0.&&sc.x<=1.&&sc.y>=0.&&sc.y<=1.)color=mix(color,texture2D(skinPlate,sc),safe.r*(1.-safe.g));
  }
 }
 // The stationary lower rim is source artwork, not part of the moving skin
 // cover. Keep it even where the repair feather extends below the aperture;
 // the transported upper lashes may still naturally overlap it at closure.
 if(upperLed>.5&&lowerLift<.00001&&t>0.&&t<1.&&y>=L(t))color=original;
 if(t>0.&&t<1.&&closure<.999){float u=U(t),l=L(t),s=C(t),uc=mix(u,s,closure),lc=mix(l,s,closure);float opening=smoothstep(uc-.5,uc+.5,y)*(1.-smoothstep(lc-.5,lc+.5,y));opening*=1.-lashAt(vec2(x,y)).a;color=mix(color,original,opening);}
 // Closest point in the destination lid's local frame. Tangent/normal transport
 // bends the original RGBA patch, including individual lash tips and end caps.
 float q=clamp(t,0.,1.);float eps=.002;
 for(int i=0;i<5;i++){float f=D(q),qa=max(0.,q-eps),qb=min(1.,q+eps),slope=(D(qb)-D(qa))/max(.0001,(qb-qa)*length);float step=((x-q*length)+(y-f)*slope)/(length*(1.+slope*slope));q=clamp(q+clamp(step,-.15,.15),0.,1.);}
 float qa=max(0.,q-eps),qb=min(1.,q+eps),denom=max(.0001,(qb-qa)*length),ss=(U(qb)-U(qa))/denom,ds=(D(qb)-D(qa))/denom;
 vec2 st=normalize(vec2(1.,ss)),sn=vec2(-st.y,st.x),dt=normalize(vec2(1.,ds)),dn=vec2(-dt.y,dt.x),r=vec2(x-q*length,y-D(q));
 float roll=cos(closure*closure*lashRoll),scale=(roll<0.?-1.:1.)*max(.12,abs(roll));vec2 p=vec2(q*length,U(q))+st*dot(r,dt)+sn*(dot(r,dn)/scale);vec4 lash=abs(dot(r,dn))<=lashExtent*abs(scale)+2.?lashAt(p):vec4(0.);
 color=lash+color*(1.-lash.a);
 if(color.a>.0001)color.rgb*=original.a/color.a;else color=original;color.a=original.a;gl_FragColor=mix(original,color,allowed);
}`;
class EyePatch{
 constructor(gl){this.gl=gl;const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};const p=this.program=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));this.vertex=gl.getAttribLocation(p,'vertex');this.loc={};for(const k of ['source','skinPlate','lashTexture','plateRect','size','origin','axis','upper','lower','seam','xUpper','xLower','xSeam','length','closure','lashWidth','lashRoll','lashExtent','upperLed','lowerLift','editControl','crease','xCrease','upperBend','lowerBend','seamBend','creaseBend','creaseMove','creaseBand'])this.loc[k]=gl.getUniformLocation(p,k);this.quad=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);}
 reset(width,height){const gl=this.gl;for(const t of [this.output,this.plate,this.lashTexture,this.controlTexture])if(t)gl.deleteTexture(t);if(this.framebuffer)gl.deleteFramebuffer(this.framebuffer);this.output=this.plate=this.lashTexture=this.controlTexture=this.framebuffer=null;this.assets=null;this.assetKey='';this.width=width;this.height=height;this.cache='';}
 ensureAssets(eye){const key=assetKey(eye);if(key===this.assetKey&&this.assets)return this.assets;this.assets=root.Stillwave.EyeTextures.make(this.image,eye,this.width,this.height);this.assetKey=key;this.cache='';const a=this.assets;this.plateRect=a.rect;this.plateSize=[a.width,a.height];const gl=this.gl;
  const upload=(old,pixels)=>{const t=old||gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,a.width,a.height,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,k,gl.LINEAR);for(const k of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,k,gl.CLAMP_TO_EDGE);return t;};gl.activeTexture(gl.TEXTURE1);this.plate=upload(this.plate,a.clean);gl.activeTexture(gl.TEXTURE2);this.lashTexture=upload(this.lashTexture,a.lash);gl.activeTexture(gl.TEXTURE3);this.controlTexture=upload(this.controlTexture,a.controls);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.activeTexture(gl.TEXTURE0);return a;
 }
 compose(source,eye){if(!eye||!eye.enabled||eye.closure===0)return source;const key=JSON.stringify([assetKey(eye),eye.closure,eye.enabled,eye.lidMotion,eye.lowerLidLift,eye.lashRoll,eye.creaseMove,eye.creaseBand]);if(key===this.cache&&this.output)return this.output;this.ensureAssets(eye);const gl=this.gl;
  if(!this.output){this.output=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.output);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,this.width,this.height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,k,gl.LINEAR);for(const k of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,k,gl.CLAMP_TO_EDGE);this.framebuffer=gl.createFramebuffer();}
  gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.output,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){gl.bindFramebuffer(gl.FRAMEBUFFER,null);throw Error('Could not allocate eye preview. Try a smaller illustration.');}
  const b=basis(eye,this.width,this.height);gl.viewport(0,0,this.width,this.height);gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);gl.enableVertexAttribArray(this.vertex);gl.vertexAttribPointer(this.vertex,2,gl.FLOAT,false,0,0);
  for(const [unit,loc,texture]of [[0,'source',source],[1,'skinPlate',this.plate],[2,'lashTexture',this.lashTexture],[3,'editControl',this.controlTexture]]){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(this.loc[loc],unit);}gl.uniform4fv(this.loc.plateRect,this.plateRect);gl.uniform2f(this.loc.size,this.width,this.height);gl.uniform2f(this.loc.origin,b.a.x,b.a.y);gl.uniform2f(this.loc.axis,b.ux,b.uy);gl.uniform1f(this.loc.length,b.length);gl.uniform1f(this.loc.closure,eye.closure);gl.uniform1f(this.loc.upperLed,lidMotion(eye)==='upper-led'?1:0);gl.uniform1f(this.loc.lowerLift,eye.lowerLidLift??0);gl.uniform1f(this.loc.lashWidth,eye.lashWidth);gl.uniform1f(this.loc.lashExtent,this.assets.extent);gl.uniform1f(this.loc.lashRoll,(eye.lashRoll??135)*Math.PI/180);
  gl.uniform2fv(this.loc.crease,curvePair(eye,'crease'));gl.uniform2fv(this.loc.xCrease,eye.controlsX?.crease||[1/3,2/3]);for(const [name,key]of [['upperBend','upper'],['lowerBend','lower'],['seamBend','closed'],['creaseBend','crease']])gl.uniform1f(this.loc[name],eye.bends?.[key]||0);gl.uniform1f(this.loc.creaseMove,eye.creaseMove??0);gl.uniform1f(this.loc.creaseBand,eye.creaseBand??8);
  for(const [k,v]of [['upper',eye.upper],['lower',eye.lower],['seam',eye.closed]])gl.uniform2fv(this.loc[k],v);for(const [k,v]of [['xUpper','upper'],['xLower','lower'],['xSeam','closed']])gl.uniform2fv(this.loc[k],eye.controlsX?.[v]||[1/3,2/3]);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.activeTexture(gl.TEXTURE0);this.cache=key;return this.output;
 }
}

// Each patch always samples the immutable illustration. A separate combine
// pass preserves eye A even when eye B's large preparation rectangle overlaps
// it; unchanged pixels in B never erase A. Actual changed overlap favors B.
class BlinkPatch{
 constructor(gl){this.gl=gl;this.patches=[new EyePatch(gl),new EyePatch(gl)];this.mergeKey='';
  const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  const program=this.mergeProgram=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,`precision highp float;varying vec2 uv;uniform sampler2D original,first,second;void main(){vec4 o=texture2D(original,uv),a=texture2D(first,uv),b=texture2D(second,uv);vec4 d=abs(b-o);gl_FragColor=max(max(d.r,d.g),max(d.b,d.a))>.00001?b:a;}`));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));this.mergeVertex=gl.getAttribLocation(program,'vertex');this.mergeLoc={};for(const n of ['original','first','second'])this.mergeLoc[n]=gl.getUniformLocation(program,n);
 }
 forEye(index=0){return this.patches[index]||this.patches[0];}
 get image(){return this.patches[0].image;}set image(value){for(const p of this.patches)p.image=value;}
 get assets(){return this.patches[0].assets;}get plate(){return this.patches[0].plate;}get plateRect(){return this.patches[0].plateRect;}get plateSize(){return this.patches[0].plateSize;}
 get assetKey(){return this.patches[0].assetKey;}set assetKey(v){this.patches[0].assetKey=v;this.mergeKey='';}get cache(){return this.patches[0].cache;}set cache(v){this.patches[0].cache=v;this.mergeKey='';}
 ensureAssets(eye){return this.patches[0].ensureAssets(eye);}
 reset(width,height){for(const p of this.patches)p.reset(width,height);const gl=this.gl;if(this.mergeTexture)gl.deleteTexture(this.mergeTexture);if(this.mergeFramebuffer)gl.deleteFramebuffer(this.mergeFramebuffer);this.mergeTexture=this.mergeFramebuffer=this.output=null;this.mergeKey='';this.width=width;this.height=height;}
 compose(source,eyes){const list=Array.isArray(eyes)?eyes:eyes?[eyes]:[],a=this.patches[0].compose(source,list[0]),b=this.patches[1].compose(source,list[1]);if(a===source)return this.output=b;if(b===source)return this.output=a;const key=this.patches.map(p=>p.cache).join('|');if(key===this.mergeKey&&this.mergeTexture)return this.output=this.mergeTexture;
  const gl=this.gl;if(!this.mergeTexture){this.mergeTexture=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.mergeTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,this.width,this.height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,k,gl.LINEAR);for(const k of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,k,gl.CLAMP_TO_EDGE);this.mergeFramebuffer=gl.createFramebuffer();}
  gl.bindFramebuffer(gl.FRAMEBUFFER,this.mergeFramebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.mergeTexture,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){gl.bindFramebuffer(gl.FRAMEBUFFER,null);throw Error('Could not allocate two-eye preview. Try a smaller illustration.');}gl.viewport(0,0,this.width,this.height);gl.useProgram(this.mergeProgram);gl.bindBuffer(gl.ARRAY_BUFFER,this.patches[0].quad);gl.enableVertexAttribArray(this.mergeVertex);gl.vertexAttribPointer(this.mergeVertex,2,gl.FLOAT,false,0,0);for(const [i,n,tex]of [[0,'original',source],[1,'first',a],[2,'second',b]]){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,tex);gl.uniform1i(this.mergeLoc[n],i);}gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.activeTexture(gl.TEXTURE0);this.mergeKey=key;return this.output=this.mergeTexture;
 }
}

root.Stillwave??={};Object.assign(root.Stillwave,{BlinkPatch,EyeGeometry:{curves,curveColors,bezier,ordinate,basis,point,handles,createEye,validate,moveHandle,lidMotion,lids,curvePair}});
if(typeof module!=='undefined')module.exports={EyeGeometry:root.Stillwave.EyeGeometry};
})(typeof window!=='undefined'?window:globalThis);





