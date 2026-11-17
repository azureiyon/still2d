/* A single shared triangle lattice: texture coordinates never change; vertices do.
   No cutouts are composited, so adjacent motion regions cannot open cracks. */
(function(root){
'use strict';
class MotionMesh {
 constructor(width,height,resolution=144){
  this.width=width;this.height=height;
  this.cols=Math.max(12,Math.round(resolution*width/Math.max(width,height)));
  this.rows=Math.max(12,Math.round(resolution*height/Math.max(width,height)));
  this.count=(this.cols+1)*(this.rows+1);this.rest=new Float32Array(this.count*2);this.positions=new Float32Array(this.count*2);this.delta=new Float32Array(this.count*2);this.protection=new Float32Array(this.count);
  const tris=[];
  for(let y=0;y<=this.rows;y++)for(let x=0;x<=this.cols;x++){let i=y*(this.cols+1)+x;this.rest[i*2]=x/this.cols*width;this.rest[i*2+1]=y/this.rows*height;if(x<this.cols&&y<this.rows){const a=i,b=i+1,c=i+this.cols+1,d=c+1;tris.push(a,b,c,b,d,c);}}
  this.indices=new Uint16Array(tris);this.positions.set(this.rest);this.guard=1;
  this.mobility=new Float32Array(this.count);this.target=new Float32Array(this.count*2);
  const edges=[],limits=[];for(let y=0;y<=this.rows;y++)for(let x=0;x<=this.cols;x++){const i=y*(this.cols+1)+x;if(x<this.cols){edges.push(i,i+1);limits.push(width/this.cols);}if(y<this.rows){edges.push(i,i+this.cols+1);limits.push(height/this.rows);}}this.edges=new Int32Array(edges);this.edgeLengths=new Float32Array(limits);
 }
 sample(data,w,h,x,y){const px=Math.max(0,Math.min(w-1,x*(w-1)/this.width)),py=Math.max(0,Math.min(h-1,y*(h-1)/this.height)),x0=Math.floor(px),y0=Math.floor(py),x1=Math.min(x0+1,w-1),y1=Math.min(y0+1,h-1),fx=px-x0,fy=py-y0;return ((data[(y0*w+x0)*4+3]*(1-fx)+data[(y0*w+x1)*4+3]*fx)*(1-fy)+(data[(y1*w+x0)*4+3]*(1-fx)+data[(y1*w+x1)*4+3]*fx)*fy)/255;}
 compileMask(data,w,h){const weights=new Float32Array(this.count);let sx=0,sy=0,sum=0;for(let i=0;i<this.count;i++){const x=this.rest[i*2],y=this.rest[i*2+1],v=this.sample(data,w,h,x,y);weights[i]=v;sx+=x*v;sy+=y*v;sum+=v;}return {weights,cx:sum?sx/sum:this.width/2,cy:sum?sy/sum:this.height/2};}
 // Distance travels within each connected mask, so separate locks get their own
 // root and tip timing. This is a kinematic bend envelope, not fluid turbulence.
 prepareHair(r){
  const n=this.count,stride=this.cols+1,seen=new Uint8Array(n),travel=new Float32Array(n),queue=new Int32Array(n),distance=new Int32Array(n);distance.fill(-1);const roots=[];
  const neighbors=i=>{const a=[];if(i%stride)a.push(i-1);if(i%stride<this.cols)a.push(i+1);if(i>=stride)a.push(i-stride);if(i+stride<n)a.push(i+stride);return a;};
  for(let start=0;start<n;start++){if(seen[start]||r.weights[start]<=.02)continue;let head=0,tail=1;queue[0]=start;seen[start]=1;const component=[];let minY=Infinity,maxY=0;while(head<tail){const i=queue[head++];component.push(i);minY=Math.min(minY,this.rest[i*2+1]);maxY=Math.max(maxY,this.rest[i*2+1]);for(const j of neighbors(i))if(!seen[j]&&r.weights[j]>.02){seen[j]=1;queue[tail++]=j;}}
   let seeds=component.filter(i=>this.protection[i]>.35);
   if(r.root){let best=Infinity,seed=start;for(const i of component){const d=(this.rest[i*2]-r.root.x*this.width)**2+(this.rest[i*2+1]-r.root.y*this.height)**2;if(d<best){best=d;seed=i;}}seeds=[seed];}
   if(!seeds.length)seeds=component.filter(i=>this.rest[i*2+1]<=minY+(maxY-minY)*.1);
   head=0;tail=0;let rx=0,ry=0;for(const i of seeds){distance[i]=0;queue[tail++]=i;rx+=this.rest[i*2];ry+=this.rest[i*2+1];}roots.push({x:rx/seeds.length,y:ry/seeds.length});
   let longest=1;while(head<tail){const i=queue[head++];if(r.weights[i]>.3)longest=Math.max(longest,distance[i]);for(const j of neighbors(i))if(distance[j]<0&&r.weights[j]>.02){distance[j]=distance[i]+1;queue[tail++]=j;}}
   for(const i of component)travel[i]=Math.min(1,distance[i]/longest);
  }
  r.hair={travel,roots};return r.hair;
 }
 deform(regions,time){
  const d=this.delta;d.fill(0);let width=this.width,height=this.height;
  const active=regions.filter(r=>r.enabled&&r.weights&&!r.cutout?.active).map(r=>{if(r.preset==='sway'&&!r.hair)this.prepareHair(r);return {r,pathFrame:['swing','bend','flutter'].includes(r.preset)?root.Stillwave.HairMotion.frame(r,this,time):null,phase:time*r.speed*Math.PI*2+r.phase*Math.PI/180,ux:Math.cos(r.direction*Math.PI/180),uy:Math.sin(r.direction*Math.PI/180)};});
  for(let i=0;i<this.count;i++){
   const x=this.rest[2*i],y=this.rest[2*i+1];let dx=0,dy=0,total=0,uncovered=1;
   for(const {r,phase,ux,uy,pathFrame} of active){let weight=r.weights[i];if(weight<.00001)continue;let travel=0;if(r.preset==='sway'){travel=r.hair.travel[i];let f=Math.max(0,(travel-.08)/.92);weight*=f*f*(3-2*f);}if(weight<.00001)continue;
    let mx=0,my=0;
    if(pathFrame){const p=root.Stillwave.HairMotion.transform(r,pathFrame,x,y);mx=p.x-x;my=p.y-y;}else if(r.preset==='breathing'){
     const breath=Math.sin(phase);mx=(x-r.cx)/Math.max(width,height)*r.amplitude*2*breath;my=(y-r.cy)/Math.max(width,height)*r.amplitude*2*breath;
     mx+=ux*r.amplitude*.25*breath;my+=uy*r.amplitude*.25*breath;
    }else{
     let wave=Math.sin(phase);
     if(r.preset==='sway')wave=(Math.sin(phase-travel*.7)+.08*travel*travel*Math.sin(phase*2-travel*1.2+(x-r.cx)/width*4))/1.08;
     if(r.preset==='bounce')wave=Math.sin(phase)*.8+Math.sin(phase*2)*.2;
     mx=ux*r.amplitude*wave;my=uy*r.amplitude*wave;
    }
    if(!pathFrame){const start=Math.max(0,Math.min(1,time/.25)),gain=start*start*(3-2*start);mx*=gain;my*=gain;}
    // Smooth partition of unity: firm interiors win over faint blurred tails.
    const w2=weight*weight;dx+=mx*w2;dy+=my*w2;total+=w2;uncovered*=1-weight;
   }
   // Image perimeter is pinned; overlap is normalized, not added without bound.
   const edge=Math.min(x/(width/this.cols*2),y/(height/this.rows*2),(width-x)/(width/this.cols*2),(height-y)/(height/this.rows*2),1);
   const mobility=(1-this.protection[i])*Math.max(0,edge)*(1-uncovered);this.mobility[i]=mobility;
   const pin=mobility/Math.max(.000000001,total);
   d[i*2]=dx*pin;d[i*2+1]=dy*pin;
  }
  this.target.set(d);this.constrainLocal();
  for(let i=0;i<this.rest.length;i++)this.positions[i]=this.rest[i]+d[i];
  return this.positions;
 }
 constrainLocal(){
  const d=this.delta,m=this.mobility,e=this.edges,lengths=this.edgeLengths;let corrections=0;
  // Project only violated local edges. Fixed anchors and untouched pixels have
  // zero mobility. A margin between .35 and .42 allows bounded solver work.
  for(let pass=0;pass<12;pass++){let changed=false;const reverse=pass%2;for(let k=0;k<lengths.length;k++){const edge=reverse?lengths.length-1-k:k,a=e[edge*2],b=e[edge*2+1],dx=d[b*2]-d[a*2],dy=d[b*2+1]-d[a*2+1],sq=dx*dx+dy*dy,limit=lengths[edge]*.35;if(sq<=limit*limit||m[a]+m[b]<1e-12)continue;const factor=(1-limit/Math.sqrt(sq))/(m[a]+m[b]),ax=m[a]*factor,bx=m[b]*factor;d[a*2]+=dx*ax;d[a*2+1]+=dy*ax;d[b*2]-=dx*bx;d[b*2+1]-=dy*bx;changed=true;}if(!changed)break;}
  // Rare severe fields: safety scaling is restricted to a connected support
  // island, never the entire illustration. Verify each island's worst edge.
  let needsFallback=false;for(let k=0;k<lengths.length;k++){const a=e[k*2],b=e[k*2+1];if(Math.hypot(d[b*2]-d[a*2],d[b*2+1]-d[a*2+1])>lengths[k]*.42){needsFallback=true;break;}}
  this.fallbackIslands=0;
  if(needsFallback){const labels=new Int32Array(this.count);labels.fill(-1);const scales=[],stride=this.cols+1;let count=0;const q=new Int32Array(this.count);for(let s=0;s<this.count;s++){if(m[s]<=0||labels[s]>=0)continue;let head=0,tail=1;q[0]=s;labels[s]=count;while(head<tail){const i=q[head++],x=i%stride;for(const j of [x?i-1:-1,x<this.cols?i+1:-1,i-stride,i+stride])if(j>=0&&j<this.count&&m[j]>0&&labels[j]<0){labels[j]=count;q[tail++]=j;}}scales.push(1);count++;}for(let k=0;k<lengths.length;k++){const a=e[k*2],b=e[k*2+1],gradient=Math.hypot(d[b*2]-d[a*2],d[b*2+1]-d[a*2+1])/lengths[k],scale=Math.min(1,.419/Math.max(gradient,1e-9));if(labels[a]>=0)scales[labels[a]]=Math.min(scales[labels[a]],scale);if(labels[b]>=0)scales[labels[b]]=Math.min(scales[labels[b]],scale);}this.fallbackIslands=scales.filter(s=>s<1).length;for(let i=0;i<this.count;i++)if(labels[i]>=0){const s=scales[labels[i]];d[i*2]*=s;d[i*2+1]*=s;}}
  for(let i=0;i<this.count;i++)if(Math.hypot(d[i*2]-this.target[i*2],d[i*2+1]-this.target[i*2+1])>.01)corrections++;
  this.localCorrections=corrections;this.guard=1;
 }
}
class MeshRenderer {
 constructor(canvas){
  this.canvas=canvas;const gl=this.gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:true});if(!gl)throw Error('WebGL is unavailable. Enable hardware acceleration in your browser.');
  const shader=(kind,src)=>{let s=gl.createShader(kind);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  let p=this.program=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,'attribute vec2 position; attribute vec2 uv; uniform vec2 viewport; uniform vec2 offset; uniform float zoom; varying vec2 vUV; void main(){vec2 p=position*zoom+offset; gl_Position=vec4(p.x/viewport.x*2.0-1.0,1.0-p.y/viewport.y*2.0,0,1); vUV=uv;}'));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,'precision mediump float; varying vec2 vUV; uniform sampler2D image; void main(){ gl_FragColor=texture2D(image,vUV); }'));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
  this.pos=gl.createBuffer();this.uv=gl.createBuffer();this.index=gl.createBuffer();this.texture=gl.createTexture();
  this.loc={};for(const n of ['viewport','offset','zoom','image'])this.loc[n]=gl.getUniformLocation(p,n);
  this.blink=new root.Stillwave.BlinkPatch(gl);this.aPos=gl.getAttribLocation(p,'position');this.aUV=gl.getAttribLocation(p,'uv');gl.enableVertexAttribArray(this.aPos);gl.enableVertexAttribArray(this.aUV);
 }
 upload(image,mesh){const gl=this.gl;this.sourceImage=image;this.artwork?.reset();this.blink.reset(image.width,image.height);this.blink.image=image;const uv=new Float32Array(mesh.rest.length);for(let i=0;i<mesh.count;i++){uv[i*2]=mesh.rest[i*2]/mesh.width;uv[i*2+1]=mesh.rest[i*2+1]/mesh.height;}gl.bindBuffer(gl.ARRAY_BUFFER,this.uv);gl.bufferData(gl.ARRAY_BUFFER,uv,gl.STATIC_DRAW);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.index);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh.indices,gl.STATIC_DRAW);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);if(gl.getError()!==gl.NO_ERROR)throw Error('The graphics driver could not upload this image. Try a smaller image.');}
 draw(mesh,view,eye=null){const gl=this.gl;let source=this.texture;if(this.artwork&&!this.originalMode)source=this.artwork.prepare(this.texture).texture;this.blink.image=this.sourceImage;this.blinkSource=this.blink.compose(this.texture,this.originalMode?null:eye);this.preparedTexture=source;const image=this.artwork&&!this.originalMode?this.artwork.composeEyes(this.texture,this.blinkSource,JSON.stringify((Array.isArray(eye)?eye:eye?[eye]:[]).map(e=>[e.enabled,e.closure]))+this.blink.patches.map(p=>p.cache).join('|')):this.blinkSource;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);if(!mesh)return;gl.useProgram(this.program);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,image);gl.uniform1i(this.loc.image,0);gl.enableVertexAttribArray(this.aPos);gl.enableVertexAttribArray(this.aUV);gl.bindBuffer(gl.ARRAY_BUFFER,this.pos);gl.bufferData(gl.ARRAY_BUFFER,mesh.positions,gl.DYNAMIC_DRAW);gl.vertexAttribPointer(this.aPos,2,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,this.uv);gl.vertexAttribPointer(this.aUV,2,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.index);gl.uniform2f(this.loc.viewport,view.width,view.height);gl.uniform2f(this.loc.offset,view.x,view.y);gl.uniform1f(this.loc.zoom,view.zoom);gl.drawElements(gl.TRIANGLES,mesh.indices.length,gl.UNSIGNED_SHORT,0);if(this.artwork&&!this.originalMode)this.artwork.draw(mesh,view,this.time||0);}
}
root.Stillwave={MotionMesh,MeshRenderer};if(typeof module!=='undefined')module.exports=root.Stillwave;
})(typeof window!=='undefined'?window:globalThis);


