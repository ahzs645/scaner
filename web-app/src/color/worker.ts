import {decodeCapture} from './decode.js';
import {sampleGrid} from './sampling.js';
import type {GridSpec} from './sampling.js';
import {fitScannerProfile} from './calibration.js';
import type {ReferencePatch} from './calibration.js';
const scope=self as unknown as {onmessage:((event:MessageEvent)=>void)|null;postMessage:(result:unknown)=>void};
scope.onmessage=event=>{const {id,blob,grid,references,name}=event.data as {id:number;blob:Blob;grid:GridSpec;references:ReferencePatch[];name:string};void(async()=>{
 if(!Array.isArray(references)||references.length>2000)throw Error('Reference patch limit exceeded');
 const decoded=await decodeCapture(blob);const samples=sampleGrid(decoded.data,decoded.width,decoded.height,grid,references.map(r=>r.id));
 const result=fitScannerProfile(samples,references,{name});return {...result,samples};
})().then(result=>scope.postMessage({id,result}),error=>scope.postMessage({id,error:error instanceof Error?error.message:String(error)}));};
