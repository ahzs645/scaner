// ZIP 'stored' entries: keep scanner JPEGs unchanged, with no runtime library.
export interface ZipEntry {name:string; data:Uint8Array}
function crc32(data:Uint8Array):number {
  let crc=0xffffffff;
  for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
export function createZip(entries:ZipEntry[]):Blob {
  if(entries.length>65535)throw Error('Too many ZIP entries');
  const parts:Uint8Array<ArrayBuffer>[]=[],central:Uint8Array<ArrayBuffer>[]=[];let offset=0,centralSize=0;
  for(const entry of entries){
    if(!entry.name||entry.name.includes('/')||entry.name.includes('\\')||entry.name.includes('\0'))throw Error('Invalid ZIP filename');
    const name=new TextEncoder().encode(entry.name),data=Uint8Array.from(entry.data),crc=crc32(data);
    if(name.length>65535||offset+data.length>0xffffffff)throw Error('ZIP size limit exceeded');
    const local=new Uint8Array(30+name.length),l=new DataView(local.buffer);
    l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x0800,true);l.setUint16(12,33,true);
    l.setUint32(14,crc,true);l.setUint32(18,data.length,true);l.setUint32(22,data.length,true);l.setUint16(26,name.length,true);local.set(name,30);
    const directory=new Uint8Array(46+name.length),d=new DataView(directory.buffer);
    d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x0800,true);d.setUint16(14,33,true);
    d.setUint32(16,crc,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);directory.set(name,46);
    parts.push(local,data);central.push(directory);offset+=local.length+data.length;centralSize+=directory.length;
  }
  const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
  return new Blob([...parts,...central,end],{type:'application/zip'});
}
