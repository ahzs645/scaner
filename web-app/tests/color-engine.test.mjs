import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import jpeg from 'jpeg-js';
import {inspectICC,MAX_ICC_BYTES} from '../dist/color/icc.js';
import {transformRGBA,transformRGB,exportSRGBProfile,validateICC} from '../dist/color/engine.js';
import {decodeCapture,inspectCaptureJPEG,validateCaptureJPEG,MAX_CAPTURE_BYTES} from '../dist/color/decode.js';
const execute=promisify(execFile);
const view=bytes=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
function signature(bytes,offset,value){for(let i=0;i<4;i++)bytes[offset+i]=value.charCodeAt(i);}
const mutate=async(fn)=>{const bytes=await exportSRGBProfile();fn(bytes,view(bytes));return bytes;};
async function linearProfile(){return mutate((bytes,v)=>{
  signature(bytes,12,'scnr');
  for(const tag of inspectICC(bytes).tags.filter(t=>/[rgb]TRC/.test(t.signature))){
    signature(bytes,tag.offset,'para');v.setUint16(tag.offset+8,0);v.setUint32(tag.offset+12,65536);
  }
});}
const encode=(v)=>Math.round(255*(v<=0.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-0.055));
const delta=(a,b,tolerance=1)=>{assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<=tolerance,`sample ${i}: ${a[i]} vs ${b[i]}`);};
// Own synthetic ICCv2 RGB input: LittleCMS-created 2x2x2 A2B0 LUT mapping
// linear sRGB primary vertices to D50 XYZ. No copied vendor/scanner profile.
const lutProfile=()=>Uint8Array.from(Buffer.from('AAACCGxjbXMCQAAAc2NuclJHQiBYWVogB+gAAQABAAAAAAAAYWNzcEFQUEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1sY21zAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEd3RwdAAAALQAAAAUZGVzYwAAAMgAAACkY3BydAAAAWwAAAAgQTJCMAAAAYwAAAB8WFlaIAAAAAAAAPbWAAEAAAAA0y1kZXNjAAAAAAAAABhTeW50aGV0aWMgUkdCIGlucHV0IExVVAAAAAAAAAAAGABTAHkAbgB0AGgAZQB0AGkAYwAgAFIARwBCACAAaQBuAHAAdQB0ACAATABVAFQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHRleHQAAAAAU3ludGhldGljIFJHQiBpbnB1dCBMVVQAbWZ0MgAAAAADAwIAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAIAAgAA//8AAP//AAD//wAAAAAAABJQB8JbajFKW8MMbkOaY4Vn2DfRHHsByUoiJD1dM2kbeD4ONntsgABpoAAA//8AAP//AAD//w==','base64'));
// Own nonsensitive 32x24 RGB gradient, native JPEG 4:2:2, one restart per row.
const restartJPEG=()=>Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAYACADASEAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/90ABAAC/9oADAMBAAIRAxEAPwD899I8F/d/d/pXbaR4L+7+7/St8PUPZyLM9tTt9I8F/d/d/pXbaR4L+7+7/Svo6FQ/ojIsz21P/9D5x0jwX9393+ldvpHgv7v7v9K4cPUPgcizPbU7bSPBf3f3f6V2+keC/u/u/wBK+jw9XY/ofIsz21P/0czSPBf3f3f6V22keC/u/u/0r5zD1dj+asizPbU7fSPBf3f3f6V22keC/u/u/wBK+jw9TY/ofIsz21P/2Q==','base64'));

test('generated destination ICC has strict metadata, description and independent export copies',async()=>{
  const a=await exportSRGBProfile(),b=await exportSRGBProfile(),metadata=inspectICC(a);
  assert.equal(metadata.deviceClass,'mntr');assert.equal(metadata.colorSpace,'RGB ');assert.equal(metadata.pcs,'XYZ ');
  assert.match(metadata.description,/sRGB/i);assert.equal(metadata.declaredSize,a.length);assert.ok(metadata.tags.some(t=>t.signature==='rTRC'));
  a.fill(0);assert.notEqual(b[36],0);assert.equal(inspectICC(b.buffer).description,metadata.description);
  const padded=new Uint8Array(b.length+20);padded.set(b,10);assert.deepEqual(inspectICC(padded.subarray(10,10+b.length)),metadata);
});

test('ICC rejects wrong declared size, signature, version, header reserved and rendering intent',async()=>{
  for(const fn of [(_b,v)=>v.setUint32(0,1),(b)=>signature(b,36,'nope'),b=>b[8]=5,b=>b[100]=1,(_b,v)=>v.setUint32(64,4)]){
    const b=await mutate(fn);assert.throws(()=>inspectICC(b),/ICC/);
  }
});

