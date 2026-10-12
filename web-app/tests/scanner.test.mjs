import test from 'node:test';
import assert from 'node:assert/strict';
import {Scanner} from '../dist/scanner.js';
import {ImageBatch, tokens, replyLength} from '../dist/protocol.js';
import {DEFAULT_OPTIONS} from '../dist/planner.js';
import {FF680W_PROFILE} from '../dist/profiles/ff680w.js';

const encode = new TextEncoder(), decode = new TextDecoder('latin1');
const jpeg = Uint8Array.of(255, 216, 12, 35, 0, 33, 255, 217);
const imageBlock = (tags, data = jpeg) => ({tags, data});
const replyBlock = (tags, data = new Uint8Array()) => ({items:tokens(encode.encode(tags)),data,header:''});
function rig(options = {}) {
 const events=[], writes=[], logs=[], failures=new Set(), responses=new Map();
 const pendingImages=[];
 let command, payloadBytes=0, pendingData, hangCommand, disconnectCount=0;
 const listeners=new Map();
 const action=async name=>{events.push(name);if(failures.has(name))throw Error('mock '+name+' failure');};
 const endpoints=[{type:'bulk',direction:'in',endpointNumber:1},{type:'bulk',direction:'out',endpointNumber:2}];
 const identity=options.profile?.devices[0]??{vendorId:0x04b8,productId:0x016b};
 const interfaceNumber=options.profile?.usbInterface.number??0;
 const device={...identity,productName:'Mock FF-680W',
  configuration:{interfaces:[{interfaceNumber,alternate:{alternateSetting:0},alternates:[{alternateSetting:0,endpoints}]}]},
  open:()=>action('open'),close:()=>action('close'),reset:()=>action('reset'),
  claimInterface:async intf=>{assert.equal(intf,interfaceNumber);await action('claim');},
  releaseInterface:async intf=>{assert.equal(intf,interfaceNumber);await action('release');},
  transferOut:async(endpoint, data)=>{
   assert.equal(endpoint,2);
   const value=decode.decode(data);
   if(payloadBytes){
    assert.equal(data.length,payloadBytes,'PARA/MECH payload must match header length');
    writes.push({command,bytes:Uint8Array.from(data)});events.push('payload:'+command);payloadBytes=0;
   }else if(data[0]===28){
    assert.deepEqual([...data],[28,88],'only FS X may be used; FIN replaces FS Y');
    command='FSX';events.push(command);
   }else{
    assert.match(value,/^[A-Z ]{4}x[0-9a-f]{7}$/);
    command=value.slice(0,4);payloadBytes=parseInt(value.slice(5),16);events.push(command);
   }
   if(failures.has('write:'+command))throw Error('mock write failure');
   return {status:'ok',bytesWritten:data.length};
  },
  transferIn:async(endpoint,length)=>{
   assert.equal(endpoint,1);
   let data;
   if(pendingData){assert.equal(length,pendingData.expectedLength);data=pendingData.bytes;pendingData=undefined;}
   else{
    assert.equal(length,64);
    if(hangCommand===command)return new Promise(()=>{});
    if(failures.has(command))throw Error('mock '+command+' failure');
    if(command==='FSX')data=Uint8Array.of(6);
    else{
     assert.equal(payloadBytes,0,'reply read before payload was sent');
     const response=responses.get(command)??(command==='IMG '?pendingImages.shift()??imageBlock('#typIMGA#pen#lftd000'):
       {tags:command==='CAPA'?'#ADFDPLX':command==='PARA'?'#parOK  ':'#---'});
     const body=response.data??new Uint8Array();
     const count=response.advertisedLength??body.length;
     const header=response.header??command+'x'+count.toString(16).padStart(7,'0');
     data=new Uint8Array(response.headerBytes??64);data.set(encode.encode(header+(response.tags??'#---')));
     if(count)pendingData={bytes:body,expectedLength:count};
    }
   }
   // Offset DataViews exercise the actual transport's byteOffset handling.
   const backing=new Uint8Array(data.length+4);backing.set(data,2);
   return {status:'ok',data:new DataView(backing.buffer,2,data.length)};
  },
 };
 const usb={addEventListener:(event,handler)=>{if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(handler);},
  removeEventListener:(event,handler)=>{const handlers=listeners.get(event);if(handlers){handlers.delete(handler);if(!handlers.size)listeners.delete(event);}},
  getDevices:async()=>{events.push('getDevices');return options.paired?.(device)??[];},
  requestDevice:async filter=>{events.push('requestDevice');assert.deepEqual(filter,{filters:options.profile?.devices??[{vendorId:0x04b8,productId:0x016b}]});return options.chooser?.(device)??device;}};
 const scanner=new Scanner(usb,line=>logs.push(line),()=>{disconnectCount++;},options.timeout??20000,
   options.profile,options.selected?.(device));
 return {scanner,usb,device,events,writes,logs,pendingImages,failures,responses,
  hang:cmd=>{hangCommand=cmd;},
  disconnect:other=>{for(const handler of [...(listeners.get('disconnect')??[])])handler({device:other??device});},
  listenerCount:()=>listeners.get('disconnect')?.size??0,
  disconnectCount:()=>disconnectCount,
  commands:()=>events.filter(event=>event==='FSX'||/^[A-Z ]{4}$/.test(event)),
  clear:()=>{events.length=0;writes.length=0;logs.length=0;}};
}
async function connected(options){const mock=rig(options);await mock.scanner.connect();mock.clear();return mock;}
const scanOptions=overrides=>({...DEFAULT_OPTIONS,...overrides});

