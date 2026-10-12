import test from 'node:test';
import assert from 'node:assert/strict';
import {OrientationDetector,decideOrientation,prepareOrientationInput} from '../dist/processing/orientation.js';

const source={blob:new Blob(['immutable original'],{type:'image/jpeg'}),width:1200,height:1600};
const data=(degrees=90,confidence=20)=>({orientation_degrees:degrees,orientation_confidence:confidence,script:'Latin'});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function reached(predicate) {for(let index=0;index<30&&!predicate();index++)await Promise.resolve();assert.ok(predicate(),'expected async phase was not reached');}
class WorkerStub {
  calls=[];terminated=0;
  async detect(blob) {this.calls.push(blob);return this.onDetect?this.onDetect(blob):{data:data()};}
  async terminate() {this.terminated++;}
}
function detectorRig(factory=()=>new WorkerStub(),options={}) {
  const creations=[];let loads=0;
  const loader=async()=>{loads++;return {OEM:{TESSERACT_ONLY:0},createWorker:async(language,mode,settings)=>{
    creations.push({language,mode,settings});return factory(creations.length);
  }};};
  return {detector:new OrientationDetector({loader,prepareInput:async value=>value.blob,...options}),creations,loads:()=>loads};
}

test('OSD clockwise correction is applied directly for every quarter turn, including zero',()=>{
  for(const angle of [0,90,180,270]) {
    const decision=decideOrientation(data(angle,15));
    assert.equal(decision.accepted,true);assert.equal(decision.rotation,angle);
    assert.equal(decision.confidence,15);assert.equal(decision.script,'Latin');
    assert.equal(decision.method,'tesseract-osd');
  }
  assert.match(decideOrientation(data(0)).reason,/already upright/);
  assert.equal(decideOrientation(data(90)).rotation,90,'the JS correction must not be inverted to 270');
});

test('low confidence, no text, malformed scores and unsupported angles leave the image unchanged',()=>{
  const cases=[undefined,null,{},data(null,null),data(90,14.99),data(90,null),data(90,-1),data(90,NaN),
    data(90,Infinity),data(90,'20'),data('90',20),data(45,20),data(360,20),data(-90,20),data(NaN,20)];
  for(const result of cases) {
    const decision=decideOrientation(result);
    assert.equal(decision.accepted,false);assert.equal(decision.rotation,null);assert.ok(decision.reason.length);
  }
  assert.match(decideOrientation(data(null,null)).reason,/Not enough text/);
  assert.match(decideOrientation(data(90,10)).reason,/below 15/);
  assert.equal(decideOrientation(data(90,Infinity)).confidence,null);
  assert.equal(decideOrientation({...data(),script:42}).script,null);
});

test('threshold is configurable and rejects nonfinite or negative configuration',()=>{
  assert.equal(decideOrientation(data(180,7),7).accepted,true);
  assert.equal(decideOrientation(data(180,7),8).accepted,false);
  for(const threshold of [-1,NaN,Infinity,'15']) {
    assert.throws(()=>decideOrientation(data(),threshold),/threshold/);
    assert.throws(()=>new OrientationDetector({confidenceThreshold:threshold}),/threshold/);
  }
  for(const timeoutMs of [0,-1,Infinity,1.5,2_147_483_648])assert.throws(()=>new OrientationDetector({timeoutMs}),/timeout/);
});

test('local assets and legacy OSD engine are explicit, blobs stay local, and ready workers are reused',async()=>{
  const workers=[],mock=detectorRig(()=>{const worker=new WorkerStub();workers.push(worker);return worker;});
  const before=new Uint8Array(await source.blob.arrayBuffer());
  const first=await mock.detector.detect(source),second=await mock.detector.detect(source);
  assert.equal(first.rotation,90);assert.deepEqual(second,first);
  assert.equal(mock.loads(),1);assert.equal(mock.creations.length,1);
  const {language,mode,settings}=mock.creations[0];
  assert.equal(language,'osd');assert.equal(mode,0);
  assert.equal(settings.legacyCore,true);assert.equal(settings.legacyLang,true);
  assert.equal(settings.workerBlobURL,false);assert.equal(settings.gzip,true);assert.equal(settings.cacheMethod,'write');
  const vendor=new URL('../dist/vendor/ocr/',import.meta.url);
  assert.equal(settings.workerPath,new URL('worker.min.js',vendor).href);
  assert.equal(settings.corePath,new URL('core/',vendor).href);
  assert.equal(settings.langPath,new URL('lang/',vendor).href);
  assert.equal(typeof settings.errorHandler,'function');
  assert.deepEqual(workers[0].calls,[source.blob,source.blob]);
  assert.deepEqual(new Uint8Array(await source.blob.arrayBuffer()),before);
  mock.detector.dispose();assert.equal(workers[0].terminated,1);
  await mock.detector.detect(source);assert.equal(mock.creations.length,2);
  mock.detector.dispose();assert.equal(workers[1].terminated,1);
});

