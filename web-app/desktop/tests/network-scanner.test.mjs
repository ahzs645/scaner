import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {scanNetwork} from '../network-scanner.mjs';
import {NodeFramedSession,readNetworkSettings,MAX_IMAGE_BLOCK_BYTES} from '../network-settings.mjs';
import {DEFAULT_OPTIONS} from '../../dist/planner.js';

const OPTIONS={...DEFAULT_OPTIONS,duplex:true,max_sheets:1};
const INFO='#PRDh007FF-680W#---';
const CAPA='#ADFDPLX#ADFDFL1DFL3#ADFSKEW#ADFCRP #ADFRSMSLISTd300d600#COLLISTC024M008#RSMd300#RSSd300#JPGRANGd001d100#---';
const JPEG=Buffer.from([255,216,35,101,114,114,0,255,217]);
function frame(data,opcode=0xa000){const b=Buffer.alloc(data.length+12);b.write('IS');b.writeUInt16BE(opcode,2);b.writeUInt16BE(0x380c,4);b.writeUInt32BE(data.length,6);b.set(data,12);return b;}
function header(command,length=0,tags='#---'){const b=Buffer.alloc(64);b.write(`${command}x${length.toString(16).padStart(7,'0')}${tags}`);return b;}
const img=(tags,data=JPEG)=>({tags,data});
async function eventually(predicate){for(let i=0;i<200&&!predicate();i++)await new Promise(r=>setTimeout(r,2));assert.ok(predicate());}

