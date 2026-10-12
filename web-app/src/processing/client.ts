import type {ImageProcessor,ImageSource,ProcessingRequest,ProcessingResult} from './types.js';
import {validateRecipe} from './types.js';
import type {WorkerRequest,WorkerResponse} from './worker.js';
export interface ProcessingWorker {
  onmessage:((event:MessageEvent<WorkerResponse>)=>void)|null;
  onerror:((event:ErrorEvent)=>void)|null;
  postMessage(message:WorkerRequest):void;terminate():void;
}
/** One bounded job at a time. Abort/timeout kills the worker, leaving originals
 * and earlier durable edits intact; the next call starts a fresh worker. */
export class WorkerImageProcessor implements ImageProcessor {
  private worker?:ProcessingWorker;private sequence=0;private rejectPending?:()=>void;
  constructor(private factory:()=>ProcessingWorker=()=>new Worker(new URL('./worker.js',import.meta.url),{type:'module'}),private timeout=60000){}
  async process(source:ImageSource,request:ProcessingRequest,signal?:AbortSignal):Promise<ProcessingResult> {
    validateRecipe(request.recipe,source.width,source.height);
    if(signal?.aborted)throw Error('Image processing stopped');
    if(this.rejectPending)throw Error('Image processor is busy');
    const worker=this.worker??=this.factory(),id=++this.sequence;
    return new Promise((resolve,reject)=>{
      let timer:ReturnType<typeof setTimeout>;
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);worker.onmessage=null;worker.onerror=null;this.rejectPending=undefined;};
      const fail=(description:string)=>{cleanup();worker.terminate();if(this.worker===worker)this.worker=undefined;reject(Error(description));};
      const cancel=()=>fail('Image processing stopped');
      this.rejectPending=cancel;
      worker.onmessage=event=>{if(event.data.id!==id)return;cleanup();if('error' in event.data)reject(Error(event.data.error));else resolve(event.data.result);};
      worker.onerror=()=>fail('Image processing worker failed; original capture is preserved');
      timer=setTimeout(()=>fail('Image processing timed out; original capture is preserved'),this.timeout);
      signal?.addEventListener('abort',cancel,{once:true});
      try{worker.postMessage({id,source,request});}catch(error){fail(error instanceof Error?error.message:String(error));}
    });
  }
  dispose():void {if(this.rejectPending)this.rejectPending();else this.worker?.terminate();this.worker=undefined;}
}