test('connect reuses one matching pairing and finishes all capability queries with FIN',async()=>{
 const mock=rig({paired:device=>[{vendorId:1,productId:2},device]});
 const settings=await mock.scanner.connect();
 assert.equal(mock.scanner.connected,true);
 assert.equal(mock.events.includes('requestDevice'),false);
 assert.deepEqual(mock.events,['getDevices','open','claim','FSX','INFO','CAPA','RESA','STAT','FIN ']);
 assert.deepEqual(Object.keys(settings),['INFO','CAPA','RESA','STAT']);
 assert.deepEqual(settings.CAPA,[{name:'ADF',value:'DPLX'}]);
 await assert.rejects(mock.scanner.connect(),/already connected/);
 await mock.scanner.disconnect();assert.equal(mock.scanner.connected,false);
});

test('unpaired or ambiguous scanners use the filtered device chooser',async()=>{
 for(const paired of [()=>[{vendorId:1,productId:2}],device=>[device,{...device}]]){
  const mock=rig({paired});await mock.scanner.connect();
  assert.deepEqual(mock.events.slice(0,4),['getDevices','requestDevice','open','claim']);
 }
});

test('CAPA extra data is parsed including textual GMTLIST and controls manual LOAD',async()=>{
 const mock=rig();mock.responses.set('CAPA',{tags:'#---',data:encode.encode('#ADFLISTLOADDPLX#GMTLISTMONORED GRN BLU #---')});
 const settings=await mock.scanner.connect();
 assert.deepEqual(settings.CAPA,[{name:'ADF',value:'LISTLOADDPLX'},{name:'GMT',value:'LISTMONORED GRN BLU '}]);
 mock.clear();const result=await mock.scanner.scan(scanOptions(),async()=>{});
 assert.equal(result.images,1);
 assert.deepEqual(mock.commands(),['FSX','STAT','MECH','PARA','TRDT','IMG ','FIN ']);
 assert.equal(decode.decode(mock.writes.find(write=>write.command==='MECH').bytes),'#ADFLOAD');
});

test('ordinary capture uses automatic loading and actual serialized color sheet limit',async()=>{
 const mock=await connected();const saved=[];
 const result=await mock.scanner.scan(scanOptions({max_sheets:1}),async image=>saved.push(image));
 assert.deepEqual(result,{sheets:1,images:1,warnings:[]});
 assert.deepEqual(mock.commands(),['FSX','STAT','PARA','TRDT','IMG ','FIN ']);
 assert.deepEqual([...saved[0].image],[...jpeg]);assert.equal(saved[0].filename,'001-front.jpg');
 const payload=decode.decode(mock.writes.find(write=>write.command==='PARA').bytes);
 assert.ok(payload.includes('#PAGd001'));assert.ok(payload.includes('#COLC024'));
 assert.ok(payload.includes('#ACQi0000003i0000000i0002544i0003300'));
 assert.equal(mock.commands().includes('MECH'),false);
});

