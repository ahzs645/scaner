import {processImage} from './render.js';
import type {ImageSource,ProcessingRequest,ProcessingResult} from './types.js';
export interface WorkerRequest {id:number;source:ImageSource;request:ProcessingRequest}
export type WorkerResponse={id:number;result:ProcessingResult}|{id:number;error:string};
const scope=self as unknown as {onmessage:((event:MessageEvent<WorkerRequest>)=>void)|null;postMessage:(reply:WorkerResponse)=>void};
scope.onmessage=event=>{
  const {id,source,request}=event.data;
  void processImage(source,request).then(result=>scope.postMessage({id,result}),error=>scope.postMessage({id,error:error instanceof Error?error.message:String(error)}));
};
