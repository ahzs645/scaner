import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {readNetworkSettings, NodeFramedSession, networkPacket} from '../network-settings.mjs';

const WELCOME = Buffer.from('49538000380c0000000500000104000000','hex');
function response(payload, opcode = 0xa000, declared = payload.length) {
  const packet=Buffer.alloc(12+payload.length);packet.write('IS');packet.writeUInt16BE(opcode,2);packet.writeUInt16BE(0x380c,4);
  packet.writeUInt32BE(declared,6);packet.set(payload,12);return packet;
}
function immediate(command, extra = '', tags = '#---') {
  const data=Buffer.isBuffer(extra)?extra:Buffer.from(extra);
  const bytes=Buffer.alloc(64);bytes.write(`${command}x${data.length.toString(16).padStart(7,'0')}${tags}`);return bytes;
}
const extras={INFO:Buffer.from('#PRDh007FF-680W#VERh00418P4#---'),CAPA:Buffer.from('#ADFDPLX#ADFPEDT#ADFCRP #ADFDFL1DFL3#ADFRSMSLISTd300d600#COLLISTC024M008#RSMd300#RSSd300#JPGRANGd001d100#---'),
  RESA:Buffer.concat([Buffer.from('#GMTMONOh100'),Buffer.from(Array.from({length:256},(_,index)=>index)),Buffer.from('#---')]),STAT:Buffer.alloc(0)};