test('two duplex sheets assemble interleaved fragments and save terminal data before FIN',async()=>{
 const mock=await connected();const saved=[];
 mock.pendingImages.push(imageBlock('#typIMGA',jpeg.slice(0,3)),imageBlock('#typIMGB#pen'),
  imageBlock('#typIMGA#pen',jpeg.slice(3)),imageBlock('#typIMGA#pen'),imageBlock('#typIMGB#pen#lftd000'));
 const result=await mock.scanner.scan(scanOptions({duplex:true,max_sheets:2}),async image=>{
  saved.push(image);mock.events.push('saved:'+image.filename);
 });
 assert.deepEqual(result,{sheets:2,images:4,warnings:[]});
 assert.deepEqual(saved.map(image=>image.filename),['001-back.jpg','001-front.jpg','002-front.jpg','002-back.jpg']);
 for(const image of saved)assert.deepEqual([...image.image],[...jpeg]);
 assert.deepEqual(mock.events.slice(-2),['saved:002-back.jpg','FIN ']);
 assert.ok(decode.decode(mock.writes[0].bytes).includes('#PAGd004'));
});

test('completed images remain delivered when a later image fails; CAN then FIN clean up',async()=>{
 const mock=await connected();const saved=[];
 mock.pendingImages.push(imageBlock('#typIMGA#pen'),imageBlock('#ERRADF JAM',new Uint8Array()));
 await assert.rejects(mock.scanner.scan(scanOptions(),async image=>saved.push(image)),/Image transfer: ERR=ADF JAM · 1 completed images preserved/);
 assert.equal(saved.length,1);assert.deepEqual([...saved[0].image],[...jpeg]);
 assert.deepEqual(mock.commands().slice(-3),['IMG ','CAN ','FIN ']);
});

test('empty-feeder preflight finalizes without cancellation or any acquisition',async()=>{
 const mock=await connected();mock.responses.set('STAT',{tags:'#ERRADF PE'});const saved=[];
 await assert.rejects(mock.scanner.scan(scanOptions(),async image=>saved.push(image)),error=>{
  assert.equal(error.message,'Scanner status: ERR=ADF PE');return true;
 });
 assert.deepEqual(mock.commands(),['FSX','STAT','FIN ']);assert.deepEqual(saved,[]);
});

test('invalid settings and an already-aborted job do not acquire or feed paper',async()=>{
 const mock=await connected();
 await assert.rejects(mock.scanner.scan(scanOptions({quality:0}),async()=>assert.fail()),/quality/);
 assert.deepEqual(mock.events,[]);
 const abort=new AbortController();abort.abort();
 await assert.rejects(mock.scanner.scan(scanOptions(),async()=>assert.fail(),abort.signal),/^Error: Stopped$/);
 assert.deepEqual(mock.events,[]);
});

test('a rejected PARA uses FIN alone while attempted TRDT failure also requires CAN',async()=>{
 for(const stage of ['PARA','TRDT']){
  const mock=await connected();mock.responses.set(stage,{tags:'#ERRADF BUSY'});
  await assert.rejects(mock.scanner.scan(scanOptions(),async()=>assert.fail()),/ERR=ADF BUSY/);
  assert.equal(mock.commands().includes('CAN '),stage==='TRDT');
  assert.equal(mock.commands().at(-1),'FIN ');assert.equal(mock.commands().includes('IMG '),false);
 }
});

test('abort after a saved sheet preserves it and cancels before requesting another image',async()=>{
 const mock=await connected(),abort=new AbortController(),saved=[];
 mock.pendingImages.push(imageBlock('#typIMGA#pen'),imageBlock('#typIMGA#pen#lftd000'));
 await assert.rejects(mock.scanner.scan(scanOptions(),async image=>{saved.push(image);abort.abort();},abort.signal),/^Error: Stopped · 1 completed images preserved$/);
 assert.equal(saved.length,1);assert.equal(mock.pendingImages.length,1);
 assert.deepEqual(mock.commands().slice(-3),['IMG ','CAN ','FIN ']);
});

test('save callback failure does not falsely claim an image was preserved',async()=>{
 const mock=await connected();
 await assert.rejects(mock.scanner.scan(scanOptions(),async()=>{throw Error('disk unavailable');}),error=>{
  assert.equal(error.message,'disk unavailable');return true;
 });
 assert.equal(mock.logs.some(line=>line.startsWith('Saved')),false);assert.equal(mock.commands().at(-1),'FIN ');
});