async function fixture(config={}) {
  const commands=[],writes=[],clients=new Set(),issues=[];let connections=0;
  const blocks=config.blocks??[img('#typIMGA#pend000#---'),img('#typIMGB#pend000#lftd000#---')];
  const server=createServer(socket=>{
    connections++;clients.add(socket);socket.on('close',()=>clients.delete(socket));socket.on('error',()=>{});
    let incoming=Buffer.alloc(0),staged,pendingData,index=0;
    const send=data=>{if(config.fragment){for(let i=0;i<data.length;i+=config.fragment)socket.write(data.subarray(i,i+config.fragment));}else socket.write(data);};
    send(frame(Buffer.from('0104000000','hex'),0x8000));
    const answer=(command,data=Buffer.alloc(0),tags='#---')=>{pendingData=data;send(frame(header(command,data.length,tags)));};
    socket.on('data',chunk=>{
      incoming=Buffer.concat([incoming,chunk]);
      try {while(incoming.length>=12){
        const length=incoming.readUInt32BE(6);if(incoming.length<length+12)return;
        const packet=Buffer.from(incoming.subarray(0,length+12));incoming=incoming.subarray(length+12);writes.push(packet);
        const opcode=packet.readUInt16BE(2);
        if(opcode===0x2100){send(frame(Buffer.from([6]),0xa100));continue;}
        if(opcode===0x2101)continue;
        assert.equal(opcode,0x2000);
        const count=packet.readUInt32BE(12),expected=packet.readUInt32BE(16),payload=packet.subarray(20);assert.equal(count,payload.length);
        if(count===2){assert.deepEqual([...payload],[28,88]);assert.equal(expected,1);send(frame(Buffer.from([6])));continue;}
        if(!count){assert.ok(pendingData);assert.equal(expected,pendingData.length);send(frame(pendingData));pendingData=undefined;continue;}
        if(staged){
          assert.equal(count,staged.length);assert.equal(expected,64);
          if(staged.command==='PARA'){assert.ok(payload.toString('latin1').includes('#PAGd'+(config.pageCount??'002')));answer('PARA',Buffer.alloc(0),config.paraTags??'#parOK  #---');}
          else {assert.equal(staged.command,'MECH');assert.equal(payload.toString(),'#ADFLOAD');answer('MECH');}
          staged=undefined;continue;
        }
        assert.equal(count,12);const command=payload.subarray(0,4).toString();commands.push(command);
        assert.ok(['INFO','CAPA','STAT','RESA','PARA','MECH','TRDT','IMG ','CAN ','FIN '].includes(command));
        if(command==='PARA'||command==='MECH'){
          assert.equal(expected,0,'parameter header must not request a 64-byte reply');
          staged={command,length:parseInt(payload.subarray(5).toString(),16)};
          // Never send PARA reply before the body: the empty ACK is transport-only.
          send(frame(Buffer.alloc(0)));continue;
        }
        assert.equal(expected,64);if(config.hang===command)continue;
        if(command==='INFO')answer(command,Buffer.from(config.info??INFO));
        else if(command==='CAPA')answer(command,Buffer.from(config.capa??CAPA));
        else if(command==='STAT')answer(command,Buffer.alloc(0),config.statTags??'#---');
        else if(command==='IMG '){const block=blocks[index++];assert.ok(block,'unexpected extra IMG request');pendingData=block.data;
          send(frame(header(command,block.advertised??block.data.length,block.tags)));}
        else answer(command,Buffer.alloc(0),command==='TRDT'?config.trdtTags??'#---':command==='FIN '?config.finTags??'#---':'#---');
      }}catch(error){issues.push(error);socket.destroy();}
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {host:'127.0.0.1',port:server.address().port,timeoutMs:config.timeoutMs??1000,deadlineMs:5000,
    commands,writes,issues,clients,get connections(){return connections;},
    async close(){for(const socket of clients)socket.destroy();await new Promise(resolve=>server.close(resolve));assert.deepEqual(issues,[]);},
    async released(){await eventually(()=>writes.at(-1)?.readUInt16BE(2)===0x2101);await eventually(()=>clients.size===0);}};
}

test('network color duplex uses two PARA frames, handles empty ACK and routes binary JPEG without token parsing',async()=>{
  for(const fragment of [undefined,7]) {
    const mock=await fixture({fragment}),images=[];
    try {const result=await scanNetwork(mock,OPTIONS,image=>images.push(image));
      assert.deepEqual(result,{sheets:1,images:2,warnings:[]});assert.deepEqual(images.map(i=>[i.sheet,i.side]),[[1,'front'],[1,'back']]);
      for(const image of images)assert.deepEqual(Buffer.from(image.image),JPEG);
      assert.deepEqual(mock.commands,['INFO','CAPA','STAT','PARA','TRDT','IMG ','IMG ','FIN ']);await mock.released();
    }finally{await mock.close();}
  }
});

test('LOAD is sent only when advertised and uses separate MECH header/body frames',async()=>{
  const mock=await fixture({capa:CAPA.replace('#ADFDPLX','#ADFDPLXLOAD')});
  try {await scanNetwork(mock,OPTIONS,()=>{});assert.ok(mock.commands.indexOf('MECH')<mock.commands.indexOf('PARA'));await mock.released();}
  finally{await mock.close();}
});

test('completed images apply backpressure before the next network IMG request',async()=>{
  const mock=await fixture();let release,seen=0;
  try {const pending=scanNetwork(mock,OPTIONS,async()=>{if(++seen===1)await new Promise(r=>{release=r;});});
    await eventually(()=>release);assert.equal(mock.commands.filter(c=>c==='IMG ').length,1);release();await pending;await mock.released();}
  finally{release?.();await mock.close();}
});

test('invalid options, callback and pre-aborted scan never connect or operate the feeder',async()=>{
  const mock=await fixture();
  try {await assert.rejects(scanNetwork(mock,{...OPTIONS,dpi:123},()=>{}),/DPI/);
    await assert.rejects(scanNetwork(mock,OPTIONS,null),/callback/);
    await assert.rejects(scanNetwork(mock,OPTIONS,()=>{},AbortSignal.abort()),/stopped/);assert.equal(mock.connections,0);}
  finally{await mock.close();}
});

test('unsupported identity, capability and empty feeder reject before scan setup and never CAN',async()=>{
  for(const config of [{info:'#PRDh007XX-680W#---'},{capa:CAPA.replace('DPLX','')},{statTags:'#ERRADF PE  #---'}]) {
    const mock=await fixture(config);
    try {await assert.rejects(scanNetwork(mock,OPTIONS,()=>{}),/identity|duplex|Scanner status/);
      assert.ok(!mock.commands.some(c=>['PARA','TRDT','CAN ','MECH'].includes(c)));await mock.released();}
    finally{await mock.close();}
  }
});

test('parameter rejection does not start or cancel acquisition; TRDT failure does cancel',async()=>{
  for(const config of [{paraTags:'#parFAIL#---'},{trdtTags:'#ERRADF BUSY#---'}]) {
    const mock=await fixture(config);
    try {await assert.rejects(scanNetwork(mock,OPTIONS,()=>{}),/accept parameters|Scan start/);
      assert.equal(mock.commands.includes('TRDT'),!!config.trdtTags);assert.equal(mock.commands.includes('CAN '),!!config.trdtTags);await mock.released();}
    finally{await mock.close();}
  }
});

test('later transfer failure preserves a delivered front image and cancels before FIN/unlock',async()=>{
  const mock=await fixture({blocks:[img('#typIMGA#pend000#---'),img('#ERRADF JAM #---',Buffer.alloc(0))]}),images=[];
  try {await assert.rejects(scanNetwork(mock,OPTIONS,image=>images.push(image)),error=>{
      assert.match(error.message,/JAM.*1 completed images preserved/);assert.equal(error.images,1);return true;});
    assert.equal(images.length,1);assert.deepEqual(mock.commands.slice(-2),['CAN ','FIN ']);await mock.released();}
  finally{await mock.close();}
});

test('abort after delivered image retains socket for bounded CAN and FIN cleanup',async()=>{
  const mock=await fixture(),abort=new AbortController();
  try {await assert.rejects(scanNetwork(mock,OPTIONS,()=>{abort.abort();},abort.signal),/stopped/);
    assert.deepEqual(mock.commands.slice(-2),['CAN ','FIN ']);await mock.released();}
  finally{await mock.close();}
});

test('abort during pending IMG read rejects immediately and still attempts CAN/FIN/unlock',async()=>{
  const mock=await fixture({hang:'IMG '}),abort=new AbortController();
  try {const pending=scanNetwork(mock,OPTIONS,()=>{},abort.signal);await eventually(()=>mock.commands.includes('IMG '));abort.abort();
    await assert.rejects(pending,/stopped/);assert.deepEqual(mock.commands.slice(-2),['CAN ','FIN ']);await mock.released();}
  finally{await mock.close();}
});

test('callback failure propagates and a pending callback is bounded by the job deadline',async()=>{
  for(const hanging of [false,true]) {
    const mock=await fixture();
    try {await assert.rejects(scanNetwork({...mock,deadlineMs:hanging?100:5000},OPTIONS,()=>hanging?new Promise(()=>{}):Promise.reject(Error('disk full'))),/deadline|disk full/);
      assert.deepEqual(mock.commands.slice(-2),['CAN ','FIN ']);await mock.released();}
    finally{await mock.close();}
  }
});

test('opt-in image frames may exceed metadata limit while remaining bounded to 16 MiB',async()=>{
  const large=Buffer.alloc(2*1024*1024);large.set([255,216]);large.set([255,217],large.length-2);
  const mock=await fixture({blocks:[img('#typIMGA#pend000#---',large),img('#typIMGB#pend000#lftd000#---',large)]});
  try {const sizes=[];await scanNetwork(mock,OPTIONS,image=>sizes.push(image.image.length));assert.deepEqual(sizes,[large.length,large.length]);await mock.released();}
  finally{await mock.close();}
});

test('oversized IMG announcement is rejected before requesting the data',async()=>{
  const mock=await fixture({blocks:[{tags:'#typIMGA#---',data:Buffer.alloc(0),advertised:MAX_IMAGE_BLOCK_BYTES+1}]});
  try {await assert.rejects(scanNetwork(mock,OPTIONS,()=>{}),/Invalid image\/data length/);
    assert.equal(mock.writes.filter(p=>p.readUInt16BE(2)===0x2000&&p.readUInt32BE(12)===0).length,2,'only INFO/CAPA data were requested');await mock.released();}
  finally{await mock.close();}
});

test('partial images across blocks are bounded to 24 MiB',async()=>{
  const mock=await fixture({blocks:[img('#typIMGA#---',Buffer.alloc(16*1024*1024)),img('#---',Buffer.alloc(9*1024*1024))]});
  try {await assert.rejects(scanNetwork(mock,OPTIONS,()=>{}),/Image exceeds/);assert.deepEqual(mock.commands.slice(-2),['CAN ','FIN ']);await mock.released();}
  finally{await mock.close();}
});

test('default session and settings API cannot opt into acquisition through supplied options',async()=>{
  const session=new NodeFramedSession({host:'127.0.0.1'});
  await assert.rejects(session.acquire('PARA',new Uint8Array([1])),/not enabled/);
  const mock=await fixture();
  try {await readNetworkSettings({...mock,allowAcquisition:true});assert.deepEqual(mock.commands,['INFO','CAPA','RESA','STAT','FIN ']);await mock.released();}
  finally{await mock.close();}
});

test('512 MiB job bound rejects the next image while preserving all earlier delivered pages',async()=>{
  const data=Buffer.alloc(16*1024*1024);data.set([255,216]);data.set([255,217],data.length-2);
  const blocks=Array.from({length:33},()=>img('#typIMGA#pend000#---',data));
  const mock=await fixture({blocks,pageCount:'000',timeoutMs:3000});let saved=0;
  try {await assert.rejects(scanNetwork({...mock,deadlineMs:20000},{...OPTIONS,duplex:false,max_sheets:0},()=>{saved++;}),error=>{
      assert.match(error.message,/512 MiB/);assert.equal(error.images,32);return true;});
    assert.equal(saved,32);assert.deepEqual(mock.commands.slice(-2),['CAN ','FIN ']);await mock.released();}
  finally{await mock.close();}
});

test('metadata remains limited to 1 MiB inside an acquisition-enabled session',async()=>{
  const mock=await fixture({capa:' '.repeat(1024*1024+1)});
  try {await assert.rejects(scanNetwork(mock,OPTIONS,()=>{}),/exceeds 1 MiB/);
    assert.ok(!mock.commands.includes('PARA'));assert.equal(mock.writes.filter(p=>p.readUInt16BE(2)===0x2000&&p.readUInt32BE(12)===0).length,1);await mock.released();}
  finally{await mock.close();}
});

test('FIN failure warns without cancelling a successfully completed acquisition or blocking unlock',async()=>{
  const mock=await fixture({finTags:'#ERRADF BUSY#---'});
  try {const result=await scanNetwork(mock,OPTIONS,()=>{});assert.equal(result.images,2);assert.match(result.warnings[0],/Finalize/);
    assert.ok(!mock.commands.includes('CAN '));await mock.released();}
  finally{await mock.close();}
});

test('interleaved duplex chunks retain surface routing and combine the terminal block before completion',async()=>{
  const front=Buffer.from([255,216,1,2,255,217]),back=Buffer.from([255,216,3,4,255,217]);
  const mock=await fixture({blocks:[img('#typIMGA#---',front.subarray(0,3)),img('#typIMGB#---',back.subarray(0,3)),
    img('#typIMGA#pend000#---',front.subarray(3)),img('#typIMGB#pend000#lftd000#---',back.subarray(3))]});const saved=[];
  try {await scanNetwork(mock,OPTIONS,image=>saved.push(image));assert.deepEqual(Buffer.from(saved[0].image),front);assert.deepEqual(Buffer.from(saved[1].image),back);await mock.released();}
  finally{await mock.close();}
});
