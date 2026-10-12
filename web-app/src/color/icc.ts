export const MAX_ICC_BYTES = 4 * 1024 * 1024;
export type ICCBytes = Uint8Array | ArrayBuffer;
export interface ICCTag {signature:string;type:string;offset:number;size:number;}
export interface ICCMetadata {
  [key:string]:unknown;
  description:string;deviceClass:'scnr'|'mntr';colorSpace:'RGB ';pcs:'XYZ '|'Lab ';
  version:string;declaredSize:number;tags:ICCTag[];
}
export function iccBytes(input:ICCBytes):Uint8Array {
  if(input instanceof Uint8Array)return input;
  if(input instanceof ArrayBuffer)return new Uint8Array(input);
  throw Error('ICC profile must be bytes');
}
const signature=(bytes:Uint8Array,offset:number)=>String.fromCharCode(...bytes.subarray(offset,offset+4));
const text=(value:string)=>value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,1024);

function curveLength(data:Uint8Array,offset:number):number {
  if(offset+12>data.length)throw Error('ICC curve header bounds are invalid');
  const v=new DataView(data.buffer,data.byteOffset,data.byteLength),type=signature(data,offset);
  let size:number;
  if(type==='curv')size=12+v.getUint32(offset+8)*2;
  else if(type==='para'){
    const type=v.getUint16(offset+8),parameters=[1,3,4,5,7][type];
    if(parameters===undefined)throw Error('ICC parametric curve type is unsupported');
    size=12+parameters*4;
  }else throw Error('ICC LUT curve block is invalid');
  if(size>data.length-offset)throw Error('ICC curve data bounds are invalid');
  return size;
}

function validateTagData(bytes:Uint8Array,tag:ICCTag):void {
  const data=bytes.subarray(tag.offset,tag.offset+tag.size),v=new DataView(data.buffer,data.byteOffset,data.byteLength);
  if(tag.type==='curv'||tag.type==='para'){curveLength(data,0);return;}
  if(tag.type==='XYZ '){if(data.length<20||(data.length-8)%12)throw Error('ICC XYZ tag bounds are invalid');return;}
  if(tag.type==='mft1'||tag.type==='mft2') {
    const base=tag.type==='mft1'?48:52;
    if(data.length<base||data[8]!==3||data[9]!==3||data[10]!<2)throw Error('ICC RGB LUT header bounds are invalid');
    const grid=data[10]!,entries=grid**3*3;
    let expected:number;
    if(tag.type==='mft1')expected=48+256*6+entries;
    else {
      const input=v.getUint16(48),output=v.getUint16(50);
      if(input<2||output<2)throw Error('ICC LUT table counts are invalid');
      expected=52+2*(3*input+entries+3*output);
    }
    if(expected>data.length)throw Error('ICC LUT data exceeds tag bounds');
  }
  if(tag.type==='mAB '||tag.type==='mBA ') {
    if(data.length<32||data[8]!==3||data[9]!==3)throw Error('ICC RGB multi-stage LUT header is invalid');
    const offsets=[12,16,20,24,28].map(p=>v.getUint32(p));
    for(const offset of offsets)if(offset&&(offset<32||offset%4||offset>=data.length))throw Error('ICC multi-stage LUT offset is invalid');
    const matrix=offsets[1]!;
    if(matrix&&matrix+48>data.length)throw Error('ICC LUT matrix bounds are invalid');
    for(const index of [0,2,4]){
      let offset=offsets[index]!;
      if(offset)for(let n=0;n<3;n++)offset+=Math.ceil(curveLength(data,offset)/4)*4;
    }
    const clut=offsets[3]!;
    if(clut){
      if(clut+20>data.length)throw Error('ICC CLUT header bounds are invalid');
      const grid=[data[clut]!,data[clut+1]!,data[clut+2]!],precision=data[clut+16]!;
      if(grid.some(n=>n<2)||![1,2].includes(precision)||clut+20+grid[0]!*grid[1]!*grid[2]!*3*precision>data.length)throw Error('ICC CLUT data exceeds tag bounds');
    }
  }
}

