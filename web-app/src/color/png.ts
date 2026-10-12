const signature=Uint8Array.of(137,80,78,71,13,10,26,10);
export function crc32(bytes:Uint8Array):number {let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type:string,data:Uint8Array):Uint8Array<ArrayBuffer>{const bytes=new Uint8Array(data.length+12),view=new DataView(bytes.buffer);view.setUint32(0,data.length);bytes.set(new TextEncoder().encode(type),4);bytes.set(data,8);view.setUint32(bytes.length-4,crc32(bytes.subarray(4,-4)));return bytes;}
/** Corrected pixels are already sRGB. Embed the OUTPUT profile, never the
 * scanner source profile, and remove conflicting preexisting color chunks. */
export async function embedSRGBProfile(blob:Blob,profile:Uint8Array):Promise<Blob>{
 if(blob.size>64*1024*1024||profile.length>4*1024*1024)throw Error('Color export exceeds its memory limit');
 const bytes=new Uint8Array(await blob.arrayBuffer());if(!signature.every((v,i)=>bytes[i]===v))throw Error('Color output must be a PNG');
 const compressed=new Uint8Array(await new Response(new Blob([Uint8Array.from(profile)]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
 const prefix=new TextEncoder().encode('sRGB\0\0'),payload=new Uint8Array(prefix.length+compressed.length);payload.set(prefix);payload.set(compressed,prefix.length);
 const output:BlobPart[]=[signature],view=new DataView(bytes.buffer);let offset=8,seenHeader=false,seenEnd=false;
 while(offset<bytes.length){if(offset+12>bytes.length)throw Error('Truncated PNG chunk');const size=view.getUint32(offset);if(size>bytes.length-offset-12)throw Error('Invalid PNG chunk length');const type=new TextDecoder().decode(bytes.subarray(offset+4,offset+8));
  if(offset===8&&(type!=='IHDR'||size!==13))throw Error('Invalid PNG header');
  if(!['iCCP','sRGB','gAMA','cHRM'].includes(type))output.push(bytes.slice(offset,offset+size+12));
  if(type==='IHDR'){if(seenHeader)throw Error('Duplicate PNG header');seenHeader=true;output.push(chunk('iCCP',payload));}
  offset+=size+12;if(type==='IEND'){seenEnd=true;break;}
 }
 if(!seenEnd||offset!==bytes.length)throw Error('Invalid PNG ending');const result=new Blob(output,{type:'image/png'});if(result.size>64*1024*1024)throw Error('Corrected PNG exceeds 64 MiB');return result;
}