test('low confidence abstention retains the ready worker for the next page',async()=>{
  const worker=new WorkerStub();worker.onDetect=()=>({data:data(270,2)});
  const mock=detectorRig(()=>worker);
  assert.equal((await mock.detector.detect(source)).rotation,null);
  worker.onDetect=()=>({data:data(270,19)});
  assert.equal((await mock.detector.detect(source)).rotation,270);
  assert.equal(mock.creations.length,1);assert.equal(worker.terminated,0);mock.detector.dispose();
});

test('concurrent calls are rejected while one page is being analyzed',async()=>{
  const gate=deferred(),worker=new WorkerStub();worker.onDetect=()=>gate.promise;
  const mock=detectorRig(()=>worker),pending=mock.detector.detect(source);
  await reached(()=>worker.calls.length===1);
  await assert.rejects(mock.detector.detect(source),/busy/);
  assert.equal(worker.calls.length,1);gate.resolve({data:data(180,25)});
  assert.equal((await pending).rotation,180);mock.detector.dispose();
});

test('abort terminates a ready engine and the next page initializes a fresh one',async()=>{
  const workers=[],gate=deferred(),mock=detectorRig(()=>{
    const worker=new WorkerStub();if(!workers.length)worker.onDetect=()=>gate.promise;workers.push(worker);return worker;
  });
  const abort=new AbortController(),pending=mock.detector.detect(source,abort.signal);
  await reached(()=>workers[0]?.calls.length===1);abort.abort();
  await assert.rejects(pending,/stopped/);assert.equal(workers[0].terminated,1);
  assert.equal((await mock.detector.detect(source)).accepted,true);assert.equal(workers.length,2);
  gate.resolve({data:data(270,100)});await Promise.resolve();
  mock.detector.dispose();assert.equal(workers[0].terminated,1);assert.equal(workers[1].terminated,1);
});

test('abort during initialization terminates a late worker without replacing a newer ready engine',async()=>{
  const init=deferred(),old=new WorkerStub(),current=new WorkerStub();
  const mock=detectorRig(index=>index===1?init.promise:current);
  const abort=new AbortController(),pending=mock.detector.detect(source,abort.signal);
  await reached(()=>mock.creations.length===1);abort.abort();await assert.rejects(pending,/stopped/);
  assert.equal((await mock.detector.detect(source)).accepted,true);
  init.resolve(old);await reached(()=>old.terminated===1);
  assert.equal(old.calls.length,0);assert.equal(current.terminated,0);
  await mock.detector.detect(source);assert.equal(mock.creations.length,2);assert.equal(current.calls.length,2);
  mock.detector.dispose();assert.equal(current.terminated,1);
});

test('abort during module loading prevents worker creation',async()=>{
  const load=deferred();let createCount=0;
  const detector=new OrientationDetector({prepareInput:async value=>value.blob,loader:()=>load.promise});
  const abort=new AbortController(),pending=detector.detect(source,abort.signal);
  await Promise.resolve();abort.abort();await assert.rejects(pending,/stopped/);
  load.resolve({OEM:{TESSERACT_ONLY:0},createWorker:async()=>{createCount++;return new WorkerStub();}});
  await Promise.resolve();await Promise.resolve();assert.equal(createCount,0);
  detector.dispose();
});

test('timeout includes engine initialization and terminates any eventual late handle',async()=>{
  const init=deferred(),worker=new WorkerStub(),mock=detectorRig(()=>init.promise,{timeoutMs:5});
  await assert.rejects(mock.detector.detect(source),/timed out/);
  init.resolve(worker);await reached(()=>worker.terminated===1);assert.equal(worker.calls.length,0);
  mock.detector.dispose();
});