function description(bytes:Uint8Array,tag:ICCTag):string {
  const data=bytes.subarray(tag.offset,tag.offset+tag.size),view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  if(tag.type==='desc') {
    if(data.length<12)throw Error('ICC description is truncated');
    const count=view.getUint32(8);
    if(count<1||count>data.length-12||data[11+count]!==0)throw Error('ICC description has invalid bounds');
    return text(new TextDecoder('ascii').decode(data.subarray(12,11+count)));
  }
  if(tag.type==='mluc') {
    if(data.length<16)throw Error('ICC multilingual description is truncated');
    const count=view.getUint32(8),recordSize=view.getUint32(12),end=16+count*recordSize;
    if(count<1||count>1024||recordSize<12||end>data.length)throw Error('ICC multilingual record bounds are invalid');
    let chosen:{offset:number;length:number}|undefined;
    for(let i=0;i<count;i++) {
      const p=16+i*recordSize,length=view.getUint32(p+4),offset=view.getUint32(p+8);
      if(length%2||offset%2||offset<end||length>data.length-offset)throw Error('ICC multilingual string bounds are invalid');
      if(i===0||signature(data,p)==='enUS')chosen={offset,length};
    }
    if(!chosen)return '';
    let length=Math.min(chosen.length,2048);
    // Do not cut a surrogate pair at the display-description limit.
    if(length<chosen.length&&length>=2){const last=view.getUint16(chosen.offset+length-2);if(last>=0xd800&&last<=0xdbff)length-=2;}
    return text(new TextDecoder('utf-16be',{fatal:true}).decode(data.subarray(chosen.offset,chosen.offset+length)));
  }
  return '';
}

/** Structural validation before any untrusted profile reaches LittleCMS.
 * Both scanner inputs and explicit RGB display/working-space profiles are valid
 * sources. Output, device-link, abstract and named-color profiles are rejected. */
export function inspectICC(input:ICCBytes):ICCMetadata {
  const bytes=iccBytes(input);
  if(bytes.length<132||bytes.length>MAX_ICC_BYTES)throw Error('ICC profile must be 132 bytes to 4 MiB');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),declaredSize=view.getUint32(0);
  if(declaredSize!==bytes.length)throw Error('ICC declared size does not match its bytes');
  if(signature(bytes,36)!=='acsp')throw Error('ICC acsp signature is missing');
  const major=bytes[8]!,minor=bytes[9]!;
  if(major!==2&&major!==4)throw Error('Only ICC version 2 or 4 profiles are supported');
  const deviceClass=signature(bytes,12),colorSpace=signature(bytes,16),pcs=signature(bytes,20);
  if(deviceClass!=='scnr'&&deviceClass!=='mntr')throw Error('ICC source must be an input or display profile');
  if(colorSpace!=='RGB ')throw Error('ICC source must use RGB channels');
  if(pcs!=='XYZ '&&pcs!=='Lab ')throw Error('ICC profile connection space must be XYZ or Lab');
  if(view.getUint32(64)>3)throw Error('ICC rendering intent is invalid');
  for(let i=100;i<128;i++)if(bytes[i]!==0)throw Error('ICC header reserved bytes must be zero');
  const count=view.getUint32(128),end=132+12*count;
  if(count<1||count>4096||end>bytes.length)throw Error('ICC tag table bounds are invalid');
  const tags:ICCTag[]=[],seen=new Set<string>();
  for(let i=0;i<count;i++) {
    const p=132+12*i,name=signature(bytes,p),offset=view.getUint32(p+4),size=view.getUint32(p+8);
    if(!/^[\x20-\x7e]{4}$/.test(name)||seen.has(name))throw Error('ICC tag signature is invalid or duplicated');
    seen.add(name);
    if(offset<end||offset%4||size<8||size>bytes.length-offset)throw Error('ICC tag data bounds are invalid');
    const type=signature(bytes,offset);
    if(!/^[\x20-\x7e]{4}$/.test(type))throw Error('ICC tag type is invalid');
    for(let n=offset+4;n<offset+8;n++)if(bytes[n]!==0)throw Error('ICC tag reserved bytes must be zero');
    tags.push({signature:name,type,offset,size});
  }
  const ranges=[...tags].sort((a,b)=>a.offset-b.offset||a.size-b.size);
  for(let i=1;i<ranges.length;i++) {
    const a=ranges[i-1]!,b=ranges[i]!;
    if(b.offset<a.offset+a.size&&(a.offset!==b.offset||a.size!==b.size))throw Error('ICC tag data overlaps partially');
  }
  const validated=new Set<string>();
  for(const tag of tags){const key=tag.offset+':'+tag.size;if(!validated.has(key)){validateTagData(bytes,tag);validated.add(key);}}
  const desc=tags.find(tag=>tag.signature==='desc');
  // Also check mluc copyright strings so malformed records cannot hide there.
  const checked=new Set<string>();
  for(const tag of tags)if(tag.type==='mluc'||tag.type==='desc'){
    const key=tag.offset+':'+tag.size;
    if(!checked.has(key)){description(bytes,tag);checked.add(key);}
  }
  return {description:desc?description(bytes,desc):'',deviceClass,colorSpace,pcs,
    version:major+'.'+(minor>>4)+'.'+(minor&15),declaredSize,tags};
}
