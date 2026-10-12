import test from 'node:test';
import assert from 'node:assert/strict';
import {originalRecipe,validateRecipe,transformGeometry,mapBounds,isEdited,applyOrientation} from '../dist/processing/types.js';
import {WorkerImageProcessor} from '../dist/processing/client.js';
const source={blob:new Blob(['original'],{type:'image/jpeg'}),width:40,height:30};
const request={recipe:originalRecipe()};
class WorkerStub {
 onmessage=null;onerror=null;messages=[];terminated=0;
 postMessage(message){this.messages.push(message);}terminate(){this.terminated++;}
 respond(result={...request,blob:source.blob,width:40,height:30,notices:[]}){this.onmessage?.({data:{id:this.messages.at(-1).id,result}});}
}
test('crop is expressed in original coordinates before all four quarter turns',()=>{
 const crop={x:7,y:3,width:19,height:11};
 for(const [rotation,w,h,translate] of [[0,19,11,[0,0]],[90,11,19,[11,0]],[180,19,11,[19,11]],[270,11,19,[0,19]]]){
  const geometry=transformGeometry({version:1,rotation,crop},40,30);
  assert.equal(geometry.width,w);assert.equal(geometry.height,h);assert.deepEqual(geometry.translate,translate);assert.deepEqual(geometry.crop,crop);
 }
});
test('downsample boundary mapping rounds outwards, including nonuniform resize ratios',()=>{
 assert.deepEqual(mapBounds({x:2,y:3,width:5,height:7},101,79,30,20),{x:6,y:11,width:18,height:29});
 assert.deepEqual(mapBounds({x:0,y:0,width:30,height:20},101,79,30,20),{x:0,y:0,width:101,height:79});
});
test('invalid source sizes, unsupported turns and out-of-source crop fail before processing',()=>{
 for(const recipe of [{version:1,rotation:45,crop:null},{version:2,rotation:0,crop:null},{version:1,rotation:0,crop:{x:-1,y:0,width:1,height:1}},{version:1,rotation:0,crop:{x:39,y:0,width:2,height:1}},{version:1,rotation:0,crop:{x:0,y:0,width:0,height:1}}])assert.throws(()=>validateRecipe(recipe,40,30));
 assert.throws(()=>validateRecipe(originalRecipe(),10000,10000),/40 million/);
 assert.throws(()=>validateRecipe(originalRecipe(),0,30));
 assert.equal(isEdited(originalRecipe()),false);assert.equal(isEdited({version:1,rotation:90,crop:null}),true);
});
test('processor serializes calls, ignores stale replies and returns only the matching revision',async()=>{
 const worker=new WorkerStub(),processor=new WorkerImageProcessor(()=>worker);
 const first=processor.process(source,request);
 await assert.rejects(processor.process(source,request),/busy/);
 worker.onmessage({data:{id:0,result:'stale'}});worker.respond({recipe:originalRecipe(),blob:source.blob,width:40,height:30,notices:[]});
 assert.equal((await first).blob,source.blob);
 const second=processor.process(source,request);worker.respond();await second;processor.dispose();assert.equal(worker.terminated,1);
});
test('abort destroys the worker and a later job starts a fresh worker',async()=>{
 const workers=[];const processor=new WorkerImageProcessor(()=>{const worker=new WorkerStub();workers.push(worker);return worker;});
 const abort=new AbortController(),pending=processor.process(source,request,abort.signal);abort.abort();await assert.rejects(pending,/stopped/);assert.equal(workers[0].terminated,1);
 const next=processor.process(source,request);workers[1].respond();await next;processor.dispose();
});
test('timeout and worker crash reject without producing a result',async()=>{
 const worker=new WorkerStub(),processor=new WorkerImageProcessor(()=>worker,5);
 await assert.rejects(processor.process(source,request),/timed out/);assert.equal(worker.terminated,1);
 const crash=new WorkerStub(),other=new WorkerImageProcessor(()=>crash);const pending=other.process(source,request);crash.onerror({});await assert.rejects(pending,/worker failed/);assert.equal(crash.terminated,1);
});
test('invalid plans and pre-aborted calls do not instantiate a worker',async()=>{
 let created=0;const processor=new WorkerImageProcessor(()=>{created++;return new WorkerStub();});
 await assert.rejects(processor.process(source,{recipe:{version:1,rotation:45,crop:null}}));
 await assert.rejects(processor.process(source,request,AbortSignal.abort()));assert.equal(created,0);
});

test('upright correction composes with existing manual rotation and retains original-coordinate crop',()=>{
 const crop={x:7,y:3,width:19,height:11};
 for(const initial of [0,90,180,270])for(const rotation of [0,90,180,270]){
  const recipe={version:1,rotation:initial,crop},next=applyOrientation(recipe,{accepted:true,rotation,confidence:20,reason:'test',method:'tesseract-osd'});
  assert.equal(next.rotation,(initial+rotation)%360);assert.deepEqual(next.crop,crop);assert.equal(recipe.rotation,initial);assert.notEqual(next.crop,crop);
 }
});
test('uncertain orientation retains the complete existing edit and rejects invalid accepted angles',()=>{
 const recipe={version:1,rotation:270,crop:{x:7,y:3,width:19,height:11}};
 assert.deepEqual(applyOrientation(recipe,{accepted:false,rotation:null,confidence:2,reason:'uncertain',method:'tesseract-osd'}),recipe);
 assert.throws(()=>applyOrientation(recipe,{accepted:true,rotation:45}),/Invalid orientation/);
});
