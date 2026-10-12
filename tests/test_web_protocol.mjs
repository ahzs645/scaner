import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHeader, replyLength, tokens, compact, errorTokens, ImageBatch, cleanupSession} from '../src/ff680w_re/web/protocol.js';
const text = value => new TextEncoder().encode(value);
const bytes = (...parts) => Uint8Array.from(parts.flatMap(p => [...(typeof p === 'string' ? text(p) : p)]));
const block = (tags, data = []) => ({items: tokens(text(tags)), data: Uint8Array.from(data)});
const jpeg = [255,216,10,11,255,217];

test('CAPA GMTLIST remains text instead of a negative binary byte count', () => {
 const parsed = tokens(text('#GMTLISTMONORED GRN BLU #COLLISTC024#---'));
 assert.deepEqual(parsed.map(compact), [{name:'GMT',value:'LISTMONORED GRN BLU '},{name:'COL',value:'LISTC024'}]);
 assert.equal(compact(tokens(text('#GMTLISTh100'))[0]).value,'LISTh100');
});
test('binary GMT delimiters inside a LUT do not split or terminate tokens', () => {
 const parsed = tokens(bytes('#GMTRED h004', [0,35,255,12], '#COLC024#---'));
 assert.equal(parsed.length,2);
 assert.deepEqual(compact(parsed[0]),{name:'GMT',channel:'RED',binary_bytes:4});
 assert.deepEqual([...parsed[0].raw.subarray(8)],[0,35,255,12]);
 assert.equal(parsed[1].value,'C024');
});
test('malformed and truncated LUTs fail instead of silently skipping following tokens', () => {
 assert.throws(()=>tokens(text('#GMTMONOh0g0')),/Invalid tone table/);
 assert.throws(()=>tokens(bytes('#GMTMONOh100',[0,1])),/Truncated tone table/);
 assert.deepEqual(compact(tokens(text('#GMTMONOh000'))[0]),{name:'GMT',channel:'MONO',binary_bytes:0});
});
test('token parser handles header offset, NUL padding, terminator and empty value',()=>{
 assert.deepEqual(tokens(bytes('STATx0000000#ERRADF PE',[0,0],'#abc#---#ERRignored'),12).map(compact),[{name:'ERR',value:'ADF PE'},{name:'abc',value:''}]);
});
test('reply headers validate every length digit and prevent oversized blocks',()=>{
 const head = value => bytes(value,new Uint8Array(52));
 assert.equal(replyLength('IMG ',head('IMG x000001a')).length,26);
 for (const bad of ['IMG x000001z','STATx0000000','IMG x1000001']) assert.throws(()=>replyLength('IMG ',head(bad)));
 assert.throws(()=>replyLength('IMG ',text('IMG x0000000')),/Short/);
 assert.equal(new TextDecoder().decode(buildHeader('PARA',16)),'PARAx0000010');
 assert.throws(()=>buildHeader('IMG',0));
 assert.throws(()=>buildHeader('PARA',-1));
});
test('uppercase status errors, attention and busy tokens are all recognized',()=>{
 for (const name of ['ERR','err','Err','ATN','NRD']) assert.throws(()=>errorTokens(tokens(text('#'+name+'ADF PE')),'Scanner status'),/Scanner status/);
 errorTokens(tokens(text('#parOK  ')),'Parameters');
});
test('duplex accepts side fragments and numbers two sheets independently',()=>{
 const batch=new ImageBatch({duplex:true});
 assert.equal(batch.accept(block('#typIMGA',jpeg.slice(0,3))),undefined);
 const back1=batch.accept(block('#typIMGB#pen',jpeg));
 assert.equal(back1.filename,'001-back.jpg');
 const front1=batch.accept(block('#typIMGA#pen',jpeg.slice(3)));
 assert.equal(front1.filename,'001-front.jpg');
 assert.deepEqual([...front1.image],jpeg);
 assert.equal(batch.accept(block('#typIMGA#pen',jpeg)).filename,'002-front.jpg');
 assert.equal(batch.accept(block('#typIMGB#pen#lftd000',jpeg)).filename,'002-back.jpg');
 batch.validate();
 assert.deepEqual(batch.counts,{front:2,back:2});
});
test('terminal image data is completed before validating job',()=>{
 const batch=new ImageBatch();
 const completed=batch.accept(block('#pen#lftd000',jpeg));
 assert.deepEqual([...completed.image],jpeg);
 batch.validate();
});
test('batch rejects missing sides, unfinished JPEGs, unexpected sides and image errors',()=>{
 const batch=new ImageBatch({duplex:true});
 batch.accept(block('#typIMGA#pen#lftd000',jpeg));
 assert.throws(()=>batch.validate(),/Incomplete job/);
 const partial=new ImageBatch();partial.accept(block('#lftd000',jpeg.slice(0,3)));
 assert.throws(()=>partial.validate(),/Incomplete job/);
 assert.throws(()=>new ImageBatch().accept(block('#typIMGB',jpeg)),/Unexpected back/);
 assert.throws(()=>new ImageBatch().accept(block('#typIMGC',jpeg)),/Unknown/);
 assert.throws(()=>new ImageBatch().accept(block('#pen',jpeg.slice(0,3))),/Incomplete JPEG/);
 assert.throws(()=>new ImageBatch().accept(block('#ERRADF PE')),/Image transfer/);
});
test('sheet limit counts physical fronts/backs and fails as soon as a side exceeds it',()=>{
 const batch=new ImageBatch({duplex:true,max_sheets:1});
 batch.accept(block('#typIMGA#pen',jpeg));batch.accept(block('#typIMGB#pen',jpeg));
 assert.throws(()=>batch.accept(block('#typIMGA#pen',jpeg)),/exceeded sheet limit/);
});
test('stop/error cleanup attempts cancel then FIN despite failures without legacy unlock',async()=>{
 const calls=[],errors=[];
 await cleanupSession({query:async c=>{calls.push(c);throw Error('test failure');},control:async()=>assert.fail('legacy unlock must not be sent')}, {locked:true,done:false,acquisitionAttempted:true},e=>errors.push(e));
 assert.deepEqual(calls,['CAN ','FIN ']);assert.equal(errors.length,2);
});
test('completed jobs use FIN without cancellation or legacy unlock; unlocked jobs do nothing',async()=>{
 const calls=[];const io={query:async c=>calls.push(c),control:async()=>assert.fail('legacy unlock must not be sent')};
 await cleanupSession(io,{locked:false,done:false},assert.fail);
 assert.deepEqual(calls,[]);
 await cleanupSession(io,{locked:true,done:true},assert.fail);
 assert.deepEqual(calls,['FIN ']);
});