async function fixture(options={}) {
  const writes=[],clients=new Set(),serverErrors=[];
  const server=createServer(socket=>{
    clients.add(socket);socket.on('error',error=>serverErrors.push(error));socket.on('close',()=>clients.delete(socket));
    let buffer=Buffer.alloc(0),last;
    const send=packet=>{
      if(!packet)return;
      // TCP may fragment any header/payload boundary; writes may coalesce too.
      if(options.fragment)for(let offset=0;offset<packet.length;offset+=options.fragment)socket.write(packet.subarray(offset,offset+options.fragment));
      else socket.write(packet);
    };
    send(options.welcome??WELCOME);
    socket.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);
      while(buffer.length>=12) {
        const size=buffer.readUInt32BE(6);if(buffer.length<12+size)return;
        const packet=buffer.subarray(0,12+size);buffer=buffer.subarray(12+size);writes.push(Buffer.from(packet));
        const opcode=packet.readUInt16BE(2);
        if(opcode===0x2100){send(options.lock??response(Buffer.from([6]),0xa100));continue;}
        if(opcode===0x2101)continue;
        assert.equal(opcode,0x2000,'all settings use the known passthrough type');
        const count=packet.readUInt32BE(12),expected=packet.readUInt32BE(16),payload=packet.subarray(20);
        assert.equal(count,payload.length);
        if(count===2) {
          assert.deepEqual([...payload],[28,88]);assert.equal(expected,1);
          send(options.fsx??response(Buffer.from([6])));continue;
        }
        if(count===0) {
          assert.equal(expected,(options.extra?.[last]??extras[last]).length);
          send(options.dataResponse?.(last,expected)??response(options.extra?.[last]??extras[last]));continue;
        }
        assert.equal(count,12);assert.equal(expected,64);last=payload.subarray(0,4).toString();
        assert.ok(['INFO','CAPA','RESA','STAT','FIN '].includes(last),'no acquisition/settings-write command is allowed');
        if(options.hang===last)continue;
        const extra=options.extra?.[last]??extras[last]??Buffer.alloc(0);
        send(options.commandResponse?.(last)??response(immediate(last,extra,last==='FIN '?options.finTags??'#---':last==='STAT'?options.statTags??'#---':'#---')));
      }
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {host:'127.0.0.1',port:server.address().port,timeoutMs:options.timeoutMs??200,deadlineMs:2000,writes,clients,
    async close(){for(const socket of clients)socket.destroy();await new Promise(resolve=>server.close(resolve));},
    commands:()=>writes.filter(packet=>packet.readUInt16BE(2)===0x2000&&packet.readUInt32BE(12)===12).map(packet=>packet.subarray(20,24).toString()),serverErrors};
}
async function eventually(predicate) {for(let i=0;i<50&&!predicate();i++)await new Promise(resolve=>setTimeout(resolve,2));assert.ok(predicate());}

test('live-proven wire sequence reads FF-680W settings with fragmented TCP and binary RESA',async()=>{
  for(const fragment of [undefined,1,7]) {
    const mock=await fixture({fragment});
    try {
      const result=await readNetworkSettings(mock);
      assert.deepEqual(Object.keys(result.settings),['INFO','CAPA','RESA','STAT']);
      assert.deepEqual(result.settings.INFO[0],{name:'PRD',value:'h007FF-680W'});
      assert.deepEqual(result.settings.RESA,[{name:'GMT',channel:'MONO',binary_bytes:256}]);
      assert.deepEqual(result.capabilities.resolutions,[300]);assert.equal(result.capabilities.duplex,true);
      assert.deepEqual(result.warnings,[]);
      await eventually(()=>mock.writes.at(-1)?.readUInt16BE(2)===0x2101);
      assert.equal(mock.writes[0].toString('hex'),'49532100000c00000007000001a0040000012c');
      assert.equal(mock.writes[1].toString('hex'),'49532000000c0000000a000000000002000000011c58');
      assert.equal(mock.writes[2].toString('hex'),'49532000000c0000001400000000000c00000040494e464f7830303030303030');
      assert.deepEqual(mock.commands(),['INFO','CAPA','RESA','STAT','FIN ']);
      assert.equal(mock.writes.at(-1).toString('hex'),'49532101000c000000000000');
      await eventually(()=>mock.clients.size===0);
    } finally {await mock.close();}
  }
});

test('busy or unknown greeting never sends lock or any acquisition command',async()=>{
  const mock=await fixture({welcome:response(Buffer.from('0104810001010110'+'00'.repeat(16),'hex'),0x8000)});
  try {await assert.rejects(readNetworkSettings(mock),/Busy or unrecognized/);assert.deepEqual(mock.writes,[]);await eventually(()=>mock.clients.size===0);}
  finally {await mock.close();}
});

test('identity is checked after INFO and before any CAPA or model-specific settings',async()=>{
  for(const info of ['#PRDh007XX-680W#---','#PRDh008FF-680W #---','#---','#PRDh007FF-680W#PRDh007FF-680W#---']) {
    const mock=await fixture({extra:{INFO:Buffer.from(info)}});
    try {
      await assert.rejects(readNetworkSettings(mock),/identity/);
      await eventually(()=>mock.writes.at(-1)?.readUInt16BE(2)===0x2101);
      assert.deepEqual(mock.commands(),['INFO','FIN ']);
    } finally {await mock.close();}
  }
});

test('outer lock and tunneled FSX ACK are required and failed FSX releases the outer lock',async()=>{
  for(const failure of ['lock','fsx']) {
    const mock=await fixture({[failure]:response(Buffer.from([21]),failure==='lock'?0xa100:0xa000)});
    try {
      await assert.rejects(readNetworkSettings(mock),/did not acknowledge/);
      assert.deepEqual(mock.commands(),[]);
      if(failure==='fsx')await eventually(()=>mock.writes.at(-1)?.readUInt16BE(2)===0x2101);
      else assert.equal(mock.writes.length,1);
    } finally {await mock.close();}
  }
});

test('public session query rejects every acquisition or write command before connecting',async()=>{
  const session=new NodeFramedSession({host:'127.0.0.1'});
  for(const command of ['PARA','MECH','TRDT','IMG ','CAN ','FIN ','SNMP','INFOx'])await assert.rejects(session.query(command),/not allowlisted/);
  assert.deepEqual(await session.close(),[]);
});

test('frame and settings length bounds reject before requesting oversized data',async()=>{
  for(const bad of [response(Buffer.alloc(0),0xa000,2**30),response(immediate('INFO',Buffer.alloc(0),'#---'),0xa100),
    response(Buffer.from('INFOx0100001#---'.padEnd(64,'\0')))]) {
    const mock=await fixture({commandResponse:command=>command==='INFO'?bad:undefined});
    try {
      await assert.rejects(readNetworkSettings(mock),/bounded length|unexpected response opcode|exceeds 1 MiB/);
      assert.equal(mock.writes.filter(packet=>packet.readUInt16BE(2)===0x2000&&packet.readUInt32BE(12)===0).length,0);
    } finally {await mock.close();}
  }
});

test('empty-feeder STAT remains visible as metadata and successful FIN releases the session',async()=>{
  const mock=await fixture({statTags:'#ERRADF PE  #---'});
  try {const result=await readNetworkSettings(mock);assert.deepEqual(result.settings.STAT,[{name:'ERR',value:'ADF PE  '}]);assert.deepEqual(result.warnings,[]);}
  finally {await mock.close();}
});

test('FIN failure is a warning and cannot prevent outer unlock or descriptor cleanup',async()=>{
  const mock=await fixture({finTags:'#ERRADF BUSY#---'});
  try {
    const result=await readNetworkSettings(mock);assert.match(result.warnings[0],/Finalize/);
    await eventually(()=>mock.writes.at(-1)?.readUInt16BE(2)===0x2101);await eventually(()=>mock.clients.size===0);
  } finally {await mock.close();}
});

test('primary read failure wins over cleanup failure and each release step remains bounded',async()=>{
  const mock=await fixture({hang:'INFO',timeoutMs:20,finTags:'#ERRADF BUSY#---'});
  try {
    await assert.rejects(readNetworkSettings(mock),error=>{assert.match(error.message,/read timed out/);assert.match(error.warnings[0],/Finalize/);return true;});
    await eventually(()=>mock.writes.at(-1)?.readUInt16BE(2)===0x2101);await eventually(()=>mock.clients.size===0);
  } finally {await mock.close();}
});

test('a stalled FIN still sends outer unlock using a separate cleanup budget',async()=>{
  const mock=await fixture({hang:'FIN ',timeoutMs:20});
  try {
    const result=await readNetworkSettings(mock);assert.match(result.warnings[0],/timed out/);
    await eventually(()=>mock.writes.at(-1)?.readUInt16BE(2)===0x2101);await eventually(()=>mock.clients.size===0);
  } finally {await mock.close();}
});

test('abort closes the socket and pre-aborted requests never connect',async()=>{
  const mock=await fixture({hang:'INFO'});
  try {
    const abort=new AbortController(),pending=readNetworkSettings({...mock,signal:abort.signal});
    await eventually(()=>mock.commands().includes('INFO'));abort.abort();await assert.rejects(pending,/stopped/);
    await eventually(()=>mock.clients.size===0);
    const before=mock.writes.length;await assert.rejects(readNetworkSettings({...mock,signal:AbortSignal.abort()}),/stopped/);
    assert.equal(mock.writes.length,before);
  } finally {await mock.close();}
});

test('numeric hosts and bounded ports/timeouts are validated before any connection',()=>{
  for(const options of [{host:'scanner.local'},{host:'https://127.0.0.1'},{host:'127.0.0.1',port:0},
    {host:'127.0.0.1',timeoutMs:0},{host:'127.0.0.1',deadlineMs:Infinity},{host:'127.0.0.1',port:1.5}])assert.throws(()=>new NodeFramedSession(options));
  assert.throws(()=>networkPacket(0x2000,Buffer.alloc(0),2**30),/Invalid network frame/);
});
