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
 }
 sample(data,w,h,x,y){const px=Math.max(0,Math.min(w-1,x*(w-1)/this.width)),py=Math.max(0,Math.min(h-1,y*(h-1)/this.height)),x0=Math.floor(px),y0=Math.floor(py),x1=Math.min(x0+1,w-1),y1=Math.min(y0+1,h-1),fx=px-x0,fy=py-y0;return ((data[(y0*w+x0)*4+3]*(1-fx)+data[(y0*w+x1)*4+3]*fx)*(1-fy)+(data[(y1*w+x0)*4+3]*(1-fx)+data[(y1*w+x1)*4+3]*fx)*fy)/255;}
 compileMask(data,w,h){const weights=new Float32Array(this.count);let sx=0,sy=0,sum=0;for(let i=0;i<this.count;i++){const x=this.rest[i*2],y=this.rest[i*2+1],v=this.sample(data,w,h,x,y);weights[i]=v;sx+=x*v;sy+=y*v;sum+=v;}return {weights,cx:sum?sx/sum:this.width/2,cy:sum?sy/sum:this.height/2};}
 deform(regions,time){
  const d=this.delta;d.fill(0);let width=this.width,height=this.height;
  for(let i=0;i<this.count;i++){
   const x=this.rest[2*i],y=this.rest[2*i+1];let dx=0,dy=0,total=0;
   for(const r of regions){if(!r.enabled||!r.weights)continue;const weight=r.weights[i];if(weight<.0001)continue;
    const theta=r.direction*Math.PI/180,phase=time*r.speed*Math.PI*2+r.phase*Math.PI/180;
    let mx=0,my=0;
    if(r.preset==='breathing'){
     const breath=Math.sin(phase);mx=(x-r.cx)/Math.max(width,height)*r.amplitude*2*breath;my=(y-r.cy)/Math.max(width,height)*r.amplitude*2*breath;
     mx+=Math.cos(theta)*r.amplitude*.25*breath;my+=Math.sin(theta)*r.amplitude*.25*breath;
    }else{
     let wave=Math.sin(phase);
     if(r.preset==='sway')wave=(Math.sin(phase+(y-r.cy)/height*2)+.18*Math.sin(phase*2+(x-r.cx)/width*3))/1.18;
     if(r.preset==='bounce')wave=Math.sin(phase)*.8+Math.sin(phase*2)*.2;
     mx=Math.cos(theta)*r.amplitude*wave;my=Math.sin(theta)*r.amplitude*wave;
    }
    dx+=mx*weight;dy+=my*weight;total+=weight;
   }
   // Image perimeter is pinned; overlap is normalized, not added without bound.
   const edge=Math.min(x/(width/this.cols*2),y/(height/this.rows*2),(width-x)/(width/this.cols*2),(height-y)/(height/this.rows*2),1);
   const pin=(1-this.protection[i])*Math.max(0,edge)/Math.max(1,total);
   d[i*2]=dx*pin;d[i*2+1]=dy*pin;
  }
  // Bound the displacement gradient along both lattice axes. Each axis' change
  // is <= .42 of its rest edge; the Frobenius bound is <1, preventing folds.
  let maxGradient=0;
  for(let y=0;y<=this.rows;y++)for(let x=0;x<=this.cols;x++){
   const i=y*(this.cols+1)+x;
   if(x<this.cols){let j=i+1;maxGradient=Math.max(maxGradient,Math.hypot(d[j*2]-d[i*2],d[j*2+1]-d[i*2+1])/(width/this.cols));}
   if(y<this.rows){let j=i+this.cols+1;maxGradient=Math.max(maxGradient,Math.hypot(d[j*2]-d[i*2],d[j*2+1]-d[i*2+1])/(height/this.rows));}
  }
  this.guard=Math.min(1,.42/Math.max(.000001,maxGradient));
  for(let i=0;i<this.rest.length;i++)this.positions[i]=this.rest[i]+d[i]*this.guard;
  return this.positions;
 }
}
class MeshRenderer {
 constructor(canvas){
  this.canvas=canvas;const gl=this.gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:true});if(!gl)throw Error('WebGL is unavailable. Enable hardware acceleration in your browser.');
  const shader=(kind,src)=>{let s=gl.createShader(kind);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  let p=this.program=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,'attribute vec2 position; attribute vec2 uv; uniform vec2 viewport; uniform vec2 offset; uniform float zoom; varying vec2 vUV; void main(){vec2 p=position*zoom+offset; gl_Position=vec4(p.x/viewport.x*2.0-1.0,1.0-p.y/viewport.y*2.0,0,1); vUV=uv;}'));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,'precision mediump float; varying vec2 vUV; uniform sampler2D image; void main(){ gl_FragColor=texture2D(image,vUV); }'));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
  this.pos=gl.createBuffer();this.uv=gl.createBuffer();this.index=gl.createBuffer();this.texture=gl.createTexture();
  this.loc={};for(const n of ['viewport','offset','zoom','image'])this.loc[n]=gl.getUniformLocation(p,n);
  this.aPos=gl.getAttribLocation(p,'position');this.aUV=gl.getAttribLocation(p,'uv');gl.enableVertexAttribArray(this.aPos);gl.enableVertexAttribArray(this.aUV);
 }
 upload(image,mesh){const gl=this.gl;const uv=new Float32Array(mesh.rest.length);for(let i=0;i<mesh.count;i++){uv[i*2]=mesh.rest[i*2]/mesh.width;uv[i*2+1]=mesh.rest[i*2+1]/mesh.height;}gl.bindBuffer(gl.ARRAY_BUFFER,this.uv);gl.bufferData(gl.ARRAY_BUFFER,uv,gl.STATIC_DRAW);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.index);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh.indices,gl.STATIC_DRAW);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);if(gl.getError()!==gl.NO_ERROR)throw Error('The graphics driver could not upload this image. Try a smaller image.');}
 draw(mesh,view){const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);if(!mesh)return;gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.pos);gl.bufferData(gl.ARRAY_BUFFER,mesh.positions,gl.DYNAMIC_DRAW);gl.vertexAttribPointer(this.aPos,2,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,this.uv);gl.vertexAttribPointer(this.aUV,2,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.index);gl.uniform2f(this.loc.viewport,view.width,view.height);gl.uniform2f(this.loc.offset,view.x,view.y);gl.uniform1f(this.loc.zoom,view.zoom);gl.drawElements(gl.TRIANGLES,mesh.indices.length,gl.UNSIGNED_SHORT,0);}
}
root.Stillwave={MotionMesh,MeshRenderer};if(typeof module!=='undefined')module.exports=root.Stillwave;
})(typeof window!=='undefined'?window:globalThis);
