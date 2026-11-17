const {chromium}=require('../test-tools/node_modules/playwright');
const {MotionMesh}=require('./engine.js');
const assert=require('node:assert/strict'),path=require('path'),fs=require('fs');
const maskHashes=page=>page.evaluate(()=>[...editor.state.regions.map(r=>r.mask),editor.state.anchors].map(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let hash=2166136261;for(let i=3;i<d.length;i+=4)hash=Math.imul(hash^d[i],16777619);return hash>>>0;}));
async function run(){
 const browserPath=process.env.STILLWAVE_TEST_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe';
 const browser=await chromium.launch({executablePath:browserPath,headless:true,downloadsPath:path.join(__dirname,'test-output'),args:[]});
 const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto('file:///'+path.join(__dirname,'index.html').replaceAll('\\','/'));await page.click('#demo');await page.waitForFunction(()=>window.editor?.state.regions.length===2);
 await page.waitForTimeout(900);await page.click('#play');
 const init=await page.evaluate(()=>({w:editor.state.image.width,h:editor.state.image.height,vertices:editor.state.mesh.count,fps:document.querySelector('#performance').textContent,regions:editor.state.regions.length}));
 assert.equal(init.w,720);assert.equal(init.h,956);
 const deformation=await page.evaluate(()=>{const e=editor,s=e.state;s.playing=false;e.renderAt(.7);const m=s.mesh;let moving=0,pinned=0,rest=0;for(let i=0;i<m.count;i++){const d=Math.hypot(m.positions[2*i]-m.rest[2*i],m.positions[2*i+1]-m.rest[2*i+1]);if(d>.1)moving++;if(m.protection[i]>.999){pinned++;if(d>1e-5)throw Error('Anchor drift');}if(d===0)rest++;}const a=Array.from(m.positions);e.renderAt(1.7);const differs=a.some((v,i)=>Math.abs(v-m.positions[i])>.1);return {moving,pinned,rest,differs,guard:m.guard};});
 assert.ok(deformation.moving>100);assert.ok(deformation.pinned>0);assert.ok(deformation.rest>100);assert.ok(deformation.differs);
 fs.writeFileSync(path.join(__dirname,'demo.stillwave'),JSON.stringify(await page.evaluate(()=>editor.projectData())));
 // Actual pointer painting at a source-space point, including undo / redo.
 await page.click('#add');const p=await page.evaluate(()=>{const v=editor.state.view,b=document.querySelector('#overlay').getBoundingClientRect();return {x:b.left+v.x+editor.state.mesh.width*.25*v.zoom,y:b.top+v.y+editor.state.mesh.height*.48*v.zoom};});
 const getSum=()=>page.evaluate(()=>{let r=editor.state.regions[2],d=r.mask.getContext('2d').getImageData(0,0,r.mask.width,r.mask.height).data,sum=0;for(let i=3;i<d.length;i+=4)sum+=d[i];return sum;});
 assert.equal(await getSum(),0);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+40,p.y+30,{steps:10});await page.mouse.up();const painted=await getSum();assert.ok(painted>0);await page.click('#undo');assert.equal(await getSum(),0);await page.click('#redo');assert.equal(await getSum(),painted);
 await page.click('[data-tool="erase"]');await page.mouse.move(p.x+20,p.y+15);await page.mouse.down();await page.mouse.up();assert.ok(await getSum()<painted);
 await page.fill('#regionName','Accessory');await page.evaluate(()=>workspace.motionSubtab('animate'));await page.selectOption('#preset','bounce');
 // Download and reload via the visible file picker input.
 const before=await page.evaluate(()=>editor.projectData()),beforeHashes=await maskHashes(page);const downloadPromise=page.waitForEvent('download');await page.click('#save');const download=await downloadPromise;await download.saveAs(path.join(__dirname,'test-output/roundtrip.stillwave'));
 await page.setInputFiles('#projectFile',path.join(__dirname,'test-output/roundtrip.stillwave'));await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Project restored'));
 const after=await page.evaluate(()=>editor.projectData());assert.deepEqual(await maskHashes(page),beforeHashes);assert.deepEqual({...after,anchors:'',regions:after.regions.map(r=>({...r,mask:''}))},{...before,anchors:'',regions:before.regions.map(r=>({...r,mask:''}))});
 await page.click('#reset');await page.waitForTimeout(50);assert.ok(await page.evaluate(()=>editor.state.mesh.positions.every((v,i)=>v===editor.state.mesh.rest[i])));
 await page.click('#showMask');await page.screenshot({path:path.join(__dirname,'test-output/editor.png')});
 await page.evaluate(()=>{editor.state.playing=false;editor.renderAt(.7)});const pixels=await page.evaluate(()=>{const c=document.querySelector('#render'),gl=c.getContext('webgl'),d=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,d);let count=0;for(let i=3;i<d.length;i+=4)if(d[i])count++;return count;});assert.ok(pixels>100000);
 // Import the demo as an ordinary JPG (without demo-specific setup).
 await page.setInputFiles('#imageFile',path.join(__dirname,'demo.jpg'));await page.waitForFunction(()=>editor.state.name==='demo.jpg');assert.equal(await page.evaluate(()=>editor.state.regions.length),1);
 const originalZoom=await page.evaluate(()=>editor.state.view.zoom);await page.click('#zoomIn');assert.ok(await page.evaluate(()=>editor.state.view.zoom)>originalZoom);
 await page.evaluate(()=>workspace.motionSubtab('paint'));await page.click('[data-tool="pan"]');const stage=await page.locator('#stage').boundingBox();const oldX=await page.evaluate(()=>editor.state.view.x);await page.mouse.move(stage.x+200,stage.y+200);await page.mouse.down();await page.mouse.move(stage.x+245,stage.y+230);await page.mouse.up();assert.ok(Math.abs(await page.evaluate(()=>editor.state.view.x)-oldX-45)<1);await page.click('#fit');
 // Paint and remove anchors through the same pointer route used by the user.
 await page.click('[data-tool="anchor"]');const anchorP=await page.evaluate(()=>{const v=editor.state.view,b=document.querySelector('#overlay').getBoundingClientRect();return {x:b.left+v.x+editor.state.mesh.width*.5*v.zoom,y:b.top+v.y+editor.state.mesh.height*.5*v.zoom};});await page.mouse.move(anchorP.x,anchorP.y);await page.mouse.down();await page.mouse.up();assert.ok(await page.evaluate(()=>Math.max(...editor.state.mesh.protection))>.9);await page.click('#clearAnchors');assert.equal(await page.evaluate(()=>Math.max(...editor.state.mesh.protection)),0);
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=editor.state.image.width;c.height=editor.state.image.height;const g=c.getContext('2d');g.drawImage(editor.state.image,0,0);g.clearRect(0,0,200,c.height);return c.toDataURL('image/png');});fs.writeFileSync(path.join(__dirname,'test-output/transparent.png'),Buffer.from(png.split(',')[1],'base64'));await page.setInputFiles('#imageFile',path.join(__dirname,'test-output/transparent.png'));await page.waitForFunction(()=>editor.state.name==='transparent.png');
 const transparentPixels=await page.evaluate(()=>{editor.renderAt(0);const c=document.querySelector('#render'),gl=c.getContext('webgl'),v=editor.state.view,d=new Uint8Array(4);const x=Math.round((v.x+100*v.zoom)*c.width/v.width),y=Math.round((v.height-v.y-300*v.zoom)*c.height/v.height);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,d);return Array.from(d);});assert.equal(transparentPixels[3],0);
 // Invalid projects are rejected without replacing an existing project.
 await page.evaluate(async()=>{try{await editor.loadProject(new File([JSON.stringify({format:'stillwave',version:9})],'bad.stillwave'));throw Error('Accepted corrupt file');}catch(e){if(!e.message.includes('Unsupported'))throw e;}});assert.equal(await page.evaluate(()=>editor.state.name),'transparent.png');
 assert.deepEqual(errors,[]);const results={initial:init,deformation,paintUndoRedo:true,erase:true,anchorPaintAndClear:true,zoomPan:true,resetRestPose:true,projectRoundTrip:'identical settings, source image, and mask/anchor alpha hashes',renderedPixels:pixels,imageImport:true,transparentPngImport:true,transparentPixels,invalidProjectPreservesState:true,pageErrors:errors};console.log(JSON.stringify(results,null,2));
 await browser.close();
 // Every preset, extreme masks and phase combinations: positive triangle area.
 const m=new MotionMesh(720,956);const weights=new Float32Array(m.count);for(let i=0;i<m.count;i++){const x=m.rest[i*2],y=m.rest[i*2+1];weights[i]=x>210&&x<500&&y>200&&y<700?1:0;}
 let minArea=Infinity;for(const preset of ['sway','bounce','breathing','oscillate'])for(let t=0;t<3;t+=.13){m.deform([{weights,cx:360,cy:460,preset,direction:37,amplitude:50,speed:1.3,phase:80,enabled:true}],t);for(let i=0;i<m.indices.length;i+=3){const [a,b,c]=m.indices.slice(i,i+3),p=m.positions;const area=(p[b*2]-p[a*2])*(p[c*2+1]-p[a*2+1])-(p[b*2+1]-p[a*2+1])*(p[c*2]-p[a*2]);minArea=Math.min(minArea,area);assert.ok(area>0,'Triangle inversion');}}
 console.log('All 4 presets: no folded triangles. Minimum signed double-area:',minArea);
 results.meshStress={presets:4,amplitude:50,minimumSignedDoubleArea:minArea,triangleInversions:0};fs.writeFileSync(path.join(__dirname,'test-output/validation.json'),JSON.stringify(results,null,2));
}
fs.mkdirSync(path.join(__dirname,'test-output'),{recursive:true});run().catch(e=>{console.error(e);process.exit(1)});





