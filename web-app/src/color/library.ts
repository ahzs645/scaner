import {validateProfile} from './validation.js';
import {inspectICC} from './icc.js';
import type {ProfileRecord} from './types.js';
const MAX_PROFILE=4*1024*1024;
export async function profileId(bytes:Uint8Array):Promise<string>{const hash=await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes));return 'icc:'+Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');}
export class ColorLibrary {
 private database?:Promise<IDBDatabase>;
 constructor(private name='scan-studio-color-v1',private validator:(bytes:Uint8Array)=>Promise<void>=validateProfile){}
 private open():Promise<IDBDatabase>{return this.database??=new Promise((resolve,reject)=>{const r=indexedDB.open(this.name,1);r.onupgradeneeded=()=>r.result.createObjectStore('profiles',{keyPath:'id'});r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();this.database=undefined;};resolve(r.result);};r.onerror=()=>{this.database=undefined;reject(r.error);};});}
 async save(bytes:Uint8Array,details:{name:string;source:'imported'|'measured';captureSignature?:string;report?:unknown;referenceName?:string;referenceSHA256?:string}):Promise<ProfileRecord>{
  if(!(bytes instanceof Uint8Array)||bytes.length>MAX_PROFILE)throw Error('ICC profiles are limited to 4 MiB');
  const metadata=inspectICC(bytes);if(metadata.deviceClass!=='scnr')throw Error('Import an RGB scanner/input ICC profile, not a display or printer profile');
  await this.validator(bytes);
  const name=details.name.trim().slice(0,160);if(!name)throw Error('Give this profile a name');
  const id=await profileId(bytes),record:ProfileRecord={...details,name,id,metadata,bytes:Uint8Array.from(bytes),created:new Date().toISOString()};
  const db=await this.open(),tx=db.transaction('profiles','readwrite');
  await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??Error('Profile could not be stored'));tx.onerror=()=>reject(tx.error);tx.objectStore('profiles').put(record);});return record;
 }
 async all():Promise<ProfileRecord[]>{const db=await this.open();return new Promise((resolve,reject)=>{const r=db.transaction('profiles').objectStore('profiles').getAll();r.onsuccess=()=>resolve(r.result.sort((a:ProfileRecord,b:ProfileRecord)=>b.created.localeCompare(a.created)));r.onerror=()=>reject(r.error);});}
 async get(id:string):Promise<ProfileRecord>{const db=await this.open();const record:ProfileRecord=await new Promise((resolve,reject)=>{const r=db.transaction('profiles').objectStore('profiles').get(id);r.onsuccess=()=>r.result?resolve(r.result):reject(Error('Color profile is missing; import its ICC file to reproduce this edit'));r.onerror=()=>reject(r.error);});if(await profileId(record.bytes)!==record.id)throw Error('Stored color profile checksum changed');inspectICC(record.bytes);return record;}
}