test('FIN ERR is a warning on success while scan and cleanup failures retain the scan error',async()=>{
 const mock=await connected();mock.responses.set('FIN ',{tags:'#ERRADF BUSY'});
 const result=await mock.scanner.scan(scanOptions(),async()=>{});
 assert.deepEqual(result,{sheets:1,images:1,warnings:['Finalize: Finalize: ERR=ADF BUSY']});
 mock.clear();mock.responses.set('STAT',{tags:'#ERRADF PE'});
 await assert.rejects(mock.scanner.scan(scanOptions(),async()=>assert.fail()),error=>{
  assert.equal(error.message,'Scanner status: ERR=ADF PE · Cleanup warning');return true;
 });
 assert.deepEqual(mock.commands(),['FSX','STAT','FIN ']);
});

test('failed CAN never prevents FIN and warnings retain each failure',async()=>{
 const mock=await connected();mock.responses.set('IMG ',{tags:'#ERRADF JAM'});
 mock.failures.add('CAN ');mock.responses.set('FIN ',{tags:'#ERRADF BUSY'});
 await assert.rejects(mock.scanner.scan(scanOptions(),async()=>assert.fail()),/Image transfer: ERR=ADF JAM · Cleanup warning/);
 assert.deepEqual(mock.commands().slice(-2),['CAN ','FIN ']);
 assert.ok(mock.logs.some(line=>line==='Cancel: mock CAN  failure'));
 assert.ok(mock.logs.some(line=>line==='Finalize: Finalize: ERR=ADF BUSY'));
});

test('settings primary failure wins over FIN failure and failed connect closes device',async()=>{
 for(const finishFailure of ['transport','ERR']){
  const mock=rig();mock.failures.add('CAPA');
  if(finishFailure==='transport')mock.failures.add('FIN ');else mock.responses.set('FIN ',{tags:'#ERRADF BUSY'});
  await assert.rejects(mock.scanner.connect(),/^Error: mock CAPA failure$/);
  assert.deepEqual(mock.commands(),['FSX','INFO','CAPA','FIN ']);
  assert.equal(mock.events.at(-1),'close');assert.equal(mock.scanner.connected,false);
  assert.ok(mock.logs.some(line=>line.startsWith('Settings finalization:')));
 }
});

test('settings FIN ERR alone rejects connection instead of reporting success',async()=>{
 const mock=rig();mock.responses.set('FIN ',{tags:'#ERRADF BUSY'});
 await assert.rejects(mock.scanner.connect(),/Settings finalization: ERR=ADF BUSY/);
 assert.equal(mock.scanner.connected,false);assert.equal(mock.events.at(-1),'close');
});

test('reset releases resets closes reopens then reads settings and clears old LOAD support',async()=>{
 const mock=rig();mock.responses.set('CAPA',{tags:'#ADFLISTLOAD'});await mock.scanner.connect();mock.clear();
 mock.responses.set('CAPA',{tags:'#ADFDPLX'});
 await mock.scanner.reset();
 assert.deepEqual(mock.events,['release','reset','close','open','claim','FSX','INFO','CAPA','RESA','STAT','FIN ']);
 assert.equal(mock.scanner.connected,true);
 mock.clear();await mock.scanner.scan(scanOptions(),async()=>{});assert.equal(mock.commands().includes('MECH'),false);
});

test('reset failures at each stage clear connection without starting a scan',async()=>{
 for(const stage of ['release','reset','close','open','claim','CAPA','FIN ']){
  const mock=await connected();mock.failures.add(stage);
  await assert.rejects(mock.scanner.reset(),/USB reset failed: mock/);
  assert.equal(mock.scanner.connected,false);assert.equal(mock.events.at(-1),'close');
  assert.equal(mock.commands().some(command=>['PARA','TRDT','MECH'].includes(command)),false);
 }
});

test('exclusive operation guard prevents reset read disconnect or another scan while saving',async()=>{
 const mock=await connected();let releaseImage,started;
 const gate=new Promise(resolve=>{releaseImage=resolve;}),entered=new Promise(resolve=>{started=resolve;});
 const scan=mock.scanner.scan(scanOptions(),async()=>{started();await gate;});await entered;
 const before=[...mock.events];
 try{
  for(const operation of [()=>mock.scanner.reset(),()=>mock.scanner.settings(),()=>mock.scanner.disconnect(),()=>mock.scanner.scan(scanOptions(),async()=>{})])
   await assert.rejects(operation(),/Scanner is busy/);
  assert.deepEqual(mock.events,before);
 }finally{releaseImage();}
 await scan;assert.equal(mock.scanner.connected,true);
});

