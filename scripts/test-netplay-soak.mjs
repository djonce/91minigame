import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});
const measurements=[];
await mkdir('.local/validation', {recursive:true});
const output = '.local/validation/netplay-core-soak.json';
const base = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';
try {
 const pages=[];
 for(let i=0;i<2;i++) {
  const page=await (await browser.newContext()).newPage();
  await page.route('**/core-probe.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="emulator" style="width:256px;height:240px"></div></body></html>'}));
  page.on('pageerror',e=>console.log('ERR',e.message));await page.goto(base + '/core-probe.html');
  await page.evaluate(async()=>{const {NetplayRuntime}=await import('/src/netplay/runtime.ts');const r=new NetplayRuntime();await r.prepare(await(await fetch('/api/games/nes-chise-yaosai')).json(),()=>{});window.testRuntime=r;});pages.push(page);
 }
 const state=await pages[0].evaluate(()=>Array.from(window.testRuntime.capture()));
 for(const page of pages)await page.evaluate(async state=>window.testRuntime.restore(new Uint8Array(state),0),state);
 for(let chunk=0;chunk<120;chunk++) {
  const results=await Promise.all(pages.map(page=>page.evaluate(async chunk=>{
   const r=window.testRuntime,t=performance.now(),before=r.adapter.frame;
   for(let j=0;j<600;j++){const f=chunk*600+j; const start=f===240||f===1200?8:0; await r.step([start||((f%90)<45?129:65),(f%50<25?33:17),0,0]);}
   const bytes=r.capture(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
   return{frame:r.frame,rawBefore:before,rawAfter:r.adapter.frame,hash,ms:performance.now()-t};
  },chunk)));
  measurements.push(results); if(results[0].hash!==results[1].hash)throw Error('desync '+JSON.stringify(results));
  if(chunk%6===5)console.log('Confirmed',results[0].frame,'frames',results[0].hash);
  if(chunk===2){const first=await pages[0].evaluate(()=>window.testRuntime.adapter.frame);await new Promise(r=>setTimeout(r,600));if(await pages[0].evaluate(()=>window.testRuntime.adapter.frame)!==first)throw Error('automatic frames');}
 }
 await writeFile(output,JSON.stringify({pass:true,frames:72000,instances:2,measurements},null,2));
 console.log('PASS 72000 matching frames, two isolated instances, full-state SHA-256 comparison');
} catch(e) {console.error(e);process.exitCode=1;await writeFile(output,JSON.stringify({pass:false,error:String(e),measurements},null,2));}
finally{await browser.close();}
