import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {ScanStore} from '../dist/storage.js';
import {DEFAULT_OPTIONS} from '../dist/planner.js';
import {editRevision} from '../dist/processing/history.js';

const jpeg=Uint8Array.of(255,216,1,2,3,255,217);
const capture=(filename='001-front.jpg',overrides={})=>({filename,sheet:1,side:'front',image:Uint8Array.from(jpeg),...overrides});
let sequence=0;
async function withStorage(run){
 const factory=new IDBFactory(),name='store-test-'+sequence++,store=new ScanStore(name),decodes=[];
 let invalid=false,closed=0;
 const saved=new Map(['indexedDB','createImageBitmap'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 Object.defineProperties(globalThis,{
  indexedDB:{configurable:true,value:factory},
  // Node has no native JPEG decoder. This stub isolates persistence tests;
  // decoding failure is covered separately, not inferred from marker bytes.
  createImageBitmap:{configurable:true,value:async blob=>{decodes.push(blob);if(invalid)throw Error('JPEG decoding failed');return {width:2544,height:3300,close(){closed++;}};}},
 });
 try{await run({store,factory,name,decodes,closed:()=>closed,invalid:value=>{invalid=value;}});}
 finally{for(const [key,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
}

test('undo and redo survive reopening storage, branch on a new edit, and preserve original capture bytes',async()=>{
 await withStorage(async({store,name})=>{
  const job=await store.createJob({...DEFAULT_OPTIONS});const original=await store.saveImage(job.id,capture());await store.finish(job.id,'complete');
  const render=recipe=>({recipe,blob:recipe.rotation?new Blob(['edited'],{type:'image/png'}):original.blob,width:recipe.rotation===90||recipe.rotation===270?3300:2544,height:recipe.rotation===90||recipe.rotation===270?2544:3300,notices:[]});
  let saved=await store.saveEdit(job.id,original.filename,render({version:1,rotation:90,crop:null}));
  saved=await store.saveEdit(job.id,original.filename,render({version:1,rotation:180,crop:null}));
  const undo=editRevision(saved,'undo');saved=await store.saveEdit(job.id,original.filename,render(undo.recipe),undo.history,undo.redo);
  assert.equal(saved.recipe.rotation,90);assert.equal(saved.redo.at(-1).rotation,180);
  const reopened=new ScanStore(name);saved=(await reopened.edits(job.id))[0];const redo=editRevision(saved,'redo');
  saved=await reopened.saveEdit(job.id,original.filename,render(redo.recipe),redo.history,redo.redo);
  assert.equal(saved.recipe.rotation,180);assert.equal(saved.redo.length,0);assert.equal(saved.history.at(-1).rotation,90);
  const undoAgain=editRevision(saved,'undo');await reopened.saveEdit(job.id,original.filename,render(undoAgain.recipe),undoAgain.history,undoAgain.redo);
  saved=await reopened.saveEdit(job.id,original.filename,render({version:1,rotation:270,crop:null}));
  assert.equal(editRevision(saved,'redo'),undefined);assert.equal(saved.history.at(-1).rotation,90);
  assert.deepEqual(new Uint8Array(await (await reopened.images(job.id))[0].blob.arrayBuffer()),jpeg);
 });
});

test('invalid redo history cannot overwrite a valid saved edit',async()=>{
 await withStorage(async({store})=>{
  const job=await store.createJob({...DEFAULT_OPTIONS});await store.saveImage(job.id,capture());
  const result={recipe:{version:1,rotation:90,crop:null},blob:new Blob(['png'],{type:'image/png'}),width:3300,height:2544,notices:[]};
  await store.saveEdit(job.id,'001-front.jpg',result);const before=await store.edits(job.id);
  await assert.rejects(store.saveEdit(job.id,'001-front.jpg',result,[],[{version:1,rotation:45,crop:null}]),/Rotation/);
  await assert.rejects(store.saveEdit(job.id,'001-front.jpg',result,[],Array(21).fill(result.recipe)),/20 revisions/);
  assert.deepEqual(await store.edits(job.id),before);
 });
});
async function alterJob(factory,name,id,changes){
 const db=await new Promise((resolve,reject)=>{const request=factory.open(name);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 try{
  await new Promise((resolve,reject)=>{
   const tx=db.transaction('jobs','readwrite'),store=tx.objectStore('jobs'),request=store.get(id);
   request.onsuccess=()=>store.put({...request.result,...changes});
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
 }finally{db.close();}
}

test('job options and saved image bytes are independent snapshots and persist in another store',async()=>{
 await withStorage(async({store,name,closed})=>{
  const options={...DEFAULT_OPTIONS};const job=await store.createJob(options);options.quality=1;
  const captured=capture(),image=await store.saveImage(job.id,captured);captured.image.fill(0);
  assert.equal(closed(),1);assert.equal(image.width,2544);assert.equal(image.height,3300);assert.equal(image.blob.type,'image/jpeg');
  const reopened=new ScanStore(name),jobs=await reopened.jobs(),images=await reopened.images(job.id);
  assert.equal(jobs.length,1);assert.equal(jobs[0].options.quality,90);
  assert.equal(jobs[0].images,1);assert.equal(jobs[0].bytes,jpeg.length);
  assert.equal(images.length,1);assert.deepEqual([...new Uint8Array(await images[0].blob.arrayBuffer())],[...jpeg]);
 });
});

test('duplicate image abort leaves earlier JPEG and job counters unchanged',async()=>{
 await withStorage(async({store})=>{
  const job=await store.createJob({...DEFAULT_OPTIONS});await store.saveImage(job.id,capture());
  const before=await store.jobs();
  await assert.rejects(store.saveImage(job.id,capture('001-front.jpg',{image:Uint8Array.of(255,216,9,255,217)})));
  assert.deepEqual(await store.jobs(),before);
  const images=await store.images(job.id);assert.equal(images.length,1);
  assert.deepEqual([...new Uint8Array(await images[0].blob.arrayBuffer())],[...jpeg]);
 });
});

test('concurrent distinct saves atomically increment both image and byte counts',async()=>{
 await withStorage(async({store})=>{
  const job=await store.createJob({...DEFAULT_OPTIONS,duplex:true});
  await Promise.all([store.saveImage(job.id,capture()),store.saveImage(job.id,capture('001-back.jpg',{side:'back'}))]);
  const current=(await store.jobs())[0];assert.equal(current.images,2);assert.equal(current.bytes,2*jpeg.length);
  assert.deepEqual((await store.images(job.id)).map(image=>image.filename),['001-front.jpg','001-back.jpg']);
  await store.saveImage(job.id,capture('002-back.jpg',{sheet:2,side:'back'}));
  await store.saveImage(job.id,capture('002-front.jpg',{sheet:2}));
  assert.deepEqual((await store.images(job.id)).map(image=>image.filename),['001-front.jpg','001-back.jpg','002-front.jpg','002-back.jpg']);
 });
});

test('concurrent duplicate saves retain exactly one complete image and one metadata increment',async()=>{
 await withStorage(async({store})=>{
  const job=await store.createJob({...DEFAULT_OPTIONS});
  const results=await Promise.allSettled([store.saveImage(job.id,capture()),store.saveImage(job.id,capture())]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.filter(result=>result.status==='rejected').length,1);
  assert.equal((await store.jobs())[0].images,1);assert.equal((await store.jobs())[0].bytes,jpeg.length);
  assert.equal((await store.images(job.id)).length,1);
 });
});

test('JPEG decoding failure occurs before storage append and preserves previous pages',async()=>{
 await withStorage(async({store,invalid,closed})=>{
  const job=await store.createJob({...DEFAULT_OPTIONS});await store.saveImage(job.id,capture());const before=await store.jobs();
  invalid(true);await assert.rejects(store.saveImage(job.id,capture('002-front.jpg',{sheet:2})),/JPEG decoding failed/);
  assert.deepEqual(await store.jobs(),before);assert.equal((await store.images(job.id)).length,1);assert.equal(closed(),1);
 });
});

test('unknown jobs and finished jobs reject saves without orphan images or metadata changes',async()=>{
 await withStorage(async({store})=>{
  await assert.rejects(store.saveImage('missing',capture()));assert.deepEqual(await store.images('missing'),[]);assert.deepEqual(await store.jobs(),[]);
  const job=await store.createJob({...DEFAULT_OPTIONS});await store.saveImage(job.id,capture());await store.finish(job.id,'complete');
  const before=await store.jobs();await assert.rejects(store.saveImage(job.id,capture('002-front.jpg',{sheet:2})));
  assert.deepEqual(await store.jobs(),before);assert.equal((await store.images(job.id)).length,1);
 });
});

test('finishing a failed batch retains previous images and records its error and warnings',async()=>{
 await withStorage(async({store,name})=>{
  const job=await store.createJob({...DEFAULT_OPTIONS});await store.saveImage(job.id,capture());
  await store.finish(job.id,'failed','paper jam',['finalization failed']);
  const reopened=new ScanStore(name),current=(await reopened.jobs())[0];
  assert.equal(current.status,'failed');assert.equal(current.error,'paper jam');assert.deepEqual(current.warnings,['finalization failed']);
  assert.equal(current.images,1);assert.equal(current.bytes,jpeg.length);assert.equal((await reopened.images(job.id)).length,1);
  const before=await reopened.jobs();await assert.rejects(reopened.finish('missing','complete'));assert.deepEqual(await reopened.jobs(),before);
 });
});

test('512 MiB job budget permits its exact boundary and aborts a later append atomically',async()=>{
 await withStorage(async({store,factory,name})=>{
  const job=await store.createJob({...DEFAULT_OPTIONS});
  await alterJob(factory,name,job.id,{bytes:512*1024*1024-jpeg.length});
  await store.saveImage(job.id,capture());
  const before=await store.jobs();assert.equal(before[0].bytes,512*1024*1024);
  await assert.rejects(store.saveImage(job.id,capture('002-front.jpg',{sheet:2})));
  assert.deepEqual(await store.jobs(),before);assert.equal((await store.images(job.id)).length,1);
 });
});

test('job history is newest first and images remain isolated by job ID',async()=>{
 await withStorage(async({store,factory,name})=>{
  const first=await store.createJob({...DEFAULT_OPTIONS}),second=await store.createJob({...DEFAULT_OPTIONS});
  await alterJob(factory,name,first.id,{created:'2026-01-01T00:00:00Z'});await alterJob(factory,name,second.id,{created:'2026-02-01T00:00:00Z'});
  await store.saveImage(first.id,capture());await store.saveImage(second.id,capture('002-front.jpg',{sheet:2}));
  assert.deepEqual((await store.jobs()).map(job=>job.id),[second.id,first.id]);
  assert.deepEqual((await store.images(first.id)).map(image=>image.filename),['001-front.jpg']);
  assert.deepEqual((await store.images(second.id)).map(image=>image.filename),['002-front.jpg']);
 });
});

test('processed edits persist separately with immutable originals and undo recipes',async()=>{
 await withStorage(async({store,name})=>{
  const job=await store.createJob({...DEFAULT_OPTIONS},{driverId:'epson-ff680w',deviceLabel:'Epson FF-680W'});await store.saveImage(job.id,capture());await store.finish(job.id,'complete');
  const before=await store.jobs(),original=(await store.images(job.id))[0];
  const first=await store.saveEdit(job.id,original.filename,{recipe:{version:1,rotation:90,crop:null},blob:new Blob(['png1'],{type:'image/png'}),width:3300,height:2544,notices:[]});
  assert.deepEqual(first.history,[{version:1,rotation:0,crop:null}]);
  await store.saveEdit(job.id,original.filename,{recipe:{version:1,rotation:270,crop:{x:10,y:20,width:100,height:80}},blob:new Blob(['png2'],{type:'image/png'}),width:80,height:100,notices:[]});
  const reopened=new ScanStore(name),saved=(await reopened.edits(job.id))[0];assert.equal(saved.history.length,2);assert.equal(saved.recipe.rotation,270);assert.equal(saved.width,80);assert.equal(await saved.blob.text(),'png2');
  assert.deepEqual(await reopened.jobs(),before);assert.deepEqual(new Uint8Array(await (await reopened.images(job.id))[0].blob.arrayBuffer()),jpeg);
  await reopened.saveEdit(job.id,original.filename,{recipe:first.recipe,blob:first.blob,width:3300,height:2544,notices:[]},[first.history[0]]);
  assert.equal((await reopened.edits(job.id))[0].history.length,1);
 });
});
test('invalid edit rolls back without overwriting an earlier processed page',async()=>{
 await withStorage(async({store})=>{
  const job=await store.createJob({...DEFAULT_OPTIONS});await store.saveImage(job.id,capture());
  const valid={recipe:{version:1,rotation:90,crop:null},blob:new Blob(['valid'],{type:'image/png'}),width:3300,height:2544,notices:[]};
  await store.saveEdit(job.id,'001-front.jpg',valid);const before=await store.edits(job.id);
  await assert.rejects(store.saveEdit(job.id,'001-front.jpg',{...valid,width:2}),/dimensions/);
  await assert.rejects(store.saveEdit(job.id,'missing.jpg',valid),/missing/);
  await assert.rejects(store.saveEdit(job.id,'001-front.jpg',{...valid,blob:new Blob(['jpeg'],{type:'image/jpeg'})}),/PNG/);
  assert.deepEqual(await store.edits(job.id),before);assert.equal((await store.images(job.id)).length,1);
 });
});
test('schema upgrade preserves a version-one saved job and capture',async()=>{
 await withStorage(async({factory,name})=>{
  const db=await new Promise((resolve,reject)=>{const open=factory.open(name,1);open.onupgradeneeded=()=>{open.result.createObjectStore('jobs',{keyPath:'id'});open.result.createObjectStore('images',{keyPath:['jobId','filename']}).createIndex('job','jobId');};open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});
  const legacy={id:'legacy',created:'2026-01-01T00:00:00Z',options:{...DEFAULT_OPTIONS},status:'complete',images:1,bytes:jpeg.length};
  await new Promise((resolve,reject)=>{const tx=db.transaction(['jobs','images'],'readwrite');tx.objectStore('jobs').add(legacy);tx.objectStore('images').add({jobId:'legacy',filename:'001-front.jpg',sheet:1,side:'front',blob:new Blob([jpeg],{type:'image/jpeg'}),width:2544,height:3300});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  const upgraded=new ScanStore(name);assert.deepEqual(await upgraded.jobs(),[legacy]);assert.deepEqual(await upgraded.edits('legacy'),[]);assert.deepEqual(new Uint8Array(await (await upgraded.images('legacy'))[0].blob.arrayBuffer()),jpeg);
 });
});
