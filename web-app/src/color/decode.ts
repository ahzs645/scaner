export const MAX_CAPTURE_BYTES=64*1024*1024,MAX_CAPTURE_PIXELS=40_000_000;
interface JPEGDecoder {decode:(bytes:Uint8Array,options:{useTArray:boolean;formatAsRGBA:boolean;tolerantDecoding:boolean;maxResolutionInMP:number;maxMemoryUsageInMB:number})=>{data:Uint8Array;width:number;height:number};}
let decoder:Promise<JPEGDecoder>|undefined;
/** Read frame dimensions/components before decoder allocation. Embedded ICC is
 * intentionally not interpreted here: raw samples go through LittleCMS once. */
export function inspectCaptureJPEG(bytes:Uint8Array):{width:number;height:number;components:number} {
  if(!(bytes instanceof Uint8Array)||bytes.length<4||bytes.length>MAX_CAPTURE_BYTES||bytes[0]!==0xff||bytes[1]!==0xd8)throw Error('Color processing requires a JPEG capture of at most 64 MiB');
  let p=2;
  while(p<bytes.length) {
    if(bytes[p++]!==0xff)throw Error('Invalid JPEG marker before image data');
    while(bytes[p]===0xff)p++;
    const marker=bytes[p++];
    if(marker===undefined||marker===0xda||marker===0xd9)throw Error('JPEG frame dimensions are missing');
    if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
    if(p+2>bytes.length)throw Error('JPEG segment is truncated');
    const length=bytes[p]!*256+bytes[p+1]!;
    if(length<2||length>bytes.length-p)throw Error('JPEG segment bounds are invalid');
    if([0xc0,0xc1,0xc2].includes(marker)) {
      if(length<8)throw Error('JPEG frame header is truncated');
      const height=bytes[p+3]!*256+bytes[p+4]!,width=bytes[p+5]!*256+bytes[p+6]!,components=bytes[p+7]!;
      if(bytes[p+2]!==8||![1,3].includes(components)||length!==8+3*components)throw Error('Only 8-bit RGB/grayscale scanner JPEG captures are supported');
      if(!width||!height||width*height>MAX_CAPTURE_PIXELS)throw Error('JPEG capture exceeds 40 million pixels');
      return {width,height,components};
    }
    if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker))throw Error('Unsupported JPEG frame coding');
    p+=length;
  }
  throw Error('JPEG frame dimensions are missing');
}
/** Validate complete marker/segment framing independently of entropy decoding.
 * Repeated FF fill is legal, but truncated segments, missing EOI, restart order
 * changes and missing restart intervals must never become successful pixels. */
export function validateCaptureJPEG(bytes:Uint8Array):{width:number;height:number;components:number} {
  const frame=inspectCaptureJPEG(bytes);
  let p=2,frameSeen=false,scans=0,interval=0,maxH=1,maxV=1;
  const components=new Map<number,{h:number;v:number}>();
  while(p<bytes.length) {
    if(bytes[p++]!==255)throw Error('Invalid JPEG marker framing');
    while(bytes[p]===255)p++;
    const marker=bytes[p++];
    if(marker===undefined)throw Error('Truncated JPEG marker');
    if(marker===0xd9){if(!frameSeen||!scans||p!==bytes.length)throw Error('Invalid JPEG completion');return frame;}
    if(marker===0xd8||marker===0||marker===1||(marker>=0xd0&&marker<=0xd7))throw Error('Unexpected JPEG marker outside entropy data');
    if(p+2>bytes.length)throw Error('Truncated JPEG segment');
    const length=bytes[p]!*256+bytes[p+1]!,end=p+length;
    if(length<2||end>bytes.length)throw Error('JPEG segment bounds are invalid');
    if([0xc0,0xc1,0xc2].includes(marker)) {
      if(frameSeen)throw Error('Only one JPEG frame is supported');frameSeen=true;
      for(let i=0;i<frame.components;i++){
        const id=bytes[p+8+i*3]!,sample=bytes[p+9+i*3]!,h=sample>>4,v=sample&15;
        if(components.has(id)||h<1||h>4||v<1||v>4)throw Error('Invalid JPEG component sampling');
        components.set(id,{h,v});maxH=Math.max(maxH,h);maxV=Math.max(maxV,v);
      }
    }
    if(marker===0xdd){if(length!==4)throw Error('Invalid JPEG restart interval segment');interval=bytes[p+2]!*256+bytes[p+3]!;}
    if(marker!==0xda){p=end;continue;}
    if(!frameSeen||length<6)throw Error('JPEG scan has no frame');
    const selectors=bytes[p+2]!;
    if(selectors<1||selectors>frame.components||length!==6+2*selectors||++scans>256)throw Error('Invalid JPEG scan selector bounds');
    const selected=new Set<number>();
    for(let i=0;i<selectors;i++){const id=bytes[p+3+i*2]!;if(!components.has(id)||selected.has(id))throw Error('Invalid JPEG scan component');selected.add(id);}
    let expectedUnits:number;
    if(selectors===1){const c=components.get([...selected][0]!)!;expectedUnits=Math.ceil(Math.ceil(frame.width/8)*c.h/maxH)*Math.ceil(Math.ceil(frame.height/8)*c.v/maxV);}
    else expectedUnits=Math.ceil(frame.width/(8*maxH))*Math.ceil(frame.height/(8*maxV));
    const expectedRestarts=interval?Math.floor((expectedUnits-1)/interval):0;
    p=end;let restart=0,count=0;
    while(p<bytes.length) {
      if(bytes[p]!==255){p++;continue;}
      const prefix=p++;while(bytes[p]===255)p++;
      const code=bytes[p];
      if(code===undefined)throw Error('Truncated JPEG entropy marker');
      if(code===0){if(p!==prefix+1)throw Error('Invalid JPEG entropy stuffing');p++;continue;}
      if(code>=0xd0&&code<=0xd7){
        if(!interval||code!==0xd0+restart||++count>expectedRestarts)throw Error('Invalid JPEG restart marker sequence');
        restart=(restart+1)%8;p++;continue;
      }
      p=prefix;break;
    }
    if(count!==expectedRestarts)throw Error('JPEG restart markers are incomplete');
  }
  throw Error('JPEG EOI marker is missing');
}
export async function decodeCapture(blob:Blob):Promise<{data:Uint8ClampedArray;width:number;height:number}> {
  if(!(blob instanceof Blob)||blob.size<4||blob.size>MAX_CAPTURE_BYTES)throw Error('JPEG capture is limited to 64 MiB');
  const bytes=new Uint8Array(await blob.arrayBuffer()),frame=validateCaptureJPEG(bytes);
  decoder??=import(new URL('../vendor/color/jpeg-decoder.js',import.meta.url).href) as Promise<JPEGDecoder>;
  const image=(await decoder).decode(bytes,{useTArray:true,formatAsRGBA:true,tolerantDecoding:false,maxResolutionInMP:40,maxMemoryUsageInMB:512});
  if(image.width!==frame.width||image.height!==frame.height||image.data.length!==frame.width*frame.height*4)throw Error('Decoded JPEG dimensions do not match its frame');
  return {data:new Uint8ClampedArray(image.data.buffer,image.data.byteOffset,image.data.byteLength),width:image.width,height:image.height};
}
