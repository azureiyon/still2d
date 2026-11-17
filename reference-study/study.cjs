const {chromium}=require('../../test-tools/node_modules/playwright');
const fs=require('fs'),path=require('path');
(async()=>{
 const files=['exportlive2d_export.mov','exportlive2d_export_2.mov','exportlive2d_export_3.mov'];
 const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1500,height:1100}});await page.setContent('<body></body>');
 for(let i=0;i<3;i++){
 let meta=await page.evaluate(async src=>{document.body.innerHTML='';const v=document.createElement('video');v.muted=true;v.src=src;document.body.append(v);await new Promise((ok,no)=>{v.onloadedmetadata=ok;v.onerror=()=>no(Error('video decode failed'))});let d=v.duration;let c=document.createElement('canvas');c.width=1500;c.height=1100;let ctx=c.getContext('2d');ctx.fillStyle='#222';ctx.fillRect(0,0,c.width,c.height);for(let j=0;j<8;j++){v.currentTime=Math.min(d-.05,d*(j+.25)/8);await new Promise(ok=>v.onseeked=ok);let w=375,h=510;ctx.drawImage(v,(j%4)*w,Math.floor(j/4)*550,w,h);ctx.fillStyle='white';ctx.fillText(v.currentTime.toFixed(2)+'s',(j%4)*w+8,Math.floor(j/4)*550+530);}v.remove();document.body.append(c);let still=document.createElement('canvas');still.width=v.videoWidth;still.height=v.videoHeight;still.getContext('2d').drawImage(v,0,0);return {duration:d,width:v.videoWidth,height:v.videoHeight,still:still.toDataURL('image/jpeg',.97)};},'data:video/mp4;base64,'+fs.readFileSync(path.join('C:/Users/ruian/Downloads',files[i])).toString('base64')); 
 if(i===1)fs.writeFileSync(path.join(__dirname,'../demo.jpg'),Buffer.from(meta.still.split(',')[1],'base64'));delete meta.still;console.log(files[i],meta);await page.screenshot({path:path.join(__dirname,`recording-${i+1}.png`)});
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});



