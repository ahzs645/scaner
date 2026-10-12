import type {GridSpec} from './sampling.js';
import type {ReferencePatch} from './calibration.js';
import {fitScannerProfile} from './calibration.js';
export type CalibrationResult=ReturnType<typeof fitScannerProfile> & {samples:unknown[]};
export class CalibrationWorker {
 private worker?:Worker;private rejectPending?:()=>void;private sequence=0;
 async fit(blob:Blob,grid:GridSpec,references:ReferencePatch[],name:string,signal?:AbortSignal):Promise<CalibrationResult>{
  if(this.rejectPending)throw Error('Calibration is busy');if(signal?.aborted)throw Error('Calibration stopped');
  const worker=this.worker??=new Worker(new URL('./worker.js',import.meta.url),{type:'module'}),id=++this.sequence;
  return new Promise((resolve,reject)=>{let timer:ReturnType<typeof setTimeout>;const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);worker.onmessage=null;worker.onerror=null;this.rejectPending=undefined;};const stop=()=>{cleanup();worker.terminate();this.worker=undefined;reject(Error('Calibration stopped or timed out'));};
  this.rejectPending=stop;timer=setTimeout(stop,60000);signal?.addEventListener('abort',stop,{once:true});
  worker.onmessage=event=>{if(event.data.id!==id)return;cleanup();if(event.data.error)reject(Error(event.data.error));else resolve(event.data.result);};worker.onerror=()=>stop();
  worker.postMessage({id,blob,grid,references,name});});
 }
 dispose():void{if(this.rejectPending)this.rejectPending();else this.worker?.terminate();this.worker=undefined;}
}
