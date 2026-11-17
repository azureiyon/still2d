(function(root){
'use strict';
const targets={lashes:['lashMatte','matte'],area:['repairLimit','limit'],protect:['protectMask','protection'],repair:['repairPaint','paint']};
class EyeEditor{
 constructor(api){
  this.api=api;this.s=api.state;this.g=root.Stillwave.EyeGeometry;this.$=id=>document.getElementById(id);this.mode='curves';this.target='lashes';this.curve='upper';this.drag=null;this.placing=false;const $=this.$;
  $('placeEye').onclick=()=>this.edit(true);$('editEye').onclick=()=>this.edit(false);$('focusEye').onclick=()=>this.focus();
  $('addEye').onclick=()=>{if(!this.s.mesh||this.s.eyes.length>=2)return;this.edit(true);this.adding=true;api.status('Drag the second eye’s own corners. Its shape and masks start fresh; nothing is mirrored.');};
  $('eyeSelect').onchange=()=>{api.captureBlinkPose();this.finishEdits();this.adding=false;this.placing=false;this.s.selectedEye=Number($('eyeSelect').value);this.selectedHandle=null;api.pauseForEdit();this.refresh();};
  $('eyePreview').onchange=()=>{this.finishEdits();this.s.eyePreview=$('eyePreview').value;this.refresh();};
  $('autoBlink').onchange=()=>this.change(()=>{api.captureBlinkPose();this.s.blinkTiming.enabled=$('autoBlink').checked;this.s.time=0;});
  $('removeEye').onclick=()=>this.change(()=>{this.s.eye=null;});
  $('eyeCurve').value='upper';$('eyeCurve').onchange=()=>{this.finishEdits();this.curve=$('eyeCurve').value;this.selectedHandle=null;window.studio?.refresh();};
  $('eyePaintTarget').onchange=()=>{this.finishEdits();this.target=$('eyePaintTarget').value;if(this.mode==='add'||this.mode==='erase')this.setMode(this.mode);};
  $('eyeAction').onchange=()=>this.setMode($('eyeAction').value);
  $('resetEyeTarget').onclick=()=>{this.change(()=>delete this.s.eye[targets[this.target][0]]);this.setMode('add');};
  $('clearEyeTarget').onclick=()=>{this.change(()=>{const a=this.api.getBlink().ensureAssets(this.s.eye),data=a[targets[this.target][1]];data.fill(0);this.s.eye[targets[this.target][0]]=root.Stillwave.EyeTextures.record(a,data);});this.setMode('add');};
  $('autoLashes').onclick=()=>{this.target='lashes';$('eyePaintTarget').value='lashes';this.change(()=>delete this.s.eye.lashMatte);this.setMode('add');};
  $('lidMotion').onchange=()=>{if(!this.s.eye)return;const candidate={...this.s.eye,lidMotion:$('lidMotion').value};if(!this.g.validate(candidate,this.s.mesh.width,this.s.mesh.height)){this.refresh();api.status('The saved legacy seam no longer fits these lids. Undo lid edits before restoring legacy motion.');return;}this.change(()=>{this.s.eye.lidMotion=candidate.lidMotion;this.s.eye.lowerLidLift??=0;});};
  $('repairMode').onchange=()=>this.change(()=>{this.s.eye.repairMode=$('repairMode').value;});
  $('eyeGuides').onchange=()=>this.change(()=>{this.s.eye.showGuides=$('eyeGuides').checked;});
  for(const b of document.querySelectorAll('[data-closure]'))b.onclick=()=>this.setClosure(Number(b.dataset.closure));
  const scales={eyeClosure:['closure',.01],lowerLidLift:['lowerLidLift',.01],creaseMove:['creaseMove',.01],creaseBand:['creaseBand',1],lashRoll:['lashRoll',1],lashWidth:['lashWidth',1],repairMargin:['repairMargin',1],repairFeather:['repairFeather',1],blinkDuration:['duration',1],blinkInterval:['interval',1]};
  for(const [id,[key,scale]]of Object.entries(scales)){
   const input=$(id),begin=()=>{if(this.s.eye&&!this.parameter)this.parameter=api.history();};
   input.addEventListener('pointerdown',begin);input.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key))begin();});
   input.oninput=()=>{if(!this.s.eye)return;begin();const value=Number(input.value)*scale;if(id==='blinkDuration'||id==='blinkInterval')this.s.blinkTiming[key]=value;else if(key==='closure')api.manualClosure(value);else this.s.eye[key]=key==='lashRoll'?160*(Number(input.value)/100)**2:value;if(key==='creaseMove')this.s.eye.crease??=[...this.g.curvePair(this.s.eye,'crease')];this.s.playing=false;this.s.time=0;api.playbackUI();$('original').checked=false;this.refresh();api.markDirty();};
   for(const event of ['pointerup','keyup','change','blur'])input.addEventListener(event,()=>this.commitParameter());
  }
  for(const [event,handler]of [['pointerdown',e=>this.down(e)],['pointermove',e=>this.move(e)],['pointerup',e=>this.up(e)],['pointercancel',()=>this.cancel()],['lostpointercapture',()=>{if(this.drag)this.cancel();}]])api.overlay.addEventListener(event,handler,true);
  api.overlay.addEventListener('keydown',e=>{if(!this.selectedHandle||!this.s.eye||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||e.ctrlKey||e.metaKey)return;e.preventDefault();if(!this.nudge)this.nudge=api.history();const h=this.g.handles(this.s.eye,this.s.mesh.width,this.s.mesh.height).find(h=>h.key===this.selectedHandle.key&&h.index===this.selectedHandle.index);if(!h){this.selectedHandle=null;return;}const step=e.shiftKey?5:1,p={x:h.x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),y:h.y+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0)},next=this.g.moveHandle(this.s.eye,h,p,this.s.mesh.width,this.s.mesh.height);if(next){this.s.eye=next;api.markDirty();}});
  api.overlay.addEventListener('keyup',()=>{if(this.nudge){api.commitEyeEdit(this.nudge);this.nudge=null;}});
  window.addEventListener('blur',()=>this.cancel());this.refresh();
 }
 change(fn){if(!this.s.eye)return;this.finishEdits();const before=this.api.history();fn();this.api.commitEyeEdit(before);this.refresh();}
 commitParameter(){if(this.parameter){this.api.commitEyeEdit(this.parameter);this.parameter=null;}}
 finishEdits(){if(this.drag)this.up();this.commitParameter();if(this.nudge){this.api.commitEyeEdit(this.nudge);this.nudge=null;}}
 refresh(){
  const $=this.$,e=this.s.eye;
  const count=this.s.eyes.length;if(this.eyeCount!==count){$('eyeSelect').replaceChildren(...this.s.eyes.map((_,i)=>{const option=document.createElement('option');option.value=i;option.textContent='Eye '+(i+1);return option;}));this.eyeCount=count;}$('eyeSelect').value=this.s.selectedEye;$('eyeSelect').disabled=count<2;$('addEye').disabled=!this.s.mesh||count<1||count>=2;$('addEye').textContent='Add second eye';$('placeEye').textContent=e?'Replace eye':'Place eye';$('removeEye').textContent='Remove selected eye';$('eyePreview').value=this.s.eyePreview;
  for(const id of ['autoBlink','blinkDuration','blinkInterval'])$(id).disabled=!e;$('autoBlink').checked=this.s.blinkTiming.enabled;$('blinkDuration').value=this.s.blinkTiming.duration;$('blinkDurationValue').textContent=this.s.blinkTiming.duration.toFixed(2)+' s';$('blinkInterval').value=this.s.blinkTiming.interval;$('blinkIntervalValue').textContent=this.s.blinkTiming.interval.toFixed(1)+' s';
  for(const id of ['editEye','focusEye','removeEye','eyeClosure','lashWidth','eyeCurve','eyeGuides','eyeAction','autoLashes','lashRoll','repairMargin','lidMotion','lowerLidLift','eyePaintTarget','resetEyeTarget','clearEyeTarget','repairMode','repairFeather','creaseMove','creaseBand'])$(id).disabled=!e;
  for(const b of document.querySelectorAll('[data-closure]'))b.disabled=!e;
  for(const [id,key,factor,def,suffix]of [['eyeClosure','closure',100,0,'%'],['lashWidth','lashWidth',1,2,' px'],['lashRoll','lashRoll',1/1.6,135,'%'],['repairMargin','repairMargin',1,4,' px'],['repairFeather','repairFeather',1,0,' px'],['creaseMove','creaseMove',100,0,'%'],['creaseBand','creaseBand',1,8,' px']]){const value=id==='lashRoll'?100*Math.sqrt((e?.[key]??def)/160):(e?.[key]??def)*factor;$(id).value=value;$(id+'Value').textContent=(id==='lashWidth'?value.toFixed(1):Math.round(value*10)/10)+suffix;}
  $('eyeGuides').checked=e?.showGuides??true;$('eyeState').textContent=e?'Eye '+(this.s.selectedEye+1)+' of '+count+' · original lash texture':'No eye placed';$('repairMode').value=e?.repairMode??'texture';
  const upper=e&&this.g.lidMotion(e)==='upper-led';$('lidMotion').value=e?this.g.lidMotion(e):'upper-led';$('lowerLidLift').disabled=!upper;const lift=Math.round((e?.lowerLidLift??0)*100);$('lowerLidLift').value=lift;$('lowerLidLiftValue').textContent=lift?lift+'% of eye height':'0% · stationary';$('eyeClosureLabel').textContent=count>1&&this.s.eyePreview==='both'?'Closure · both eyes':upper?'Upper lid closure':'Closure';$('eyeCurve').querySelector('[value="closed"]').disabled=!!upper;if(upper&&this.curve==='closed'){this.curve='upper';$('eyeCurve').value='upper';}
 }
 setMode(mode){
  if(!this.s.eye)return;this.finishEdits();this.mode=mode;this.placing=false;this.s.eye.closure=this.target==='repair'&&(mode==='add'||mode==='erase')?1:0;this.s.eye.showGuides=true;this.api.pauseForEdit();this.s.display.visible=false;this.$('showMask').checked=false;this.api.setTool('eye');this.$('eyeAction').value=mode;this.refresh();if(mode==='donor'||mode==='pick')this.api.fit();
  this.api.status(mode==='donor'?'Drag a rectangle on clean source skin.':mode==='pick'?'Click original skin to pick the touch-up color.':mode==='curves'?'Drag curve handles; the round middle handle shapes the lid. Arrow keys nudge the selected handle.':this.target==='area'?'Blue is the allowed blink area. Erase hair and linework outside it; keep the entire eye opening inside.':this.target==='protect'?'Hatched pixels stay original. Protect hair and linework; leave the iris unprotected.':this.target==='repair'?'Paint skin touch-ups beneath the moving lashes. Erase reveals the reconstruction.':'Select only original lashes; exclude hair, iris and the crease.');
 }
 edit(place){if(!this.s.mesh)return;this.finishEdits();this.adding=false;this.mode='curves';this.$('eyeAction').value='curves';this.placing=place||!this.s.eye;this.api.pauseForEdit();this.s.display.visible=false;this.$('showMask').checked=false;this.api.setTool('eye');if(this.s.eye)this.s.eye.showGuides=true;this.refresh();this.api.status(this.placing?'Drag between the left and right eye corners.':'Edit upper lash and crease separately. The upper lash lands on the lower curve.');}
 setClosure(percent){if(!this.s.eye)return;this.change(()=>{this.api.manualClosure(percent/100);});this.s.time=0;this.s.playing=false;this.$('original').checked=false;this.api.playbackUI();}
 focus(){if(!this.s.eye)return;const m=this.s.mesh,b=this.g.basis(this.s.eye,m.width,m.height),v=this.s.view,hs=this.g.handles(this.s.eye,m.width,m.height),x0=Math.min(...hs.map(h=>h.x)),x1=Math.max(...hs.map(h=>h.x)),y0=Math.min(...hs.map(h=>h.y)),y1=Math.max(...hs.map(h=>h.y));v.zoom=Math.min(12,(v.width-60)/(x1-x0+b.length*.2),(v.height-60)/(y1-y0+b.length*.2));v.x=v.width/2-(x0+x1)/2*v.zoom;v.y=v.height/2-(y0+y1)/2*v.zoom;this.api.zoomLabel();}
 position(e){return this.api.toImage(this.api.mouse(e));}
 down(e){
  if(this.s.tool!=='eye'||this.s.space||e.button!==0||!this.s.mesh)return;e.preventDefault();e.stopImmediatePropagation();this.api.overlay.focus({preventScroll:true});this.commitParameter();const p=this.position(e),m=this.s.mesh;this.cursor=p;
  if((this.placing||!this.s.eye||['donor','pick'].includes(this.mode))&&(p.x<0||p.y<0||p.x>m.width||p.y>m.height))return;
  const before=this.api.history();
  if(this.placing||!this.s.eye)this.drag={kind:'place',start:p,last:p,before};
  else if(this.mode==='donor')this.drag={kind:'donor',start:p,last:p,before};
  else if(this.mode==='pick'){const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.drawImage(this.s.image,Math.floor(p.x),Math.floor(p.y),1,1,0,0,1,1);const pixel=ctx.getImageData(0,0,1,1).data;if(pixel[3]){this.s.eye.repairColor=Array.from(pixel.slice(0,3));this.api.commitEyeEdit(before);this.api.status('Touch-up color picked from the original. Choose Paint selected target to use it.');}return;}
  else if(this.mode==='add'||this.mode==='erase'){this.drag={kind:'matte',last:p,before,assets:this.api.getBlink().ensureAssets(this.s.eye)};this.stamp(p);}
  else{const handles=this.g.handles(this.s.eye,m.width,m.height).filter(h=>h.key==='corner'||h.key===this.curve).sort((a,b)=>(Math.hypot(p.x-a.x,p.y-a.y)+(a.key==='corner'&&this.s.eye.paths?.[this.curve]?3/this.s.view.zoom:0))-(Math.hypot(p.x-b.x,p.y-b.y)+(b.key==='corner'&&this.s.eye.paths?.[this.curve]?3/this.s.view.zoom:0))),h=handles.find(h=>Math.hypot(p.x-h.x,p.y-h.y)*this.s.view.zoom<12);if(!h)return;this.selectedHandle=h;this.drag={kind:'handle',handle:h,before};}
  this.s.playing=false;this.s.time=0;this.api.playbackUI();this.api.overlay.setPointerCapture(e.pointerId);
 }
 move(e){this.cursor=this.position(e);if(!this.drag)return;e.preventDefault();e.stopImmediatePropagation();const p=this.cursor,m=this.s.mesh;
  if(this.drag.kind==='place'||this.drag.kind==='donor'){this.drag.last={x:Math.max(0,Math.min(m.width,p.x)),y:Math.max(0,Math.min(m.height,p.y))};return;}
  if(this.drag.kind==='matte'){const last=this.drag.last,n=Math.max(1,Math.ceil(Math.hypot(p.x-last.x,p.y-last.y)/Math.max(.5,Number(this.$('eyeBrush').value)*.15)));for(let i=1;i<=n;i++)this.stamp({x:last.x+(p.x-last.x)*i/n,y:last.y+(p.y-last.y)*i/n});this.drag.last=p;return;}
  const next=this.g.moveHandle(this.s.eye,this.drag.handle,p,m.width,m.height);if(next){this.s.eye=next;this.refresh();this.api.markDirty();}else this.api.status('Keep support curves outside the eyelids and the lower lid below the upper lash.');
 }
 stamp(p){const a=this.drag.assets,r=Number(this.$('eyeBrush').value)/2,sx=a.rect[2]/a.width,sy=a.rect[3]/a.height,cx=(p.x-a.rect[0])/sx,cy=(p.y-a.rect[1])/sy,data=a[targets[this.target][1]],color=this.s.eye.repairColor||a.fillColor;
  for(let y=Math.max(0,Math.floor(cy-r/sy));y<Math.min(a.height,Math.ceil(cy+r/sy));y++)for(let x=Math.max(0,Math.floor(cx-r/sx));x<Math.min(a.width,Math.ceil(cx+r/sx));x++){const d=Math.hypot((x+.5-cx)*sx,(y+.5-cy)*sy)/r;if(d>=1)continue;const strength=Math.min(1,(1-d)*8),i=y*a.width+x;if(this.target==='repair'){const old=data[i*4+3]/255,alpha=this.mode==='erase'?old*(1-strength):old+(1-old)*strength;if(this.mode!=='erase'&&alpha>0)for(let k=0;k<3;k++)data[i*4+k]=Math.round((color[k]*strength+data[i*4+k]*old*(1-strength))/alpha);data[i*4+3]=Math.round(alpha*255);}else data[i]=Math.round(this.mode==='erase'?data[i]*(1-strength):data[i]+(255-data[i])*strength);}
  this.previewRev=(this.previewRev||0)+1;
 }
 up(e){if(!this.drag)return;e?.stopImmediatePropagation();const d=this.drag;this.drag=null;
  if(d.kind==='place'){const next=this.g.createEye(d.start,d.last,this.s.mesh.width,this.s.mesh.height);if(this.g.validate(next,this.s.mesh.width,this.s.mesh.height)){const first=!this.s.eyes.length;if(this.adding){this.s.eyes.push(next);this.s.selectedEye=this.s.eyes.length-1;}else this.s.eye=next;if(first||this.adding)this.s.blinkTiming.enabled=true;this.adding=false;this.placing=false;this.mode='curves';this.$('eyeAction').value='curves';}else{this.api.status('Drag between corners at least 8 original pixels apart.');return;}}
  else if(d.kind==='matte')this.s.eye[targets[this.target][0]]=root.Stillwave.EyeTextures.record(d.assets,d.assets[targets[this.target][1]]);
  else if(d.kind==='donor'){const a=d.start,b=d.last,r={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)};if(r.width<4||r.height<4)return;this.s.eye.skinDonor=r;}
  this.api.commitEyeEdit(d.before);this.refresh();
 }
 cancel(){if(this.drag?.before){this.s.eye=this.drag.before.eye;const blink=this.api.getBlink?.();if(blink){blink.assetKey='';blink.cache='';}}this.drag=null;this.commitParameter();this.refresh();}
 draw(ctx){
  if(this.s.tool!=='eye'||this.s.playing)return;const {mesh:m,eye,view:v}=this.s;if(!m)return;
  if(this.drag?.kind==='place'){ctx.beginPath();ctx.moveTo(this.drag.start.x,this.drag.start.y);ctx.lineTo(this.drag.last.x,this.drag.last.y);ctx.strokeStyle='#fff';ctx.lineWidth=2/v.zoom;ctx.stroke();return;}if(!eye||!eye.showGuides)return;
  if(this.mode==='donor'){const r=this.drag?.kind==='donor'?{x:Math.min(this.drag.start.x,this.drag.last.x),y:Math.min(this.drag.start.y,this.drag.last.y),width:Math.abs(this.drag.start.x-this.drag.last.x),height:Math.abs(this.drag.start.y-this.drag.last.y)}:eye.skinDonor;if(r){ctx.strokeStyle='#ffdf6b';ctx.lineWidth=2/v.zoom;ctx.strokeRect(r.x,r.y,r.width,r.height);}return;}
  if(this.mode==='add'||this.mode==='erase'){
   const a=this.drag?.assets||this.api.getBlink().ensureAssets(eye),key=(this.previewRev||0)+this.target;
   if(this.previewAsset!==a||this.previewKey!==key){this.previewCanvas??=document.createElement('canvas');this.previewCanvas.width=a.width;this.previewCanvas.height=a.height;const pixels=new Uint8ClampedArray(a.width*a.height*4),data=a[targets[this.target][1]];
    for(let i=0;i<a.width*a.height;i++){const paint=this.target==='repair',color=paint?Array.from(data.slice(i*4,i*4+3)):this.target==='protect'?[255,170,70]:this.target==='area'?[70,200,255]:[255,0,210];for(let k=0;k<3;k++)pixels[i*4+k]=color[k];pixels[i*4+3]=Math.round((paint?data[i*4+3]:data[i])*.5);if(this.target==='protect'&&(Math.floor(i/a.width)+i%a.width)%9<2){pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=255;}}
    this.previewCanvas.getContext('2d').putImageData(new ImageData(pixels,a.width,a.height),0,0);this.previewAsset=a;this.previewKey=key;
   }ctx.drawImage(this.previewCanvas,...a.rect);if(this.cursor){ctx.beginPath();ctx.arc(this.cursor.x,this.cursor.y,Number(this.$('eyeBrush').value)/2,0,Math.PI*2);ctx.strokeStyle='#fff';ctx.lineWidth=1/v.zoom;ctx.stroke();}return;
  }
  if(this.mode==='pick')return;
  const upper=this.g.lidMotion(eye)==='upper-led';
  for(const key of [...this.g.curves,'crease']){if(upper&&key==='closed')continue;if(key==='crease'&&!eye.creaseMove&&this.curve!=='crease')continue;ctx.beginPath();for(let i=0;i<=60;i++){const p=this.g.point(eye,key,i/60,m.width,m.height);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);}ctx.strokeStyle='#0009';ctx.lineWidth=4/v.zoom;ctx.stroke();ctx.strokeStyle=this.g.curveColors[key];ctx.lineWidth=(key===this.curve?2:1)/v.zoom;ctx.setLineDash(key.startsWith('support')?[4/v.zoom,3/v.zoom]:[]);ctx.stroke();ctx.setLineDash([]);}
  if(upper&&eye.closure>0){const b=this.g.basis(eye,m.width,m.height);ctx.beginPath();for(let i=0;i<=60;i++){const t=i/60,y=this.g.lids(eye,t).upper*b.length,x=b.a.x+b.ux*t*b.length+b.nx*y,py=b.a.y+b.uy*t*b.length+b.ny*y;i?ctx.lineTo(x,py):ctx.moveTo(x,py);}ctx.strokeStyle='#ff8bd5';ctx.lineWidth=1.5/v.zoom;ctx.setLineDash([3/v.zoom,3/v.zoom]);ctx.stroke();ctx.setLineDash([]);}
  const hs=this.g.handles(eye,m.width,m.height).filter(h=>h.key==='corner'||h.key===this.curve);for(const h of hs){ctx.fillStyle=h.key==='corner'?'#fff':this.g.curveColors[h.key];ctx.strokeStyle='#111';ctx.lineWidth=1.5/v.zoom;ctx.beginPath();if(h.key==='corner'||h.bend||h.type==='node')ctx.arc(h.x,h.y,(h.bend?6:5)/v.zoom,0,Math.PI*2);else ctx.rect(h.x-5/v.zoom,h.y-5/v.zoom,10/v.zoom,10/v.zoom);ctx.fill();ctx.stroke();if(this.selectedHandle?.key===h.key&&this.selectedHandle?.index===h.index){ctx.beginPath();ctx.arc(h.x,h.y,8/v.zoom,0,Math.PI*2);ctx.strokeStyle='#fff';ctx.stroke();}}
 }
}
root.Stillwave.EyeEditor=EyeEditor;
})(window);
