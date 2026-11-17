/* Eye-local, non-destructive raster assets. No general layer system or AI. */
(function(root){
'use strict';
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const lum=(r,g,b)=>(r*.2126+g*.7152+b*.0722)/255;
function encode(bytes){let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);}
function decode(record){const s=atob(record.data),a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return a;}
function validRecord(r,width,height,channels=1){if(r==null)return true;if(!Array.isArray(r.rect)||r.rect.length!==4||r.rect.some(v=>!Number.isFinite(v))||r.rect[0]<0||r.rect[1]<0||r.rect[2]<1||r.rect[3]<1||r.rect[0]+r.rect[2]>width+1||r.rect[1]+r.rect[3]>height+1||!Number.isInteger(r.width)||!Number.isInteger(r.height)||r.width<1||r.height<1||r.width>1024||r.height>1024||typeof r.data!=='string'||r.data.length>1500000*channels)return false;try{return atob(r.data).length===r.width*r.height*channels;}catch{return false;}}
function raster(record,a,channels=1,initial=0){const data=new Uint8Array(a.width*a.height*channels);if(!record){data.fill(initial);return data;}const src=decode(record);for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){const px=a.rect[0]+(x+.5)*a.rect[2]/a.width,py=a.rect[1]+(y+.5)*a.rect[3]/a.height,mx=Math.floor((px-record.rect[0])*record.width/record.rect[2]),my=Math.floor((py-record.rect[1])*record.height/record.rect[3]);if(mx>=0&&my>=0&&mx<record.width&&my<record.height)for(let k=0;k<channels;k++)data[(y*a.width+x)*channels+k]=src[(my*record.width+mx)*channels+k];}return data;}
// Inward chamfer distance: feathering never expands a painted edit boundary.
function inward(mask,w,h,radius,sx,sy){if(radius<=0)return Float32Array.from(mask,v=>v/255);const d=new Float32Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;d[i]=mask[i]===0?0:Math.min(x+.5,w-x-.5)*sx;d[i]=Math.min(d[i],Math.min(y+.5,h-y-.5)*sy);if(x)d[i]=Math.min(d[i],d[i-1]+sx);if(y)d[i]=Math.min(d[i],d[i-w]+sy);}for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){const i=y*w+x;if(x<w-1)d[i]=Math.min(d[i],d[i+1]+sx);if(y<h-1)d[i]=Math.min(d[i],d[i+w]+sy);}return Float32Array.from(d,(v,i)=>{const t=clamp(v/radius);return t*t*(3-2*t)*mask[i]/255;});}
function validDonor(r,width,height){return r==null||['x','y','width','height'].every(k=>Number.isFinite(r[k]))&&r.x>=0&&r.y>=0&&r.width>=4&&r.height>=4&&r.x+r.width<=width&&r.y+r.height<=height;}
function make(image,eye,width,height){
 const g=root.Stillwave.EyeGeometry,b=g.basis(eye,width,height),points=[];for(const k of [...g.curves,...(eye.crease?['crease']:[])])for(let i=0;i<=64;i++)points.push(g.point(eye,k,i/64,width,height));const margin=Math.max(12,b.length*.24);
 const x0=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x))-margin)),y0=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y))-margin)),rw=Math.min(width-x0,Math.ceil(Math.max(...points.map(p=>p.x))+margin)-x0),rh=Math.min(height-y0,Math.ceil(Math.max(...points.map(p=>p.y))+margin)-y0),scale=Math.min(1,1024/Math.max(rw,rh)),w=Math.max(2,Math.round(rw*scale)),h=Math.max(2,Math.round(rh*scale)),sx=rw/w,sy=rh/h;
 const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,x0,y0,rw,rh,0,0,w,h);const pixels=ctx.getImageData(0,0,w,h).data;
 const donor=eye.skinDonor||{x:clamp((b.a.x+b.b.x)/2-b.length*.3,0,width-Math.min(width,b.length*.6)),y:clamp((b.a.y+b.b.y)/2+b.length*.36,0,height-Math.min(height,b.length*.3)),width:Math.min(width,b.length*.6),height:Math.min(height,b.length*.3)};
 // Read only the donor crop; never allocate another full-size source canvas.
 const dc=document.createElement('canvas'),donorScale=Math.min(1,1024/Math.max(donor.width,donor.height));dc.width=Math.max(1,Math.round(donor.width*donorScale));dc.height=Math.max(1,Math.round(donor.height*donorScale));const dctx=dc.getContext('2d',{willReadFrequently:true});dctx.drawImage(image,donor.x,donor.y,donor.width,donor.height,0,0,dc.width,dc.height);
 const donorPixels=dctx.getImageData(0,0,dc.width,dc.height);dc.width=dc.height=1;
 const sampleDonor=(x,y,k)=>{const mirror=v=>{v=((v%2)+2)%2;return v>1?2-v:v;},dx=mirror(x)*(donorPixels.width-1),dy=mirror(y)*(donorPixels.height-1),a=Math.floor(dx),z=Math.floor(dy),a1=Math.min(a+1,donorPixels.width-1),z1=Math.min(z+1,donorPixels.height-1),fx=dx-a,fy=dy-z,d=donorPixels.data;return ((d[(z*donorPixels.width+a)*4+k]*(1-fx)+d[(z*donorPixels.width+a1)*4+k]*fx)*(1-fy)+(d[(z1*donorPixels.width+a)*4+k]*(1-fx)+d[(z1*donorPixels.width+a1)*4+k]*fx)*fy);};
 const u=new Float32Array(1025),l=new Float32Array(1025);for(let i=0;i<=1024;i++){u[i]=g.ordinate(eye,'upper',i/1024)*b.length;l[i]=g.ordinate(eye,'lower',i/1024)*b.length;}
 const at=(a,t)=>{const f=clamp(t)*1024,i=Math.min(1023,Math.floor(f));return a[i]*(1-(f-i))+a[i+1]*(f-i);};
 const matte=new Uint8Array(w*h),eligible=new Uint8Array(w*h),seed=[],coords=new Float32Array(w*h*2),aperture=new Float32Array(w*h),ref=[sampleDonor(.5,.5,0),sampleDonor(.5,.5,1),sampleDonor(.5,.5,2)],skinLum=lum(...ref);
 let maskSource=null;if(eye.lashMatte)maskSource=decode(eye.lashMatte);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,px=x0+(x+.5)*sx-b.a.x,py=y0+(y+.5)*sy-b.a.y,t=(px*b.ux+py*b.uy)/b.length,ny=px*b.nx+py*b.ny,upper=at(u,t),lower=at(l,t);coords[i*2]=t;coords[i*2+1]=ny;
  if(t>0&&t<1){const edge=Math.min(t,1-t)*b.length;aperture[i]=clamp((ny-upper+1)/2)*clamp((lower+1.5-ny)/2)*clamp(edge/2);}
  if(maskSource){const r=eye.lashMatte,mx=Math.floor((x0+(x+.5)*sx-r.rect[0])/r.rect[2]*r.width),my=Math.floor((y0+(y+.5)*sy-r.rect[1])/r.rect[3]*r.height);if(mx>=0&&my>=0&&mx<r.width&&my<r.height)matte[i]=maskSource[my*r.width+mx];}
  else if(t>-.18&&t<1.12&&ny>upper-Math.max(12,eye.lashWidth*4)&&ny<upper+Math.max(2,eye.lashWidth*.55)){
   const alpha=clamp((skinLum-lum(pixels[i*4],pixels[i*4+1],pixels[i*4+2])-.025)/Math.max(.15,skinLum-.12));if(alpha>.22){eligible[i]=Math.round(alpha*255);if(t>.04&&t<.96&&Math.abs(ny-upper)<Math.max(4,eye.lashWidth*1.6))seed.push(i);}
  }
 }
 if(!maskSource){const queue=new Int32Array(w*h),seen=new Uint8Array(w*h);let head=0,tail=0;for(const i of seed)if(!seen[i]){seen[i]=1;queue[tail++]=i;}while(head<tail){const i=queue[head++];matte[i]=eligible[i];for(const j of [i-1,i+1,i-w,i+w,i-w-1,i-w+1,i+w-1,i+w+1])if(j>=0&&j<w*h&&!seen[j]&&eligible[j]&&Math.abs(j%w-i%w)<=1){seen[j]=1;queue[tail++]=j;}}}
 // Only the original eye aperture and selected ink need underpainting. In
 // particular, the upper crease/brow and the rest of the support are retained.
 const repair=new Float32Array(aperture);const dilation=Math.max(1,Math.ceil((eye.repairMargin??4)/Math.max(sx,sy)));
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(matte[i]<4)continue;for(let oy=-dilation-2;oy<=dilation+2;oy++)for(let ox=-dilation-2;ox<=dilation+2;ox++){const xx=x+ox,yy=y+oy;if(xx<0||yy<0||xx>=w||yy>=h)continue;repair[yy*w+xx]=Math.max(repair[yy*w+xx],clamp((dilation+2-Math.hypot(ox,oy))/2));}}
 const clone=new Float32Array(w*h*3),correction=new Float32Array(w*h*3),next=new Float32Array(w*h*3);
 const openPoints=[];for(let j=0;j<=32;j++){openPoints.push(g.point(eye,'upper',j/32,width,height),g.point(eye,'lower',j/32,width,height));}const bx=Math.min(...openPoints.map(p=>p.x)),by=Math.min(...openPoints.map(p=>p.y)),bw=Math.max(...openPoints.map(p=>p.x))-bx,bh=Math.max(...openPoints.map(p=>p.y))-by;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;for(let k=0;k<3;k++){clone[i*3+k]=sampleDonor((x0+(x+.5)*sx-bx)/Math.max(1,donor.width),(y0+(y+.5)*sy-by)/Math.max(1,donor.height),k);correction[i*3+k]=repair[i]>.01?0:clamp(pixels[i*4+k]-clone[i*3+k],-28,28);}}
 // Blend a cloned texture by diffusing *color correction*, not colors. The
 // actual donor texture survives; clamping prevents hair-dark boundary wedges.
 for(let pass=0;pass<70;pass++){next.set(correction);for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;if(repair[i]<=.01)continue;for(let k=0;k<3;k++)next[i*3+k]=(correction[(i-1)*3+k]+correction[(i+1)*3+k]+correction[(i-w)*3+k]+correction[(i+w)*3+k])*.25;}correction.set(next);}
 const box={rect:[x0,y0,rw,rh],width:w,height:h},limit=raster(eye.repairLimit,box,1,255),protection=raster(eye.protectMask,box),paint=raster(eye.repairPaint,box,4),area=inward(limit,w,h,eye.repairFeather??0,sx,sy),controls=new Uint8Array(pixels.length);
 // Donor-only statistics: iris/white pixels never seed any reconstruction.
 const samples=[[],[],[]];for(let i=0;i<donorPixels.data.length;i+=4)if(donorPixels.data[i+3]>200)for(let k=0;k<3;k++)samples[k].push(donorPixels.data[i+k]);const fillColor=samples.map((s,k)=>{s.sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:ref[k];});
 const mode=eye.repairMode??'texture',clean=new Uint8Array(pixels.length),lash=new Uint8Array(pixels.length);
 for(let i=0;i<w*h;i++){const alpha=pixels[i*4+3]/255,a=matte[i]/255,pa=paint[i*4+3]/255,weight=repair[i];
  // Deliberate masks control boundaries. Color-threshold "protection" would
  // mistake antialiased lash edges for hair and leave dark dotted ghosts.
  repair[i]=Math.max(weight,pa);
  for(let k=0;k<3;k++){const texture=clamp(clone[i*3+k]+correction[i*3+k],0,255),soft=fillColor[k],bg=mode==='soft'?soft:mode==='blend'?clamp(soft+(texture-soft)*.3,0,255):texture,base=pixels[i*4+k]*(1-weight)+bg*weight;clean[i*4+k]=Math.round((base*(1-pa)+paint[i*4+k]*pa)*alpha);const fg=a>.001?clamp((pixels[i*4+k]-(1-a)*texture)/a,0,255):0;lash[i*4+k]=Math.round(fg*a*alpha);}
  clean[i*4+3]=pixels[i*4+3];lash[i*4+3]=Math.round(a*255*alpha);controls[i*4]=Math.round(area[i]*255);controls[i*4+1]=protection[i];controls[i*4+3]=255;
 }
 let extent=2;for(let i=0;i<matte.length;i++)if(matte[i]>8){const t=Math.max(0,Math.min(1,coords[i*2])),dy=coords[i*2+1]-at(u,t),eps=.003,slope=(at(u,Math.min(1,t+eps))-at(u,Math.max(0,t-eps)))/(Math.max(.0001,Math.min(1,t+eps)-Math.max(0,t-eps))*b.length);extent=Math.max(extent,Math.abs(dy)/Math.sqrt(1+slope*slope)+2);}return {extent,...box,matte,limit,protection,paint,controls,fillColor,clean,lash,repair,source:pixels,donor,coords,canvas:c};
}
function record(a,data=a.matte){return {rect:[...a.rect],width:a.width,height:a.height,data:encode(data)};}
root.Stillwave.EyeTextures={make,record,decode,raster,validRecord,validDonor,inward};
})(window);



