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
function createEye(a,b,width,height){if(a.x>b.x)[a,b]=[b,a];return {kind:'curve-eye-v1',corners:[{x:a.x/width,y:a.y/height},{x:b.x/width,y:b.y/height}],upper:[-.18,-.18],lower:[.14,.14],closed:[.065,.065],supportUpper:[-.43,-.43],supportLower:[.43,.43],lashWidth:Math.max(.5,Math.min(12,Math.hypot(b.x-a.x,b.y-a.y)*.025)),closure:0,enabled:true,showGuides:true};}
function validate(eye,width,height){if(!eye||eye.kind!=='curve-eye-v1'||!Array.isArray(eye.corners)||eye.corners.length!==2)return false;for(const p of eye.corners)if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1)return false;const b=basis(eye,width,height);if(b.length<8||b.length>Math.max(width,height)||b.b.x<=b.a.x)return false;
 for(const k of curves)if(!Array.isArray(eye[k])||eye[k].length!==2||eye[k].some(v=>!Number.isFinite(v)||Math.abs(v)>1))return false;
 for(const k of curves){const x=eye.controlsX?.[k]||[1/3,2/3];if(!Array.isArray(x)||x.length!==2||x.some(v=>!Number.isFinite(v)||v<.005||v>.995)||x[0]>=x[1])return false;}
 // Monotone abscissae permit inverse sampling; validate support and lid order
 // densely in shared eye-local x even when control points have different x.
 for(let i=1;i<128;i++){const x=i/128,a=ordinate(eye,'supportUpper',x),u=ordinate(eye,'upper',x),l=ordinate(eye,'lower',x),c=ordinate(eye,'closed',x),b=ordinate(eye,'supportLower',x),gap=.015*x*(1-x);if(a+gap>=u||u+gap>=l||c<u||c>l||l+gap>=b)return false;}
 return Number.isFinite(eye.closure)&&eye.closure>=0&&eye.closure<=1&&Number.isFinite(eye.lashWidth)&&eye.lashWidth>=.25&&eye.lashWidth<=20&&typeof eye.enabled==='boolean'&&typeof eye.showGuides==='boolean';}
