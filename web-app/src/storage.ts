import type {ColorDeviceIdentity} from './color/identity.js';
import type {ScanOptions} from './planner.js';
import type {CapturedImage} from './protocol.js';
import {transformGeometry,validateRecipe} from './processing/types.js';
import type {ProcessingResult,ProcessingRecipe,SavedEdit} from './processing/types.js';
export type {SavedEdit};
export interface CaptureContext {options:ScanOptions;driverId?:string;deviceLabel?:string;deviceIdentity?:ColorDeviceIdentity}
export interface CaptureSession extends CaptureContext {
  id:string;started:string;finished?:string;status:'scanning'|'complete'|'failed';
  sheetOffset:number;images:number;bytes:number;error?:string;warnings?:string[];
}
export interface Job {
  id:string; created:string; options:ScanOptions; status:'scanning'|'complete'|'failed';
  images:number; bytes:number; error?:string; warnings?:string[]; driverId?:string; deviceLabel?:string; deviceIdentity?:ColorDeviceIdentity;
  captures?:CaptureSession[];activeCapture?:string;
}
export interface SavedImage {jobId:string; filename:string; sheet:number; side:'front'|'back'; blob:Blob; width:number; height:number;capture?:CaptureContext;captureId?:string}
/** Older captures inherit their original job metadata; additions carry their own. */
export function imageJob(job:Job,image:SavedImage):Job {return image.capture?{...job,...image.capture}:job;}
function newCapture(options:ScanOptions,driver:Omit<CaptureContext,'options'>,sheetOffset:number):CaptureSession {
  return {...structuredClone(driver),options:structuredClone(options),id:crypto.randomUUID(),started:new Date().toISOString(),status:'scanning',sheetOffset,images:0,bytes:0};
}
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
    const capture=newCapture(options,driver??{},0);job.captures=[capture];job.activeCapture=capture.id;
    const db=await this.open(), tx=db.transaction('jobs','readwrite'); const done=this.complete(tx);
    tx.objectStore('jobs').add(job); await done; return job;
  }
  /** Reopen atomically and allocate sheet names after all existing sides, including
   * partial duplex sheets. Interrupted recovery requires the caller's Web Lock. */
  async beginAppend(id:string,options:ScanOptions,driver:Omit<CaptureContext,'options'>,recoverInterrupted=false):Promise<Job> {
    const db=await this.open(),tx=db.transaction(['jobs','images'],'readwrite'),done=this.complete(tx);
    let saved:Job|undefined,failure:unknown;
    const fail=(error:unknown)=>{failure=error;tx.abort();};
    const request=tx.objectStore('jobs').get(id);
    request.onsuccess=()=>{
      const job=request.result as Job|undefined;
      if(!job){fail(Error('This saved scan is no longer available'));return;}
      if(job.bytes>=512*1024*1024){fail(Error('This scan reached its 512 MiB limit. Start a new document.'));return;}
      if(job.status==='scanning'&&!recoverInterrupted){fail(Error('This scan is already being captured in another window'));return;}
      const images=tx.objectStore('images').index('job').getAll(id);
      images.onsuccess=()=>{
        try{
          const captures=structuredClone(job.captures??[]);
          const previous=captures.find(capture=>capture.id===job.activeCapture);
          if(previous?.status==='scanning'){previous.status='failed';previous.finished=new Date().toISOString();previous.error='Capture interrupted before completion';}
          const offset=(images.result as SavedImage[]).reduce((max,image)=>Math.max(max,image.sheet),0);
          const capture=newCapture(options,driver,offset);captures.push(capture);
          saved={...job,status:'scanning',error:undefined,captures,activeCapture:capture.id};
          tx.objectStore('jobs').put(saved);
        }catch(error){fail(error);}
      };
    };
    try{await done;}catch(error){throw failure??error;}return saved!;
  }
  async saveImage(jobId:string,captured:CapturedImage,captureId?:string):Promise<SavedImage> {
    if(!Number.isSafeInteger(captured.sheet)||captured.sheet<1||!['front','back'].includes(captured.side))throw Error('Invalid captured sheet or side');
    const blob=new Blob([Uint8Array.from(captured.image)],{type:'image/jpeg'});
    // Native browser decoding checks real JPEG validity, beyond SOI/EOI markers.
    const decoded=await createImageBitmap(blob); const width=decoded.width,height=decoded.height; decoded.close();
    let image:SavedImage|undefined;
    const db=await this.open(), tx=db.transaction(['jobs','images'],'readwrite'), done=this.complete(tx);
    const request=tx.objectStore('jobs').get(jobId);
    request.onsuccess=()=>{
      const job=request.result as Job|undefined;
      if(!job||job.status!=='scanning'||job.bytes+blob.size>512*1024*1024||(captureId&&captureId!==job.activeCapture)){tx.abort(); return;}
      const session=job.captures?.find(capture=>capture.id===job.activeCapture);
      const sheet=captured.sheet+(session?.sheetOffset??0);
      if(!Number.isSafeInteger(sheet)){tx.abort();return;}
      const filename=session?.sheetOffset?String(sheet).padStart(3,'0')+'-'+captured.side+'.jpg':captured.filename;
      image={jobId,filename,sheet,side:captured.side,blob,width,height,...(session?{captureId:session.id,capture:{options:structuredClone(session.options),driverId:session.driverId,deviceLabel:session.deviceLabel,deviceIdentity:session.deviceIdentity?structuredClone(session.deviceIdentity):undefined}}:{})};
      if(session){session.images++;session.bytes+=blob.size;}
      tx.objectStore('images').add(image); job.images++; job.bytes+=blob.size; tx.objectStore('jobs').put(job);
    };
    await done; return image!;
  }
  async finish(id:string,status:'complete'|'failed',error?:string,warnings:string[]=[],captureId?:string):Promise<void> {
    const db=await this.open(),tx=db.transaction('jobs','readwrite'),done=this.complete(tx); const store=tx.objectStore('jobs'),request=store.get(id);
    request.onsuccess=()=>{
      const job=request.result as Job|undefined;if(!job||(captureId&&captureId!==job.activeCapture)){tx.abort();return;}
      const session=job.captures?.find(capture=>capture.id===job.activeCapture);
      if(session){session.status=status;session.finished=new Date().toISOString();session.error=error;session.warnings=[...warnings];}
      store.put({...job,status,error,warnings:[...(job.warnings??[]),...warnings],activeCapture:undefined});
    }; await done;
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