test('timeout during detection terminates the engine',async()=>{
  const worker=new WorkerStub();worker.onDetect=()=>new Promise(()=>{});
  const mock=detectorRig(()=>worker,{timeoutMs:5});
  await assert.rejects(mock.detector.detect(source),/timed out/);
  assert.equal(worker.terminated,1);mock.detector.dispose();assert.equal(worker.terminated,1);
});

test('failed initialization and detection reset state for a later request',async()=>{
  const ready=new WorkerStub(),mock=detectorRig(index=>{
    if(index===1)throw Error('bad local OSD data');
    if(index===2){const bad=new WorkerStub();bad.onDetect=()=>{throw Error('OSD worker failed');};return bad;}
    return ready;
  });
  await assert.rejects(mock.detector.detect(source),/bad local OSD data/);
  await assert.rejects(mock.detector.detect(source),/OSD worker failed/);
  assert.equal((await mock.detector.detect(source)).accepted,true);
  assert.equal(mock.creations.length,3);mock.detector.dispose();assert.equal(ready.terminated,1);
});

test('engine error callback preserves a bounded rejection without an asynchronous global throw',async()=>{
  const init=deferred(),worker=new WorkerStub(),mock=detectorRig(()=>init.promise);
  const pending=mock.detector.detect(source);await reached(()=>mock.creations.length===1);
  mock.creations[0].settings.errorHandler('local core failed');
  await assert.rejects(pending,/Orientation engine failed: local core failed/);
  init.resolve(worker);await reached(()=>worker.terminated===1);mock.detector.dispose();
});

test('a reused worker error callback rejects its current operation and forces a fresh engine',async()=>{
  const first=new WorkerStub(),fresh=new WorkerStub(),mock=detectorRig(index=>index===1?first:fresh);
  await mock.detector.detect(source);
  first.onDetect=()=>new Promise(()=>{});
  const pending=mock.detector.detect(source);await reached(()=>first.calls.length===2);
  mock.creations[0].settings.errorHandler('reused OSD engine failed');
  await assert.rejects(pending,/reused OSD engine failed/);assert.equal(first.terminated,1);
  assert.equal((await mock.detector.detect(source)).accepted,true);assert.equal(mock.creations.length,2);
  mock.detector.dispose();assert.equal(fresh.terminated,1);
});

test('a stale initializer error cannot reject a newer pending detection',async()=>{
  const init=deferred(),detect=deferred(),old=new WorkerStub(),fresh=new WorkerStub();fresh.onDetect=()=>detect.promise;
  const mock=detectorRig(index=>index===1?init.promise:fresh),abort=new AbortController();
  const first=mock.detector.detect(source,abort.signal);await reached(()=>mock.creations.length===1);
  abort.abort();await assert.rejects(first,/stopped/);
  const current=mock.detector.detect(source);await reached(()=>fresh.calls.length===1);
  mock.creations[0].settings.errorHandler('abandoned initialization error');
  init.resolve(old);await reached(()=>old.terminated===1);
  detect.resolve({data:data(180,21)});assert.equal((await current).rotation,180);
  assert.equal(fresh.terminated,0);mock.detector.dispose();
});

test('blank native OSD results abstain without destroying the engine',async()=>{
  const worker=new WorkerStub();worker.onDetect=()=>({data:{tesseract_script_id:null,script:null,script_confidence:null,
    orientation_degrees:null,orientation_confidence:null}});
  const mock=detectorRig(()=>worker),result=await mock.detector.detect(source);
  assert.equal(result.accepted,false);assert.equal(result.rotation,null);assert.equal(result.confidence,null);
  assert.match(result.reason,/Not enough text/);assert.equal(worker.terminated,0);mock.detector.dispose();
});

test('dispose cancels work and releases the worker exactly once',async()=>{
  const worker=new WorkerStub();worker.onDetect=()=>new Promise(()=>{});
  const mock=detectorRig(()=>worker),pending=mock.detector.detect(source);
  await reached(()=>worker.calls.length===1);mock.detector.dispose();
  await assert.rejects(pending,/stopped/);mock.detector.dispose();assert.equal(worker.terminated,1);
});