test('ICC rejects output/link/abstract profiles and non-RGB/invalid PCS sources',async()=>{
  for(const c of ['prtr','link','abst','nmcl','spac']){const b=await mutate(b=>signature(b,12,c));assert.throws(()=>inspectICC(b),/input or display/);}
  for(const [p,s] of [[16,'CMYK'],[16,'GRAY'],[20,'RGB ']]){const b=await mutate(b=>signature(b,p,s));assert.throws(()=>inspectICC(b),/RGB|connection space/);}
});

test('ICC bounds reject tag overflows, table aliases, duplicate signatures and multilingual string escape',async()=>{
  const mutations=[(_b,v)=>v.setUint32(128,4097),(_b,v)=>v.setUint32(136,4),(_b,v)=>v.setUint32(136,0xfffffffc),(_b,v)=>v.setUint32(140,0xffffffff),
    b=>signature(b,144,'desc'),(b,v)=>{const desc=inspectICC(b).tags.find(t=>t.signature==='desc');v.setUint32(desc.offset+24,desc.size+8);}];
  for(const fn of mutations){const b=await mutate(fn);assert.throws(()=>inspectICC(b),/ICC/);}
  assert.throws(()=>inspectICC(new Uint8Array(131)),/132/);
  assert.throws(()=>inspectICC(new Uint8Array(MAX_ICC_BYTES+1)),/4 MiB/);
});

test('sRGB identity transforms preserve RGB and every alpha value without changing input',async()=>{
  const profile=await exportSRGBProfile(),rgba=new Uint8ClampedArray(256*4);
  for(let i=0;i<256;i++)rgba.set([i,255-i,(i*17)%256,i],4*i);
  const original=rgba.slice(),result=await transformRGBA(rgba,256,1,profile);
  delta(result,original);assert.deepEqual(rgba,original);assert.notEqual(result,rgba);
  for(let i=0;i<256;i++)assert.equal(result[i*4+3],original[i*4+3]);
});

test('linear RGB input converts to nonlinear sRGB, including near-black transfer function',async()=>{
  const source=await linearProfile(),input=new Uint8Array(256*3);
  for(let i=0;i<256;i++)input.fill(i,i*3,i*3+3);
  const result=await transformRGB(input,256,1,source);
  delta(result,Uint8Array.from(input,v=>encode(v/255)),2);
  assert.ok(result[64*3]>input[64*3]+60,'conversion is not a profile assignment/no-op');
});

test('actual A2B0 LUT source transforms through LittleCMS without matrix-tag fallback',async()=>{
  const p=lutProfile(),metadata=inspectICC(p);
  assert.equal(metadata.deviceClass,'scnr');assert.ok(metadata.tags.some(t=>t.signature==='A2B0'&&t.type==='mft2'));
  assert.ok(!metadata.tags.some(t=>t.signature==='rXYZ'));await validateICC(p);
  const input=new Uint8Array([0,0,0,64,64,64,128,128,128,255,255,255]);
  delta(await transformRGB(input,4,1,p),Uint8Array.from(input,v=>encode(v/255)),2);
  const oversized=Uint8Array.from(p),tag=metadata.tags.find(t=>t.signature==='A2B0');oversized[tag.offset+10]=255;
  assert.throws(()=>inspectICC(oversized),/LUT data exceeds/);
});

test('ICC curve announced counts are validated before the engine allocates tables',async()=>{
  const p=await mutate((b,v)=>{const tag=inspectICC(b).tags.find(t=>t.signature==='rTRC');signature(b,tag.offset,'curv');v.setUint32(tag.offset+8,0xffffffff);});
  assert.throws(()=>inspectICC(p),/curve data bounds/);
});

test('RGBA block boundary retains ordering and alpha for multiple bounded LCMS blocks',async()=>{
  const n=32770,input=new Uint8ClampedArray(n*4),profile=await linearProfile();
  for(let i=0;i<n;i++)input.set([i%256,(i*3)%256,(i*7)%256,i%255],i*4);
  const result=await transformRGBA(input,n,1,profile);
  for(const i of [0,1,32766,32767,32768,32769]){for(let c=0;c<3;c++)assert.ok(Math.abs(result[i*4+c]-encode(input[i*4+c]/255))<=2);assert.equal(result[i*4+3],input[i*4+3]);}
});

test('invalid raster/profile inputs reject before transform and a later valid transform still works',async()=>{
  const p=await exportSRGBProfile();
  for(const [input,w,h] of [[new Uint8ClampedArray(4),0,1],[new Uint8ClampedArray(4),1.5,1],[new Uint8ClampedArray(4),1,2],[new Uint8ClampedArray(4),40000001,1]])await assert.rejects(transformRGBA(input,w,h,p),/raster/);
  await assert.rejects(transformRGBA(new Uint8Array(4),1,1,p),/Uint8ClampedArray/);
  await assert.rejects(transformRGB(new Uint8Array(3),1,1,new Uint8Array(MAX_ICC_BYTES+1)),/4 MiB/);
  const bad=await mutate(b=>{const m=inspectICC(b);for(const tag of m.tags.filter(t=>/[rgb]TRC/.test(t.signature))){const index=m.tags.indexOf(tag);signature(b,132+index*12,tag.signature[0].toUpperCase()+tag.signature.slice(1));}});
  await assert.rejects(validateICC(bad),/LittleCMS/);
  delta(await transformRGB(new Uint8Array([2,100,254]),1,1,p),new Uint8Array([2,100,254]));
});

