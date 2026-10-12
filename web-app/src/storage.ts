import type {ColorDeviceIdentity} from './color/identity.js';
import type {ScanOptions} from './planner.js';
import type {CapturedImage} from './protocol.js';
import {transformGeometry,validateRecipe} from './processing/types.js';
import type {ProcessingResult,ProcessingRecipe,SavedEdit} from './processing/types.js';
export type {SavedEdit};
export interface Job {
  id:string; created:string; options:ScanOptions; status:'scanning'|'complete'|'failed';
  images:number; bytes:number; error?:string; warnings?:string[]; driverId?:string; deviceLabel?:string; deviceIdentity?:ColorDeviceIdentity;
}
export interface SavedImage {jobId:string; filename:string; sheet:number; side:'front'|'back'; blob:Blob; width:number; height:number}
export class ScanStore {
  private database?:Promise<IDBDatabase>;
  constructor(private name='ff680w-browser-v1') {}
  private open():Promise<IDBDatabase> {
    return this.database??=new Promise((resolve,reject)=>{
      const request=indexedDB.open(this.name,2);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains('jobs'))db.createObjectStore('jobs',{keyPath:'id'});
        if(!db.objectStoreNames.contains('images'))db.createObjectStore('images',{keyPath:['jobId','filename']}).createIndex('job','jobId');
        if(!db.objectStoreNames.contains('edits'))db.createObjectStore('edits',{keyPath:['jobId','filename']}).createIndex('job','jobId');
      };
      request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();this.database=undefined;};resolve(request.result);}; request.onerror=()=>{this.database=undefined; reject(request.error);};
      request.onblocked=()=>reject(Error('Close other tabs using scanner storage and retry'));
    });
  }
  private complete(transaction:IDBTransaction):Promise<void> {
    return new Promise((resolve,reject)=>{
      transaction.oncomplete=()=>resolve(); transaction.onabort=()=>reject(transaction.error??Error('Browser storage transaction aborted'));
      transaction.onerror=()=>reject(transaction.error??Error('Browser storage failed; completed images remain available'));
    });
  }
  async createJob(options:ScanOptions,driver?:{driverId:string;deviceLabel:string;deviceIdentity?:ColorDeviceIdentity}):Promise<Job> {
    const job:Job={id:crypto.randomUUID(),created:new Date().toISOString(),options:{...options},status:'scanning',images:0,bytes:0,...(driver?{driverId:driver.driverId,deviceLabel:driver.deviceLabel,deviceIdentity:driver.deviceIdentity?structuredClone(driver.deviceIdentity):undefined}:{})};
    const db=await this.open(), tx=db.transaction('jobs','readwrite'); const done=this.complete(tx);
    tx.objectStore('jobs').add(job); await done; return job;
  }
  async saveImage(jobId:string,captured:CapturedImage):Promise<SavedImage> {
    const blob=new Blob([Uint8Array.from(captured.image)],{type:'image/jpeg'});
    // Native browser decoding checks real JPEG validity, beyond SOI/EOI markers.
    const decoded=await createImageBitmap(blob); const width=decoded.width,height=decoded.height; decoded.close();
    const image:SavedImage={jobId,filename:captured.filename,sheet:captured.sheet,side:captured.side,blob,width,height};
    const db=await this.open(), tx=db.transaction(['jobs','images'],'readwrite'), done=this.complete(tx);
    const request=tx.objectStore('jobs').get(jobId);
    request.onsuccess=()=>{
      const job=request.result as Job|undefined;
      if(!job||job.status!=='scanning'||job.bytes+blob.size>512*1024*1024){tx.abort(); return;}
      tx.objectStore('images').add(image); job.images++; job.bytes+=blob.size; tx.objectStore('jobs').put(job);
    };
    await done; return image;
  }
  async finish(id:string,status:'complete'|'failed',error?:string,warnings:string[]=[]):Promise<void> {
    const db=await this.open(),tx=db.transaction('jobs','readwrite'),done=this.complete(tx); const store=tx.objectStore('jobs'),request=store.get(id);
    request.onsuccess=()=>{const job=request.result as Job|undefined;if(!job){tx.abort();return;}store.put({...job,status,error,warnings});}; await done;
  }
  async jobs():Promise<Job[]> {
    const db=await this.open();return new Promise((resolve,reject)=>{const request=db.transaction('jobs').objectStore('jobs').getAll();request.onsuccess=()=>resolve((request.result as Job[]).sort((a,b)=>b.created.localeCompare(a.created)));request.onerror=()=>reject(request.error);});
  }
  async images(id:string):Promise<SavedImage[]> {
    const db=await this.open();return new Promise((resolve,reject)=>{const request=db.transaction('images').objectStore('images').index('job').getAll(id);request.onsuccess=()=>resolve((request.result as SavedImage[]).sort((a,b)=>a.sheet-b.sheet||(a.side===b.side?0:a.side==='front'?-1:1)));request.onerror=()=>reject(request.error);});
  }
  async edits(id:string):Promise<SavedEdit[]> {
    const db=await this.open();return new Promise((resolve,reject)=>{const request=db.transaction('edits').objectStore('edits').index('job').getAll(id);request.onsuccess=()=>resolve(request.result as SavedEdit[]);request.onerror=()=>reject(request.error);});
  }
  /** The capture stores are read-only here. Recipe history can regenerate up to
   * 20 previous revisions from the original; replacing an edit is atomic. */
  async saveEdit(jobId:string,filename:string,result:ProcessingResult,historyOverride?:ProcessingRecipe[],redoOverride:ProcessingRecipe[]=[]):Promise<SavedEdit> {
    const db=await this.open(),tx=db.transaction(['images','edits'],'readwrite'),done=this.complete(tx);
    let saved:SavedEdit|undefined,validationError:unknown;
    const fail=(error:unknown)=>{validationError=error;tx.abort();};
    const capture=tx.objectStore('images').get([jobId,filename]);
    capture.onsuccess=()=>{
      try {
        const original=capture.result as SavedImage|undefined;if(!original)throw Error('Original capture is missing');
        const geometry=transformGeometry(result.recipe,original.width,original.height);
        if(result.width!==geometry.width||result.height!==geometry.height||!(result.blob instanceof Blob)||!result.blob.size||result.blob.size>64*1024*1024)throw Error('Invalid processed image dimensions or bytes');
        const edited=result.recipe.rotation!==0||result.recipe.crop!==null||!!result.recipe.color;
        if(result.blob.type!==(edited?'image/png':original.blob.type))throw Error('Processed pages must be lossless PNGs');
        const previous=tx.objectStore('edits').get([jobId,filename]);
        previous.onsuccess=()=>{
          try {
            const record=previous.result as SavedEdit|undefined;
            const history=historyOverride??[...(record?.history??[]),record?.recipe??{version:1,rotation:0,crop:null}].slice(-20);
            if(history.length>20||redoOverride.length>20)throw Error('Edit history exceeds 20 revisions');
            for(const recipe of [...history,...redoOverride])validateRecipe(recipe,original.width,original.height);
            const entries=tx.objectStore('edits').index('job').getAll(jobId);
            entries.onsuccess=()=>{
              const bytes=(entries.result as SavedEdit[]).filter(edit=>edit.filename!==filename).reduce((sum,edit)=>sum+edit.blob.size,0)+result.blob.size;
              if(bytes>512*1024*1024){fail(Error('Processed pages exceed the 512 MiB job budget'));return;}
              saved=structuredClone({...result,jobId,filename,updated:new Date().toISOString(),history,redo:redoOverride});tx.objectStore('edits').put(saved);
            };
          }catch(error){fail(error);}
        };
      }catch(error){fail(error);}
    };
    try{await done;}catch(error){throw validationError??error;}
    return saved!;
  }
}