test('physical disconnection clears only the active device and informs the UI once',async()=>{
 const mock=await connected();mock.disconnect({vendorId:1});assert.equal(mock.scanner.connected,true);
 mock.disconnect();assert.equal(mock.scanner.connected,false);assert.equal(mock.disconnectCount(),1);
 await assert.rejects(mock.scanner.scan(scanOptions(),async()=>assert.fail()),/Connect the scanner first/);
 assert.deepEqual(mock.events,[]);
});

test('USB timeout clears connection and failed connect cannot leave an owned device',async()=>{
 const mock=rig({timeout:5});mock.hang('INFO');
 await assert.rejects(mock.scanner.connect(),/USB transfer timed out/);
 assert.equal(mock.scanner.connected,false);assert.equal(mock.events.at(-1),'close');
 assert.deepEqual(mock.commands(),['FSX','INFO']);
});

test('short or oversized reply frames fail before allocating or requesting their data',async()=>{
 for(const reply of [{headerBytes:63},{header:'INFOx1000001'},{header:'INFOx000000z'}]){
  const mock=rig();mock.responses.set('INFO',{...reply,tags:'#---'});
  await assert.rejects(mock.scanner.connect(),/INFO: (Short|Invalid image\/data length|Unexpected reply)/);
  assert.equal(mock.scanner.connected,false);assert.equal(mock.commands().at(-1),'FIN ');
 }
});

test('protocol image memory bounds account for fragments and reset after each completed image',()=>{
 const batch=new ImageBatch({duplex:true,max_sheets:0},jpeg.length);
 batch.accept(replyBlock('#typIMGA',jpeg.slice(0,3)));
 batch.accept(replyBlock('#typIMGB',jpeg.slice(0,3)));
 const back=batch.accept(replyBlock('#typIMGB#pen',jpeg.slice(3)));assert.equal(back.filename,'001-back.jpg');
 const front=batch.accept(replyBlock('#typIMGA#pen',jpeg.slice(3)));assert.equal(front.filename,'001-front.jpg');
 assert.equal(batch.accept(replyBlock('#typIMGA#pen',jpeg)).filename,'002-front.jpg');
 assert.throws(()=>batch.accept(replyBlock('#typIMGB',new Uint8Array(jpeg.length+1))),/memory limit/);
});

test('protocol caps advertised block sizes independently of image accumulation limits',()=>{
 const frame=new Uint8Array(64);frame.set(encode.encode('IMG x1000001'));
 assert.throws(()=>replyLength('IMG ',frame),/Invalid image\/data length/);
});

test('an injected ESC/I-2 test profile owns identity interface builder capabilities and load behavior',async()=>{
 const built=[],decoded=[];
 const profile={...FF680W_PROFILE,id:'test-profile',label:'Test model',
   devices:[{vendorId:0x1234,productId:0x5678}],usbInterface:{number:3},
   defaults:{...DEFAULT_OPTIONS,mode:'gray'},settingsCommands:['CAPA','STAT'],
   buildScanPlan:options=>{built.push(options);return {payload:encode.encode('test-model-payload')};},
   decodeCapabilities:items=>{decoded.push(items);return {...FF680W_PROFILE.decodeCapabilities(items),resolutions:[123]};},
   mechanicalActions:()=>['#TESTLOAD'],
 };
 const mock=rig({profile,selected:device=>device});
 await mock.scanner.connect();
 assert.equal(mock.scanner.profile.id,'test-profile');
 assert.deepEqual(mock.scanner.capabilities.resolutions,[123]);
 assert.deepEqual(mock.events,['open','claim','FSX','CAPA','STAT','FIN ']);
 assert.deepEqual(decoded,[[{name:'ADF',value:'DPLX'}]]);
 mock.clear();await mock.scanner.scan({...profile.defaults},async()=>{});
 assert.equal(built.length,1);assert.equal(built[0].mode,'gray');
 assert.equal(decode.decode(mock.writes.find(write=>write.command==='PARA').bytes),'test-model-payload');
 assert.equal(decode.decode(mock.writes.find(write=>write.command==='MECH').bytes),'#TESTLOAD');
 assert.deepEqual(mock.commands(),['FSX','STAT','MECH','PARA','TRDT','IMG ','FIN ']);
 await mock.scanner.disconnect();assert.equal(mock.scanner.capabilities,undefined);
});