test('invalid images and pre-aborted calls never load OCR or prepare pixels',async()=>{
  let prepared=0;const mock=detectorRig(undefined,{prepareInput:async value=>{prepared++;return value.blob;}});
  for(const invalid of [null,{...source,width:0},{...source,height:NaN},{...source,width:10000,height:10000},
    {...source,width:1.1},{...source,blob:new Blob()}, {...source,blob:'https://example.com/private-scan.jpg'}]) {
    await assert.rejects(mock.detector.detect(invalid));
  }
  await assert.rejects(mock.detector.detect(source,AbortSignal.abort()),/stopped/);
  assert.equal(prepared,0);assert.equal(mock.loads(),0);assert.equal(mock.creations.length,0);
});

function imageApiStub(width,height,{canvasFailure=false,blobFailure=false}={}) {
  const previousBitmap=globalThis.createImageBitmap,previousCanvas=globalThis.OffscreenCanvas;
  let closed=0;const canvases=[],calls=[],derived=new Blob(['analysis only'],{type:'image/png'});
  globalThis.createImageBitmap=async blob=>{calls.push(blob);return {width,height,close:()=>{closed++;}};};
  globalThis.OffscreenCanvas=class {
    constructor(w,h){this.width=w;this.height=h;this.size=[w,h];canvases.push(this);}
    getContext(){return canvasFailure?null:{drawImage:(...args)=>{this.draw=args;}};}
    async convertToBlob(options){assert.equal(options.type,'image/png');if(blobFailure)throw Error('encoding failed');return derived;}
  };
  return {canvases,calls,derived,closed:()=>closed,restore:()=>{
    if(previousBitmap===undefined)delete globalThis.createImageBitmap;else globalThis.createImageBitmap=previousBitmap;
    if(previousCanvas===undefined)delete globalThis.OffscreenCanvas;else globalThis.OffscreenCanvas=previousCanvas;
  }};
}

test('small inputs reuse the original Blob and still close the decoded bitmap',async()=>{
  const mock=imageApiStub(1200,1600);
  try {assert.equal(await prepareOrientationInput(source),source.blob);assert.equal(mock.closed(),1);assert.equal(mock.canvases.length,0);}
  finally {mock.restore();}
});

test('large inputs use a 2200-pixel analysis copy, release resources and preserve original bytes',async()=>{
  const mock=imageApiStub(4000,6000),input={...source,width:4000,height:6000};
  try {
    const before=await source.blob.text(),result=await prepareOrientationInput(input);
    assert.equal(result,mock.derived);assert.equal(await source.blob.text(),before);
    assert.deepEqual(mock.canvases[0].size,[1467,2200]);
    assert.deepEqual(mock.canvases[0].draw.slice(1),[0,0,1467,2200]);
    assert.equal(mock.canvases[0].width,1);assert.equal(mock.canvases[0].height,1);assert.equal(mock.closed(),1);
  } finally {mock.restore();}
});

test('dimension mismatch and canvas failures close bitmaps and release temporary canvases',async()=>{
  const mismatch=imageApiStub(100,100);
  try {await assert.rejects(prepareOrientationInput(source),/dimensions/);assert.equal(mismatch.closed(),1);}
  finally {mismatch.restore();}
  for(const failure of [{canvasFailure:true},{blobFailure:true}]) {
    const mock=imageApiStub(4000,6000,failure);
    try {
      await assert.rejects(prepareOrientationInput({...source,width:4000,height:6000}));
      assert.equal(mock.closed(),1);assert.equal(mock.canvases[0].width,1);assert.equal(mock.canvases[0].height,1);
    } finally {mock.restore();}
  }
});

test('abort during image decoding closes the eventual bitmap without starting OCR or a canvas',async()=>{
  const previous=globalThis.createImageBitmap,gate=deferred();let loaded=0,closed=0;
  globalThis.createImageBitmap=()=>gate.promise;
  const detector=new OrientationDetector({loader:async()=>{loaded++;throw Error('must not load');}});
  try {
    const abort=new AbortController(),pending=detector.detect(source,abort.signal);abort.abort();
    await assert.rejects(pending,/stopped/);
    gate.resolve({width:source.width,height:source.height,close:()=>{closed++;}});
    await reached(()=>closed===1);assert.equal(loaded,0);
  } finally {detector.dispose();if(previous===undefined)delete globalThis.createImageBitmap;else globalThis.createImageBitmap=previous;}
});
