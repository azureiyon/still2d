const {chromium}=require('../test-tools/node_modules/playwright');
const assert=require('node:assert/strict'),path=require('path'),fs=require('fs');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.STILLWAVE_TEST_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,downloadsPath:path.join(__dirname,'test-output')});
 try{const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto('file:///'+path.join(__dirname,'index.html').replaceAll('\\','/'));await page.click('#demo');await page.waitForFunction(()=>editor.state.regions.length===2);await page.click('#reset');
 const fingerprint=()=>page.evaluate(()=>{editor.renderAt(.83);const s=editor.state,c=document.querySelector('#render');return {image:s.source,mask:s.regions.map(r=>r.mask.toDataURL()),anchors:s.anchors.toDataURL(),positions:Array.from(s.mesh.positions),pixels:c.toDataURL()};});
 const before=await fingerprint();
 await page.click('[data-color="#00e5ff"]');await page.locator('#overlayOpacity').fill('82');await page.locator('#selectedOnly').uncheck();await page.locator('#maskOutline').uncheck();await page.locator('#overlayColor').fill('#ff2100');
 assert.deepEqual(await fingerprint(),before,'Display controls must not touch source, masks, vertices, or rendered artwork');
 assert.equal(await page.evaluate(()=>editor.state.regions[0].color),'#ff2100');assert.equal(await page.evaluate(()=>editor.state.regions[1].color),'#00e5ff');
 const capture=async()=>{await page.waitForTimeout(60);return page.locator('#overlay').screenshot();};const all=await capture();await page.locator('#selectedOnly').check();assert.notDeepEqual(await capture(),all,'Selected-only must hide other region');const noOutline=await capture();await page.locator('#maskOutline').check();assert.notDeepEqual(await capture(),noOutline,'Outline must visibly affect overlay');
 await page.locator('#selectedOnly').uncheck();await page.locator('#maskOutline').uncheck();await page.locator('#showMask').uncheck();
 const beforeSave=await page.evaluate(()=>editor.projectData());const promise=page.waitForEvent('download');await page.click('#save');const download=await promise;const saved=path.join(__dirname,'test-output/display-roundtrip.stillwave');await download.saveAs(saved);await page.setInputFiles('#projectFile',saved);await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Project restored'));
 assert.deepEqual(await page.evaluate(()=>editor.state.display),beforeSave.display);assert.deepEqual(await page.evaluate(()=>editor.state.regions.map(r=>r.color)),beforeSave.regions.map(r=>r.color));assert.equal(await page.locator('#overlayOpacity').inputValue(),'82');
 // A real pre-change version-1 project, with no display field.
 await page.setInputFiles('#projectFile',path.join(__dirname,'reference-study/legacy-demo.stillwave'));await page.waitForFunction(()=>editor.state.display.opacity===.55);assert.equal(await page.evaluate(()=>editor.state.regions.length),2);
 await page.locator('#selectedOnly').uncheck();await page.click('[data-color="#ff00d4"]');await page.waitForTimeout(100);await page.screenshot({path:path.join(__dirname,'test-output/mask-visibility.png')});
 assert.deepEqual(errors,[]);const result={displayControlsDoNotChangeArtworkMasksOrVertices:true,independentRegionColors:true,selectedOnlyVisuallyVerified:true,outlineVisuallyVerified:true,displayAndColorSaveReopen:true,legacyV1ProjectLoads:true,pageErrors:errors};fs.writeFileSync(path.join(__dirname,'test-output/visibility-validation.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