test('empty-feeder preflight uses FIN without cancellation or hiding the status error',async()=>{
 const nodes=new Map();
 const get=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',value:({mode:'color',duplex:'true',dpi:'300',sheets:'0',paper:'letter',quality:'90'})[id],checked:id==='doublefeed',replaceChildren(){},append(){}});return nodes.get(id);};
 const calls=[];let last,failFinalize=false;
 const device={productName:'Test scanner',configuration:{interfaces:[{interfaceNumber:0,alternate:{alternateSetting:0},alternates:[{alternateSetting:0,endpoints:[{type:'bulk',direction:'in',endpointNumber:1},{type:'bulk',direction:'out',endpointNumber:2}]}]}]},open:async()=>{},close:async()=>{},claimInterface:async()=>{},
  transferOut:async(ep,data)=>{last=new TextDecoder().decode(data);calls.push(last);return {status:'ok',bytesWritten:data.length};},
  transferIn:async()=>{let data;if(last.charCodeAt(0)===28)data=Uint8Array.of(6);else{const command=last.slice(0,4);data=bytes((command==='FIN '&&failFinalize?'UNKN':command)+'x0000000'+(command==='STAT'?'#ERRADF PE#---':'#---'));const padded=new Uint8Array(64);padded.set(data);data=padded;}return {status:'ok',data:new DataView(data.buffer)};}};
 const savedDescriptors=new Map(['document','window','navigator','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 try{
  Object.defineProperties(globalThis,{document:{configurable:true,value:{getElementById:get}},window:{configurable:true,value:{launchToken:'test',addEventListener(){}}},navigator:{configurable:true,value:{usb:{getDevices:async()=>[],requestDevice:async()=>device,addEventListener(){}}}},fetch:{configurable:true,value:async path=>({ok:true,json:async()=>path==='/api/plan'?{payload_hex:'00'}:{id:'job',directory:'/test'}})}});
  await import('../src/ff680w_re/web/app.js?empty-feeder-test');
  await get('connect').onclick();
  for(const cleanupFailure of [false,true]){
   failFinalize=cleanupFailure;calls.length=0;await get('scan').onclick();
   assert.equal(calls.some(c=>c.startsWith('CAN ')),false);
   assert.equal(calls.some(c=>c.startsWith('MECH')),false);
   assert.equal(calls.some(c=>c.startsWith('TRDT')),false);
   assert.equal(calls.filter(c=>c.startsWith('FIN ')).length,1);
   assert.equal(calls.at(-1),'FIN x0000000');
   assert.equal(calls.includes(String.fromCharCode(28)+'Y'),false);
   assert.match(get('status').textContent,/^Scanner status: ERR=ADF PE/);
   assert.equal(get('status').textContent.includes('preserved'),false);
   assert.equal(get('status').textContent.includes('Cleanup warning'),cleanupFailure);
  }
 }finally{for(const [key,descriptor] of savedDescriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});

let integrationSequence=0;
async function withScannerApp(options, run){
 const nodes=new Map(),events=[],uploads=[];
 const defaults={mode:'color',duplex:'false',dpi:'300',sheets:'1',paper:'letter',quality:'90',...options.values};
 const element=()=>({textContent:'',disabled:false,children:[],replaceChildren(){this.children=[];},append(...items){this.children.push(...items);}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,{...element(),value:defaults[id],checked:id==='doublefeed'});return nodes.get(id);};
 let lastCommand,pendingData,capabilities=options.capabilities??'#ADFDPLX',fault=new Set(),replyTags=new Map();
 const action=async name=>{events.push(name);if(fault.has(name))throw Error('mock '+name+' failure');};
 const endpoints=[{type:'bulk',direction:'in',endpointNumber:1},{type:'bulk',direction:'out',endpointNumber:2}];
 const scanner={vendorId:0x04b8,productId:0x016b,productName:'Test FF-680W',
  configuration:{interfaces:[{interfaceNumber:0,alternate:{alternateSetting:0},alternates:[{alternateSetting:0,endpoints}]}]},
  open:()=>action('open'),close:()=>action('close'),claimInterface:()=>action('claim'),releaseInterface:()=>action('release'),reset:()=>action('reset'),
  transferOut:async(ep,data)=>{
   const value=new TextDecoder().decode(data);
   if(data[0]===28){lastCommand='usb:'+String.fromCharCode(data[1]);events.push(lastCommand);}
   else if(/^[A-Z ]{4}x[0-9a-f]{7}$/.test(value)){lastCommand=value.slice(0,4);events.push('command:'+lastCommand);}
   else events.push('payload:'+value);
   return {status:'ok',bytesWritten:data.length};
  },
  transferIn:async()=>{
   let data;
   if(pendingData){data=pendingData;pendingData=undefined;}
   else if(lastCommand.startsWith('usb:'))data=Uint8Array.of(6);
   else{
    if(fault.has(lastCommand))throw Error('mock '+lastCommand+' failure');
    const command=lastCommand;
    const tags=replyTags.get(command)??(command==='CAPA'?capabilities:command==='PARA'?'#parOK  ':command==='IMG '?'#typIMGA#pen#lftd000':'#---');
    const size=command==='IMG '?jpeg.length:0;
    data=new Uint8Array(64);data.set(bytes(command+'x'+size.toString(16).padStart(7,'0'),tags));
    if(size)pendingData=Uint8Array.from(jpeg);
   }
   return {status:'ok',data:new DataView(data.buffer,data.byteOffset,data.byteLength)};
  },
 };
 const descriptors=new Map(['document','window','navigator','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 try{
  const usb={getDevices:async()=>{events.push('getDevices');return options.paired?.(scanner)??[];},requestDevice:async filter=>{events.push('requestDevice');assert.deepEqual(filter,{filters:[{vendorId:0x04b8,productId:0x016b}]});return scanner;},addEventListener(){}};
  Object.defineProperties(globalThis,{
   document:{configurable:true,value:{getElementById:get,createElement:element}},
   window:{configurable:true,value:{launchToken:'test',addEventListener(){}}},
   navigator:{configurable:true,value:{usb}},
   fetch:{configurable:true,value:async(path,request)=>{
    events.push('api:'+path);
    if(options.beforeFetch)await options.beforeFetch(path);
    let result;
    if(path==='/api/plan')result={payload_hex:'23414446'};
    else if(path==='/api/jobs')result={id:'job',directory:'/test'};
    else{uploads.push({path,bytes:[...request.body]});result={url:'/images/job/001-front.jpg',bytes:request.body.length};}
    return {ok:true,json:async()=>result};
   }},
  });
  await import('../src/ff680w_re/web/app.js?integration='+integrationSequence++);
  await run({get,events,uploads,scanner,setCapabilities:value=>{capabilities=value;},fail:(...names)=>{fault=new Set(names);},setReplyTags:(command,tags)=>replyTags.set(command,tags)});
 }finally{for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
}

test('connect reuses the one matching paired scanner without another chooser',async()=>{
 await withScannerApp({paired:scanner=>[{vendorId:123,productId:456},scanner]},async({get,events})=>{
  await get('connect').onclick();
  assert.equal(events.includes('requestDevice'),false);
  assert.deepEqual(events.slice(0,3),['getDevices','open','claim']);
  assert.deepEqual(events.filter(e=>e.startsWith('command:')),['command:INFO','command:CAPA','command:RESA','command:STAT','command:FIN ']);
  assert.equal(get('scan').disabled,false);
 });
});

test('connect requests selection when no matching pairing or multiple scanners exist',async()=>{
 for(const paired of [()=>[{vendorId:1,productId:2}],scanner=>[scanner,{...scanner}]]){
  await withScannerApp({paired},async({get,events})=>{
   await get('connect').onclick();
   assert.deepEqual(events.slice(0,4),['getDevices','requestDevice','open','claim']);
   assert.match(get('status').textContent,/Connected/);
  });
 }
});

test('scan skips mechanical LOAD when CAPA does not advertise it and saves terminal image',async()=>{
 await withScannerApp({},async({get,events,uploads})=>{
  await get('connect').onclick();events.length=0;
  await get('scan').onclick();
  assert.equal(events.some(e=>e==='command:MECH'),false);
  assert.deepEqual(events.filter(e=>e.startsWith('command:')),['command:STAT','command:PARA','command:TRDT','command:IMG ','command:FIN ']);
  assert.equal(events.at(-1),'command:FIN ');
  assert.equal(events.includes('usb:Y'),false);
  assert.deepEqual(uploads,[{path:'/api/jobs/job/001-front.jpg',bytes:jpeg}]);
  assert.equal(get('status').textContent,'Complete · 1 sheets · 1 images');
 });
});

test('scan sends advertised LOAD before parameters and acquisition',async()=>{
 await withScannerApp({capabilities:'#ADFLISTLOADDPLX'},async({get,events})=>{
  await get('connect').onclick();events.length=0;
  await get('scan').onclick();
  assert.deepEqual(events.filter(e=>e.startsWith('command:')),['command:STAT','command:MECH','command:PARA','command:TRDT','command:IMG ','command:FIN ']);
  assert.ok(events.includes('payload:#ADFLOAD'));
  assert.match(get('status').textContent,/^Complete/);
 });
});

test('reset releases, resets, closes, reopens and rereads settings without feeding',async()=>{
 await withScannerApp({capabilities:'#ADFLISTLOAD'},async({get,events,setCapabilities})=>{
  assert.equal(get('reset').disabled,true);
  await get('reset').onclick();assert.deepEqual(events,[]);
  await get('connect').onclick();assert.equal(get('reset').disabled,false);
  setCapabilities('#ADFDPLX');events.length=0;
  await get('reset').onclick();
  assert.deepEqual(events,['release','reset','close','open','claim','usb:X','command:INFO','command:CAPA','command:RESA','command:STAT','command:FIN ']);
  assert.equal(get('status').textContent,'Connected · USB session reset');
  assert.equal(get('reset').disabled,false);assert.equal(get('scan').disabled,false);assert.equal(get('connect').disabled,true);
  events.length=0;await get('scan').onclick();
  assert.equal(events.includes('command:MECH'),false,'reset must replace the old LOAD capability');
 });
});

test('reset failure closes and clears connection without automatically restarting a scan',async()=>{
 for(const stage of ['release','reset','close','open','claim','CAPA','FIN ']){
  await withScannerApp({},async({get,events,fail})=>{
   await get('connect').onclick();events.length=0;fail(stage);
   await get('reset').onclick();
   assert.match(get('status').textContent,/^USB reset failed: mock/);
   assert.equal(events.at(-1),'close');
   assert.equal(get('connect').disabled,false);
   for(const id of ['scan','reset','read','disconnect'])assert.equal(get(id).disabled,true,id);
   assert.equal(events.some(e=>['command:MECH','command:TRDT','command:PARA'].includes(e)),false);
   events.length=0;await get('reset').onclick();assert.deepEqual(events,[],'connection must have been cleared');
  });
 }
});

test('reset cannot interfere with an active scan even if its handler is called',async()=>{
 let releasePlan,planStarted;
 const started=new Promise(resolve=>{planStarted=resolve;});
 const gate=new Promise(resolve=>{releasePlan=resolve;});
 await withScannerApp({beforeFetch:async path=>{if(path==='/api/plan'){planStarted();await gate;}}},async({get,events})=>{
  await get('connect').onclick();events.length=0;
  const scan=get('scan').onclick();await started;
  assert.equal(get('reset').disabled,true);
  await get('reset').onclick();
  assert.equal(events.includes('reset'),false);
  assert.equal(events.includes('release'),false);
  releasePlan();await scan;
  assert.match(get('status').textContent,/^Complete/);
  assert.equal(get('reset').disabled,false);
 });
});

test('cleanup recognizes FIN ERR tokens as warnings without invoking legacy unlock',async()=>{
 const calls=[],warnings=[];
 await cleanupSession({query:async command=>{calls.push(command);return block('#ERRADF BUSY#---');},control:()=>assert.fail('legacy unlock')},
  {locked:true,done:true},warning=>warnings.push(warning));
 assert.deepEqual(calls,['FIN ']);
 assert.deepEqual(warnings,['Finalize: Finalize: ERR=ADF BUSY']);
});

test('settings preserve the primary query error when FIN also fails',async()=>{
 for(const failure of ['transport','ERR']){
  await withScannerApp({},async({get,events,uploads,fail,setReplyTags})=>{
   if(failure==='transport')fail('CAPA','FIN ');
   else{fail('CAPA');setReplyTags('FIN ','#ERRADF BUSY#---');}
   await get('connect').onclick();
   assert.equal(get('status').textContent,'mock CAPA failure');
   assert.match(get('log').textContent,failure==='transport'?/Settings finalization: mock FIN  failure/:/Settings finalization: Settings finalization: ERR=ADF BUSY/);
   assert.deepEqual(events.filter(e=>e.startsWith('command:')),['command:INFO','command:CAPA','command:FIN ']);
   assert.equal(events.at(-1),'close');
   assert.equal(events.includes('usb:Y'),false);
   assert.equal(get('connect').disabled,false);assert.equal(get('scan').disabled,true);
   assert.deepEqual(uploads,[]);
   assert.equal(events.some(e=>e.startsWith('api:')),false,'settings errors must never start a scan');
  });
 }
});

test('settings FIN failure alone prevents a successful connection or reset status',async()=>{
 for(const handler of ['connect','reset']){
  await withScannerApp({},async({get,events,uploads,setReplyTags})=>{
   if(handler==='reset'){await get('connect').onclick();events.length=0;}
   setReplyTags('FIN ','#ERRADF BUSY#---');
   await get(handler).onclick();
   assert.match(get('status').textContent,/Settings finalization: ERR=ADF BUSY/);
   assert.equal(get('status').textContent.startsWith('Connected'),false);
   assert.equal(events.at(-1),'close');
   assert.equal(get('connect').disabled,false);assert.equal(get('scan').disabled,true);
   assert.equal(events.includes('usb:Y'),false);
   assert.deepEqual(uploads,[]);
  });
 }
});

test('a completed capture with FIN ERR preserves its image and reports cleanup warning',async()=>{
 await withScannerApp({},async({get,events,uploads,setReplyTags})=>{
  await get('connect').onclick();events.length=0;
  setReplyTags('FIN ','#ERRADF BUSY#---');
  await get('scan').onclick();
  assert.deepEqual(uploads,[{path:'/api/jobs/job/001-front.jpg',bytes:jpeg}]);
  assert.equal(get('status').textContent,'Complete · 1 sheets · 1 images · Cleanup warning; use Reset USB session');
  assert.match(get('log').textContent,/Finalize: Finalize: ERR=ADF BUSY/);
  assert.equal(events.filter(e=>e==='command:FIN ').length,1);
  assert.equal(events.includes('command:CAN '),false);assert.equal(events.includes('usb:Y'),false);
 });
});

test('image error plus FIN ERR reports the original error and never claims a captured image',async()=>{
 await withScannerApp({},async({get,events,uploads,setReplyTags})=>{
  await get('connect').onclick();events.length=0;
  setReplyTags('IMG ','#ERRADF JAM#---');setReplyTags('FIN ','#ERRADF BUSY#---');
  await get('scan').onclick();
  assert.equal(get('status').textContent,'Image transfer: ERR=ADF JAM · Cleanup warning; use Reset USB session');
  assert.equal(get('status').textContent.includes('preserved'),false);
  assert.equal(get('status').textContent.includes('Complete'),false);
  assert.deepEqual(uploads,[]);assert.equal(get('images').children.length,0);
  assert.deepEqual(events.filter(e=>e.startsWith('command:')).slice(-3),['command:IMG ','command:CAN ','command:FIN ']);
  assert.equal(events.includes('usb:Y'),false);
 });
});