function moveHandle(eye,handle,p,width,height){const candidate=structuredClone(eye);if(handle.key==='corner')candidate.corners[handle.index]={x:Math.max(0,Math.min(1,p.x/width)),y:Math.max(0,Math.min(1,p.y/height))};else{const b=basis(eye,width,height);candidate[handle.key][handle.index]=((p.x-b.a.x)*b.nx+(p.y-b.a.y)*b.ny)/b.length;candidate.controlsX??={};candidate.controlsX[handle.key]??=[1/3,2/3];candidate.controlsX[handle.key][handle.index]=Math.max(.005,Math.min(.995,((p.x-b.a.x)*b.ux+(p.y-b.a.y)*b.uy)/b.length));}return validate(candidate,width,height)?candidate:null;}
const vertex=`attribute vec2 vertex; varying vec2 uv; void main(){uv=vertex*.5+.5;gl_Position=vec4(vertex,0.,1.);}`;
const fragment=`precision highp float;
varying vec2 uv;
uniform sampler2D source, skinPlate;
uniform vec4 plateRect;
uniform vec2 size, origin, axis, upper, lower, seam, outerTop, outerBottom, xUpper, xLower, xSeam, xOuterTop, xOuterBottom;
uniform float length, closure, lashWidth;
float curve(vec2 p,vec2 xp,float x){float lo=0.,hi=1.;for(int i=0;i<14;i++){float t=(lo+hi)*.5;float bx=3.*t*(1.-t)*((1.-t)*xp.x+t*xp.y)+t*t*t;if(bx<x)lo=t;else hi=t;}float t=(lo+hi)*.5;return 3.*t*(1.-t)*((1.-t)*p.x+t*p.y)*length;}
vec4 sampleEye(float x,float y){vec2 normal=vec2(-axis.y,axis.x);return texture2D(source,(origin+axis*x+normal*y)/size);}
float luminance(vec4 p){return dot(p.rgb/max(p.a,.0001),vec3(.2126,.7152,.0722));}
void main(){
 vec4 original=texture2D(source,uv);
 vec2 normal=vec2(-axis.y,axis.x),p=uv*size-origin;
 float x=dot(p,axis),y=dot(p,normal),t=x/length;
 if(t<=0.||t>=1.||original.a<.0001){gl_FragColor=original;return;}
 float a=curve(outerTop,xOuterTop,t),u=curve(upper,xUpper,t),l=curve(lower,xLower,t),b=curve(outerBottom,xOuterBottom,t),s=curve(seam,xSeam,t);
 if(y<=a||y>=b){gl_FragColor=original;return;}
 float uc=mix(u,s,closure),lc=mix(l,s,closure);
 float taper=sin(t*3.14159265),gap=lashWidth*1.5*taper*smoothstep(0.,.2,closure);
 // Cached harmonic skin plate: surrounding source colors, no generated art.
 vec4 reference=texture2D(skinPlate,(uv*size-plateRect.xy)/plateRect.zw);
 vec4 skinTop=reference,skinBottom=reference;
 vec4 color=original;
 float topCoverage=1.-smoothstep(uc-.4,uc+.4,y);
 float bottomCoverage=smoothstep(lc-.4,lc+.4,y);
 if(closure>.999){topCoverage=1.-smoothstep(s-.2,s+.2,y);bottomCoverage=smoothstep(s-.2,s+.2,y);}
 color=mix(color,skinTop,topCoverage);color=mix(color,skinBottom,bottomCoverage);
 if(closure>.999&&y>=u&&y<=l)color=mix(skinTop,skinBottom,smoothstep(s-.5,s+.5,y));
 // Reproject measured original ink pigment and thickness onto the lid seam.
 // A smooth stroke avoids quantized darkest-row jumps; fine individual lash
 // spikes outside the support are deliberately left unchanged in this milestone.
 float dy=y-uc;
 if(abs(dy)<lashWidth){
  float start=max(a,u-lashWidth*2.),end=u+lashWidth*.2,inkLuma=1.;
  for(int i=0;i<24;i++){float sy=mix(start,end,float(i)/23.);inkLuma=min(inkLuma,luminance(sampleEye(x,sy)));}
  vec4 pigment=vec4(0.);float mass=0.;for(int i=0;i<24;i++){vec4 sample=sampleEye(x,mix(start,end,float(i)/23.));float weight=1.-smoothstep(inkLuma+.025,inkLuma+.12,luminance(sample));pigment+=sample*weight;mass+=weight;}
  pigment/=max(mass,.001);
  float thickness=clamp(mass*(end-start)/24.*.6,.7,lashWidth*.65);
  float ink=smoothstep(.08,.22,luminance(reference)-inkLuma)*(1.-smoothstep(thickness*.5-.5,thickness*.5+.5,abs(dy)));
  color=mix(color,pigment,ink);
 }
 // Keep the fine lower lid during partial closure, then merge to one seam.
 float ld=y-lc;
 if(abs(ld)<lashWidth*.45&&closure<.999){vec4 line=sampleEye(x,l+ld),skin=sampleEye(x,min(b,l+lashWidth*1.5));float dark=smoothstep(.03,.18,luminance(skin)-luminance(line));color=mix(color,line,dark*(1.-smoothstep(lashWidth*.2,lashWidth*.45,abs(ld)))*(1.-closure));}
 float feather=smoothstep(0.,.025,t)*smoothstep(0.,.025,1.-t)*smoothstep(0.,min(2.,length*.02),y-a)*smoothstep(0.,min(2.,length*.02),b-y);
 color=mix(original,color,feather);
 // Source coverage remains unchanged, including transparent illustration edges.
 if(color.a>.0001)color.rgb*=original.a/color.a;else color=original;
 color.a=original.a;gl_FragColor=color;
}`;
class BlinkPatch{
 constructor(gl){this.gl=gl;const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};const p=this.program=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));this.vertex=gl.getAttribLocation(p,'vertex');this.loc={};for(const k of ['source','skinPlate','plateRect','size','origin','axis','upper','lower','seam','outerTop','outerBottom','xUpper','xLower','xSeam','xOuterTop','xOuterBottom','length','closure','lashWidth'])this.loc[k]=gl.getUniformLocation(p,k);this.quad=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);}
 reset(width,height){const gl=this.gl;if(this.output)gl.deleteTexture(this.output);if(this.plate)gl.deleteTexture(this.plate);if(this.framebuffer)gl.deleteFramebuffer(this.framebuffer);this.output=null;this.plate=null;this.plateKey='';this.framebuffer=null;this.width=width;this.height=height;this.cache='';}
 prepareSkin(eye){
  const key=JSON.stringify([eye.corners,eye.supportUpper,eye.supportLower,eye.controlsX]);if(key===this.plateKey)return;
  const gl=this.gl,b=basis(eye,this.width,this.height),points=[];for(const k of ['supportUpper','supportLower'])for(let i=0;i<=100;i++)points.push(point(eye,k,i/100,this.width,this.height));
  const x0=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x)))-5),y0=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))-5),rw=Math.max(2,Math.min(this.width-x0,Math.ceil(Math.max(...points.map(p=>p.x)))-x0+6)),rh=Math.max(2,Math.min(this.height-y0,Math.ceil(Math.max(...points.map(p=>p.y)))-y0+6)),scale=Math.min(1,512/Math.max(rw,rh)),w=Math.max(2,Math.round(rw*scale)),h=Math.max(2,Math.round(rh*scale)),sx=rw/w,sy=rh/h;
  const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(this.image,x0,y0,rw,rh,0,0,w,h);const source=ctx.getImageData(0,0,w,h).data,mask=new Uint8Array(w*h),values=new Float32Array(w*h*3),temp=new Float32Array(w*h*3);
  const lut=512,top=new Float32Array(lut+1),bottom=new Float32Array(lut+1);for(let i=0;i<=lut;i++){top[i]=ordinate(eye,'supportUpper',i/lut)*b.length;bottom[i]=ordinate(eye,'supportLower',i/lut)*b.length;}
  const sample=(x,y,k)=>{x=Math.max(0,Math.min(w-1,(x-x0)/sx));y=Math.max(0,Math.min(h-1,(y-y0)/sy));const ix=Math.floor(x),iy=Math.floor(y),jx=Math.min(ix+1,w-1),jy=Math.min(iy+1,h-1),fx=x-ix,fy=y-iy;return (source[(iy*w+ix)*4+k]*(1-fx)+source[(iy*w+jx)*4+k]*fx)*(1-fy)+(source[(jy*w+ix)*4+k]*(1-fx)+source[(jy*w+jx)*4+k]*fx)*fy;};
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,dx=(x+.5)*sx+x0-b.a.x,dy=(y+.5)*sy+y0-b.a.y,t=(dx*b.ux+dy*b.uy)/b.length,ny=dx*b.nx+dy*b.ny;let a=0,z=0;if(t>0&&t<1){const j=Math.min(lut-1,Math.floor(t*lut)),f=t*lut-j;a=top[j]*(1-f)+top[j+1]*f;z=bottom[j]*(1-f)+bottom[j+1]*f;if(ny>a&&ny<z&&x>0&&y>0&&x<w-1&&y<h-1)mask[i]=1;}
   for(let k=0;k<3;k++){let value=source[i*4+k];if(mask[i]){const px=b.a.x+b.ux*t*b.length,py=b.a.y+b.uy*t*b.length,ca=sample(px+b.nx*(a-1),py+b.ny*(a-1),k),cb=sample(px+b.nx*(z+1),py+b.ny*(z+1),k),f=(ny-a)/(z-a);value=ca*(1-f)+cb*f;}values[i*3+k]=value;}}
  // Harmonic interpolation is classical color interpolation, not AI. Only the
  // eye support is filled, from its immutable boundary; recompute on curve edits
  // only. The preview at different closures reuses this small cached plate.
  for(let pass=0;pass<100;pass++){temp.set(values);for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;if(!mask[i])continue;for(let k=0;k<3;k++)temp[i*3+k]=(values[(i-1)*3+k]+values[(i+1)*3+k]+values[(i-w)*3+k]+values[(i+w)*3+k])*.25;}values.set(temp);}
  const pixels=new Uint8Array(source.length);for(let i=0;i<mask.length;i++){const alpha=source[i*4+3];for(let k=0;k<3;k++)pixels[i*4+k]=Math.round(values[i*3+k]*alpha/255);pixels[i*4+3]=alpha;}
  if(!this.plate)this.plate=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.plate);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,k,gl.LINEAR);for(const k of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,k,gl.CLAMP_TO_EDGE);this.plateRect=[x0,y0,rw,rh];this.plateSize=[w,h];this.plateKey=key;
 }
 compose(source,eye){if(!eye||!eye.enabled||eye.closure===0)return source;const key=JSON.stringify(eye);if(key===this.cache&&this.output)return this.output;const gl=this.gl;
  if(!this.output){this.output=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.output);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,this.width,this.height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,k,gl.LINEAR);for(const k of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,k,gl.CLAMP_TO_EDGE);this.framebuffer=gl.createFramebuffer();}
  gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.output,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){gl.bindFramebuffer(gl.FRAMEBUFFER,null);throw Error('Could not allocate the eye preview texture. Try a smaller illustration.');}
  this.prepareSkin(eye);const b=basis(eye,this.width,this.height);gl.viewport(0,0,this.width,this.height);gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);gl.enableVertexAttribArray(this.vertex);gl.vertexAttribPointer(this.vertex,2,gl.FLOAT,false,0,0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.plate);gl.uniform1i(this.loc.skinPlate,1);gl.uniform4fv(this.loc.plateRect,this.plateRect);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,source);gl.uniform1i(this.loc.source,0);gl.uniform2f(this.loc.size,this.width,this.height);gl.uniform2f(this.loc.origin,b.a.x,b.a.y);gl.uniform2f(this.loc.axis,b.ux,b.uy);gl.uniform1f(this.loc.length,b.length);gl.uniform1f(this.loc.closure,eye.closure);gl.uniform1f(this.loc.lashWidth,eye.lashWidth);for(const [k,v]of [['upper',eye.upper],['lower',eye.lower],['seam',eye.closed],['outerTop',eye.supportUpper],['outerBottom',eye.supportLower]])gl.uniform2fv(this.loc[k],v);for(const [k,key]of [['xUpper','upper'],['xLower','lower'],['xSeam','closed'],['xOuterTop','supportUpper'],['xOuterBottom','supportLower']])gl.uniform2fv(this.loc[k],eye.controlsX?.[key]||[1/3,2/3]);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.bindFramebuffer(gl.FRAMEBUFFER,null);this.cache=key;return this.output;
 }
}
root.Stillwave??={};Object.assign(root.Stillwave,{BlinkPatch,EyeGeometry:{curves,curveColors,bezier,ordinate,basis,point,handles,createEye,validate,moveHandle}});
if(typeof module!=='undefined')module.exports={EyeGeometry:root.Stillwave.EyeGeometry};
})(typeof window!=='undefined'?window:globalThis);