test('raw JPEG decode ignores embedded ICC, preserves raw decoded sample bytes and opaque alpha',async()=>{
  const raw=new Uint8Array(8*8*4);for(let i=0;i<64;i++)raw.set([100,150,200,255],i*4);
  const jpegBytes=jpeg.encode({data:raw,width:8,height:8},100).data;
  const profile=await linearProfile(),payload=new Uint8Array(14+profile.length);
  payload.set(new TextEncoder().encode('ICC_PROFILE\0'));payload[12]=1;payload[13]=1;payload.set(profile,14);
  const tagged=new Uint8Array(jpegBytes.length+payload.length+4);tagged.set(jpegBytes.subarray(0,2));tagged.set([255,226,(payload.length+2)>>8,(payload.length+2)&255],2);tagged.set(payload,6);tagged.set(jpegBytes.subarray(2),6+payload.length);
  const a=await decodeCapture(new Blob([jpegBytes])),b=await decodeCapture(new Blob([tagged]));
  assert.equal(a.width,8);assert.equal(a.height,8);assert.deepEqual(a,b);for(let i=3;i<a.data.length;i+=4)assert.equal(a.data[i],255);
  const reference=jpeg.decode(jpegBytes,{useTArray:true,formatAsRGBA:true});assert.deepEqual([...a.data],[...reference.data]);
});

test('JPEG decoder refuses oversized headers, CMYK frames, malformed segments and non-JPEG before allocation',async()=>{
  assert.throws(()=>inspectCaptureJPEG(new Uint8Array([1,2,3,4])),/JPEG/);
  assert.throws(()=>inspectCaptureJPEG(new Uint8Array([255,216,255,226,255,255])),/bounds/);
  const header=(w,h,c)=>new Uint8Array([255,216,255,192,0,8+3*c,8,h>>8,h&255,w>>8,w&255,c,...Array.from({length:c},(_,i)=>[i+1,17,0]).flat()]);
  assert.throws(()=>inspectCaptureJPEG(header(65535,65535,3)),/40 million/);
  assert.throws(()=>inspectCaptureJPEG(header(8,8,4)),/RGB/);
  await assert.rejects(decodeCapture(new Blob([new Uint8Array(MAX_CAPTURE_BYTES+1)])),/64 MiB/);
  await assert.rejects(decodeCapture(new Blob([header(8,8,3)])),/JPEG|marker|offset|EOI|SOI/i);
});

test('legal repeated FF fill before restart markers decodes identically with strict entropy decoding',async()=>{
  const clean=restartJPEG(),filled=[];
  for(let i=0;i<clean.length;i++){if(clean[i]===255&&clean[i+1]>=208&&clean[i+1]<=215)filled.push(...Array(18).fill(255));filled.push(clean[i]);}
  assert.throws(()=>jpeg.decode(Uint8Array.from(filled),{useTArray:true,tolerantDecoding:false}),/unknown JPEG marker ffd0/,'reproduces pinned upstream defect');
  const a=await decodeCapture(new Blob([clean])),b=await decodeCapture(new Blob([Uint8Array.from(filled)]));
  assert.deepEqual(b,a);assert.equal(b.width,32);assert.equal(b.height,24);
});

test('strict capture validation rejects missing EOI, removed/reordered restarts and truncated entropy',async()=>{
  const clean=restartJPEG(),first=clean.findIndex((v,i)=>v===255&&clean[i+1]===208);
  assert.ok(first>0);
  const wrong=clean.slice();wrong[first+1]=209;
  const removed=new Uint8Array(clean.length-2);removed.set(clean.subarray(0,first));removed.set(clean.subarray(first+2),first);
  for(const bytes of [clean.subarray(0,clean.length-2),wrong,removed]){assert.throws(()=>validateCaptureJPEG(bytes),/JPEG/);await assert.rejects(decodeCapture(new Blob([bytes])),/JPEG/);}
  const truncated=new Uint8Array(clean.length-12);truncated.set(clean.subarray(0,clean.length-14));truncated.set([255,217],truncated.length-2);
  await assert.rejects(decodeCapture(new Blob([truncated])),/marker|huffman|JPEG/i);
});