test('profile/device mismatch rejects before opening or closing an unknown device',async()=>{
 for(const options of [
   {selected:()=>({vendorId:9,productId:9,open:()=>assert.fail(),close:()=>assert.fail()})},
   {chooser:()=>({vendorId:9,productId:9,open:()=>assert.fail(),close:()=>assert.fail()})},
 ]) {
   const mock=rig(options);
   await assert.rejects(mock.scanner.connect(),/Unsupported scanner for selected profile/);
   assert.equal(mock.scanner.connected,false);
   assert.equal(mock.scanner.capabilities,undefined);
   assert.equal(mock.events.some(event=>['open','close','claim','FSX','INFO','CAPA'].includes(event)),false);
 }
});

test('physical disconnect clears previously decoded model capabilities',async()=>{
 const mock=await connected();assert.ok(mock.scanner.capabilities);
 mock.disconnect();assert.equal(mock.scanner.capabilities,undefined);
});

test('validateOptions delegates to the injected model without discovery or device actions',async()=>{
 const built=[];
 const profile={...FF680W_PROFILE,id:'validation-test',defaults:{...DEFAULT_OPTIONS,dpi:123},
   buildScanPlan:options=>{
     built.push(options);
     if(options.dpi===123)throw RangeError('test model rejects 123 dpi');
     return {payload:encode.encode('test-model-payload')};
   },
 };
 const mock=rig({profile});
 assert.throws(()=>mock.scanner.validateOptions(profile.defaults),/test model rejects 123 dpi/);
 const valid={...profile.defaults,dpi:200};
 assert.equal(mock.scanner.validateOptions(valid),undefined);
 assert.deepEqual(built,[profile.defaults,valid]);
 assert.deepEqual(mock.events,[]);
 assert.equal(mock.scanner.connected,false);
 // Acquisition performs the same profile preflight before any device actions.
 await assert.rejects(mock.scanner.scan(profile.defaults,async()=>assert.fail()),/test model rejects 123 dpi/);
 assert.deepEqual(mock.events,[]);
});

test('default model validation rejects invalid options before scanner discovery',()=>{
 const mock=rig();
 assert.throws(()=>mock.scanner.validateOptions({...DEFAULT_OPTIONS,quality:0}),/quality/);
 assert.throws(()=>mock.scanner.validateOptions({...DEFAULT_OPTIONS,dpi:1200}),/unsupported device DPI/);
 assert.deepEqual(mock.events,[]);
});

test('fresh drivers register only while connected and disconnect removes each listener',async()=>{
 const mock=rig();
 assert.equal(mock.listenerCount(),0);
 for(let index=0;index<4;index++) {
   const scanner=new Scanner(mock.usb,()=>{},()=>{},20000,FF680W_PROFILE,mock.device);
   assert.equal(mock.listenerCount(),0);
   await scanner.connect();assert.equal(mock.listenerCount(),1);
   await scanner.disconnect();assert.equal(mock.listenerCount(),0);
 }
 assert.equal(mock.scanner.connected,false);
});

test('same driver reconnect attaches one listener after both manual disconnect and physical unplug',async()=>{
 const mock=rig();
 await mock.scanner.connect();assert.equal(mock.listenerCount(),1);
 await mock.scanner.disconnect();assert.equal(mock.listenerCount(),0);
 await mock.scanner.connect();assert.equal(mock.listenerCount(),1);
 mock.disconnect();assert.equal(mock.listenerCount(),0);assert.equal(mock.disconnectCount(),1);
 // Once detached, later disconnect events cannot notify the abandoned driver.
 mock.disconnect();assert.equal(mock.disconnectCount(),1);
 await mock.scanner.connect();assert.equal(mock.listenerCount(),1);
 mock.disconnect();assert.equal(mock.listenerCount(),0);assert.equal(mock.disconnectCount(),2);
});

test('failed connection and transfer timeout remove the disconnect listener',async()=>{
 const failed=rig();failed.failures.add('CAPA');
 await assert.rejects(failed.scanner.connect(),/mock CAPA failure/);
 assert.equal(failed.listenerCount(),0);
 failed.failures.clear();await failed.scanner.connect();assert.equal(failed.listenerCount(),1);
 await failed.scanner.disconnect();assert.equal(failed.listenerCount(),0);
 const timed=rig({timeout:5});timed.hang('INFO');
 await assert.rejects(timed.scanner.connect(),/USB transfer timed out/);
 assert.equal(timed.listenerCount(),0);
});
