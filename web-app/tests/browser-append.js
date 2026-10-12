// Generated test page only: replace discovery with a simulated driver before
// importing the unmodified app. No USB permission or hardware call is made.
import {ScannerRegistry} from './registry.js';
import {FF680W_PROFILE} from './profiles/ff680w.js';
import {ScanStore,imageJob} from './storage.js';
import {DEFAULT_OPTIONS} from './planner.js';
import {WorkerImageProcessor} from './processing/client.js';
const el=id=>document.getElementById(id),store=new ScanStore(),identity={model:'FF-680W',serial:'SYNTHETIC-APPEND-ONLY',firmware:'TEST'};
const setup={...DEFAULT_OPTIONS,mode:'color',duplex:true,dpi:300,max_sheets:1,color_capture:'neutral-v1'};
const canvas=document.createElement('canvas');canvas.width=64;canvas.height=96;
const ctx=canvas.getContext('2d');ctx.fillStyle='#f2ecde';ctx.fillRect(0,0,64,96);ctx.fillStyle='#663ab5';ctx.fillRect(3,7,20,40);
const bytes=new Uint8Array(await (await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.95))).arrayBuffer());
async function seedDocument(){
 const job=await store.createJob(setup,{driverId:FF680W_PROFILE.id,deviceLabel:'Synthetic test scanner',deviceIdentity:identity});
 for(const side of ['front','back'])await store.saveImage(job.id,{filename:'001-'+side+'.jpg',sheet:1,side,image:bytes},job.activeCapture);
 await store.finish(job.id,'complete',undefined,[],job.activeCapture);
 const image=(await store.images(job.id))[0],processor=new WorkerImageProcessor();
 await store.saveEdit(job.id,image.filename,await processor.process(image,{recipe:{version:1,rotation:90,crop:null}}));processor.dispose();return job;
}
let seed=await seedDocument();
let connected=false,planned={sides:['front','back']},calls=0;
const driver={profile:FF680W_PROFILE,transport:'usb',deviceIdentity:identity,
 get connected(){return connected;},capabilities:{resolutions:[50,75,100,150,200,240,300,360,400,600],cropResolutions:[300,600],quality:{min:1,max:100},duplex:true,color:true,gray:true,crop:true,deskew:true,doubleFeed:true},
 validateOptions(options){FF680W_PROFILE.buildScanPlan(options);},async connect(){connected=true;return {};},async settings(){return {};},async reset(){return {};},async disconnect(){connected=false;},
 async scan(options,onImage,signal){calls++;const plan=planned;let images=0;
  for(const side of plan.sides){if(signal.aborted)throw Error('Synthetic capture stopped');await onImage({filename:'001-'+side+'.jpg',sheet:1,side,image:bytes});images++;}
  if(plan.error)throw Error(plan.error);return {sheets:1,images,warnings:[]};
 }};