test('actual locally saved USB/network scanner JPEGs decode and agree with native libjpeg-turbo',async t=>{
  const root=process.env.SCAN_STUDIO_FIXTURES??fileURLToPath(new URL('../../scans/',import.meta.url));
  const paths=['network/07218250-75ee-4c1e-8b6c-ad012ec9f0e5/001-front.jpg','network/07218250-75ee-4c1e-8b6c-ad012ec9f0e5/001-back.jpg',
    'browser-only/597516cf-1689-4b53-8fc1-e2dd7238210d/001-front.jpg','browser-only/597516cf-1689-4b53-8fc1-e2dd7238210d/001-back.jpg'];
  try{await Promise.all(paths.map(p=>access(join(root,p))));}catch{t.skip('Private scanner captures stay local and are not committed');return;}
  const directory=await mkdtemp(join(tmpdir(),'scanner-jpeg-native-'));
  let nativeAvailable=true;try{await execute('python3',['-c',"import ctypes.util,sys;sys.exit(0 if ctypes.util.find_library('turbojpeg') else 1)"]);}catch{nativeAvailable=false;}
  // FASTUPSAMPLE matches jpeg-js's nearest-neighbor chroma reconstruction.
  // STOPONWARNING makes this native comparison reject damaged/truncated data.
  const nativeProgram=`import sys,ctypes as C,ctypes.util\nl=C.CDLL(ctypes.util.find_library('turbojpeg'));P=C.c_void_p;U=C.c_ulong;I=C.c_int\nfor name,ret,args in [('tjInitDecompress',P,[]),('tjDecompressHeader3',I,[P,P,U,C.POINTER(I),C.POINTER(I),C.POINTER(I),C.POINTER(I)]),('tjDecompress2',I,[P,P,U,P,I,I,I,I,I]),('tjDestroy',I,[P])]:\n f=getattr(l,name);f.restype=ret;f.argtypes=args\nb=open(sys.argv[1],'rb').read();src=C.create_string_buffer(b);h=l.tjInitDecompress();w=I();height=I();sub=I();space=I()\ntry:\n assert l.tjDecompressHeader3(h,src,len(b),C.byref(w),C.byref(height),C.byref(sub),C.byref(space))==0\n out=(C.c_ubyte*(w.value*height.value*3))();assert l.tjDecompress2(h,src,len(b),out,w.value,0,height.value,0,256|8192)==0;open(sys.argv[2],'wb').write(bytes(out))\nfinally:l.tjDestroy(h)`;
  try {
    for(let index=0;index<paths.length;index++)await t.test(paths[index],async()=>{
      const path=join(root,paths[index]),bytes=await readFile(path),image=await decodeCapture(new Blob([bytes]));
      assert.equal(image.width,1696);assert.equal(image.height,2200);assert.equal(image.data.length,1696*2200*4);
      for(let i=3;i<image.data.length;i+=4)assert.equal(image.data[i],255);
      if(!nativeAvailable){t.diagnostic('Native comparison unavailable; actual capture decode still checked');return;}
      const output=join(directory,index+'.rgb');await execute('python3',['-c',nativeProgram,path,output]);const rgb=await readFile(output);
      let max=0,sum=0;for(let i=0;i<rgb.length;i++){const difference=Math.abs(rgb[i]-image.data[Math.floor(i/3)*4+i%3]);max=Math.max(max,difference);sum+=difference;}
      const mean=sum/rgb.length;t.diagnostic('Native RGB max difference '+max+', mean '+mean.toFixed(6));
      assert.ok(max<=4&&mean<0.6,'independent IDCT/rounding agree within bounded per-channel error');
    });
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('WASM linear transform agrees with independent native LittleCMS through Pillow',async t=>{
  try{await execute('python3',['-c','from PIL import ImageCms']);}catch{t.skip('Pillow native LittleCMS unavailable');return;}
  const p=await linearProfile(),dest=await exportSRGBProfile(),input=Uint8Array.from({length:256*3},(_,i)=>i%256);
  const program=`import sys,json,base64,io\nfrom PIL import Image,ImageCms\nd=json.loads(sys.argv[1]);src=ImageCms.ImageCmsProfile(io.BytesIO(base64.b64decode(d['src'])));dst=ImageCms.ImageCmsProfile(io.BytesIO(base64.b64decode(d['dst'])));im=Image.frombytes('RGB',(256,1),base64.b64decode(d['rgb']));out=ImageCms.profileToProfile(im,src,dst,renderingIntent=1,outputMode='RGB');print(base64.b64encode(out.tobytes()).decode())`;
  const arg=JSON.stringify({src:Buffer.from(p).toString('base64'),dst:Buffer.from(dest).toString('base64'),rgb:Buffer.from(input).toString('base64')});
  const native=(await execute('python3',['-c',program,arg])).stdout.trim();delta(await transformRGB(input,256,1,p),Buffer.from(native,'base64'),1);
});
