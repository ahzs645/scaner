import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createZip} from '../dist/zip.js';

async function readIndependently(archive){
 const bytes=Buffer.from(await archive.arrayBuffer());
 const result=spawnSync('python3',['-c',`import sys,io,zipfile,json
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 assert z.testzip() is None
 print(json.dumps([dict(name=i.filename,method=i.compress_type,size=i.file_size,compressed=i.compress_size,crc=i.CRC,flags=i.flag_bits,data=z.read(i.filename).hex()) for i in z.infolist()]))
`],{input:bytes,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}

test('two JPEGs round-trip unchanged with independent ZIP CRC and metadata validation',async()=>{
 const entries=[{name:'001-front.jpg',data:Uint8Array.of(255,216,0,35,255,217)},
  {name:'001-back.jpg',data:Uint8Array.of(255,216,42,43,44,255,217)}];
 const zip=createZip(entries);assert.equal(zip.type,'application/zip');
 const files=await readIndependently(zip);
 assert.deepEqual(files.map(file=>file.name),entries.map(entry=>entry.name));
 for(const [index,file] of files.entries()){
  assert.equal(file.data,Buffer.from(entries[index].data).toString('hex'));
  assert.equal(file.method,0);assert.equal(file.size,entries[index].data.length);assert.equal(file.compressed,file.size);
  assert.equal(file.flags&0x0800,0x0800);
 }
});

test('ZIP snapshots caller data and accepts UTF-8 filenames and empty files',async()=>{
 const data=Uint8Array.of(1,2,3);const zip=createZip([{name:'café.jpg',data},{name:'empty.jpg',data:new Uint8Array()}]);data.fill(0);
 const files=await readIndependently(zip);assert.equal(files[0].name,'café.jpg');assert.equal(files[0].data,'010203');assert.equal(files[1].size,0);
});

test('an empty archive is structurally valid',async()=>{assert.deepEqual(await readIndependently(createZip([])),[]);});

test('ZIP rejects path separators NUL empty names and oversized UTF-8 filename fields',()=>{
 for(const name of ['', '../file.jpg','dir/file.jpg','dir\\file.jpg','file\0.jpg','é'.repeat(32768)])
  assert.throws(()=>createZip([{name,data:new Uint8Array()}]),/Invalid ZIP filename|size limit/);
});

test('ZIP entry count rejects ZIP64-sized batches before writing entries',()=>{
 assert.throws(()=>createZip(Array.from({length:65536},()=>({name:'x.jpg',data:new Uint8Array()}))),/Too many ZIP entries/);
});