ScannerRegistry.prototype.chooseDriver=async()=>driver;
await import('./main.js');
let processedSources=0;const nativeProcess=WorkerImageProcessor.prototype.process;WorkerImageProcessor.prototype.process=function(...args){processedSources++;return nativeProcess.apply(this,args);};
const panel=document.createElement('aside');panel.style.cssText='position:fixed;top:6px;left:6px;z-index:1000;background:#202028;color:white;border:1px solid #a89be0;padding:8px;max-width:520px;max-height:280px;overflow:auto;font:12px system-ui';
const run=document.createElement('button');run.textContent='Run add-pages checks';const report=document.createElement('pre');report.id='append-report';report.textContent='Synthetic scanner only. No hardware access.';report.style.whiteSpace='pre-wrap';panel.append(run,report);document.body.append(panel);
let count=0;function assert(condition,label){if(!condition)throw Error(label);report.textContent+='\nPASS '+label;count++;}
async function until(predicate,label){const deadline=performance.now()+12000;while(!await predicate()){if(performance.now()>deadline)throw Error('Timed out: '+label);await new Promise(resolve=>setTimeout(resolve,20));}}
const saved=async()=> (await store.jobs()).find(job=>job.id===seed.id);
async function append(plan){planned=plan;el('append-scan').click();await until(async()=>!(await saved()).activeCapture&&!el('append-scan').disabled,'finish addition');}
run.onclick=async()=>{
 run.disabled=true;report.textContent='Running';count=0;
 try{
  await until(()=>!el('new-job').disabled&&el('page-counter').textContent==='1 / 2','restore original scan');
  const startingJobs=(await store.jobs()).length;const original=await store.images(seed.id),priorEdit=(await store.edits(seed.id))[0];
  assert(!el('append-scan').hidden&&el('append-scan').disabled,'saved scan offers addition while disconnected');
  el('connect').click();await until(()=>!el('append-scan').disabled,'connect simulated driver');
  document.querySelector('.job-add').click();await until(()=>!el('new-job').disabled,'My scans Add pages action');
  assert(el('tab-capture').getAttribute('aria-selected')==='true','My scans prepares capture settings');
  el('auto-process').checked=true;await append({sides:['front','back']});el('auto-process').checked=false;let job=await saved(),images=await store.images(seed.id);assert(processedSources===2,'post-capture processing runs only on the two added pages');
  assert((await store.jobs()).length===startingJobs&&job.images===4,'duplex addition stays in the same saved scan');
  assert(images.map(image=>image.filename).join(',')==='001-front.jpg,001-back.jpg,002-front.jpg,002-back.jpg','added front and back get continued filenames');
  assert(el('page-counter').textContent==='3 / 4','first added page is selected');
  assert((await store.edits(seed.id))[0].recipe.rotation===priorEdit.recipe.rotation,'original rotation edit survives addition');
  el('mode').value='gray';el('dpi').value='200';el('dpi').dispatchEvent(new Event('change'));el('duplex').value='false';
  await append({sides:['front']});images=await store.images(seed.id);job=await saved();
  assert(images.length===5&&images[4].filename==='003-front.jpg','single-sided sheet adds one page');
  assert(imageJob(job,images[0]).options.dpi===300&&imageJob(job,images[4]).options.dpi===200,'old and new page resolutions stay distinct');
  assert(el('detail-dpi').textContent==='200 dpi'&&el('detail-color').textContent==='Grayscale · 8 bit','new page inspector uses its capture settings');
  assert(document.querySelector('.job-text small').textContent.includes('Mixed'),'My scans identifies mixed capture settings');
  document.querySelector('#images button').click();assert(el('detail-dpi').textContent==='300 dpi'&&el('detail-color').textContent==='RGB · 24 bit','old page inspector retains original settings');
  await append({sides:['front'],error:'Synthetic back-transfer interruption'});job=await saved();
  assert(job.status==='failed'&&job.images===6,'partial addition preserves its saved page and earlier pages');
  assert(job.captures.at(-1).images===1&&job.captures.at(-1).error.includes('interruption'),'failed capture remains recorded');
  el('mode').value='color';el('dpi').value='600';el('dpi').dispatchEvent(new Event('change'));el('duplex').value='true';
  await append({sides:['front','back']});images=await store.images(seed.id);job=await saved();
  assert(images.length===8&&images[6].filename==='005-front.jpg'&&images[7].filename==='005-back.jpg','retry starts after the incomplete sheet without overwriting it');
  assert(job.status==='complete'&&job.captures.some(capture=>capture.status==='failed'),'recovery completes and retains failure history');
  let release,entered;const ready=new Promise(resolve=>entered=resolve);
  const held=navigator.locks.request('scan-studio-capture:'+seed.id,async()=>{entered();await new Promise(resolve=>release=resolve);});await ready;
  const priorCalls=calls;el('append-scan').click();await until(()=>!el('new-job').disabled,'reject concurrent capture');release();await held;
  assert(calls===priorCalls&&el('status').textContent.includes('another window'),'concurrent addition is refused before driver acquisition');
  for(const [index,image] of original.entries())assert(new Uint8Array(await images[index].blob.arrayBuffer()).every((value,i)=>value===new Uint8Array(bytes)[i]),'original JPEG '+image.filename+' remains byte-identical');
  assert((await store.edits(seed.id))[0].recipe.rotation===90,'old edit remains after retry and mixed settings');
  assert(job.captures.length===5,'one capture record per batch is saved');
  const reopened=new ScanStore();assert((await reopened.images(seed.id)).length===8&&(await reopened.edits(seed.id))[0].recipe.rotation===90,'pages and edits reopen from persistent storage');
  let exported;const nativeURL=URL.createObjectURL;URL.createObjectURL=function(blob){if(blob.type==='application/zip')exported=blob;return nativeURL.call(URL,blob);};
  el('export').click();await until(()=>exported&&!el('export').disabled,'export continued scan');URL.createObjectURL=nativeURL;
  const archive=new Uint8Array(await exported.arrayBuffer()),view=new DataView(archive.buffer),entries=new Map();let offset=0;
  while(view.getUint32(offset,true)===0x04034b50){const length=view.getUint32(offset+18,true),names=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),name=new TextDecoder().decode(archive.subarray(offset+30,offset+30+names)),start=offset+30+names+extra;entries.set(name,archive.subarray(start,start+length));offset=start+length;}
  const manifest=JSON.parse(new TextDecoder().decode(entries.get('scan-job.json')));assert(manifest.images.length===8&&manifest.captures.length===5,'ZIP manifest contains all pages and capture batches');
  assert(manifest.images[0].capture.options.dpi===300&&manifest.images[4].capture.options.dpi===200&&manifest.images[7].capture.options.dpi===600,'export retains each page capture setting');
  assert(entries.has('001-front.png')&&entries.has('005-back.jpg'),'ZIP includes the old edit and latest addition');
  const previousId=seed.id;el('new-job').click();await until(()=>!el('new-job').disabled,'new workspace');assert(el('append-scan').hidden,'new workspace clears the append target');
  planned={sides:['front','back']};el('scan').click();await until(async()=>(await store.jobs()).length===startingJobs+1&&!el('new-job').disabled,'separate new scan');
  assert((await store.images(previousId)).length===8,'Scan as new document leaves the continued scan intact');
  report.textContent+='\nCOMPLETE '+count+' checks passed';
 }catch(error){report.textContent+='\nFAIL '+error.stack;}
 finally{run.disabled=false;}
};
