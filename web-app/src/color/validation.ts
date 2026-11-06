import {createBundledWorker} from '../worker-urls.js';

/** Parse native ICC structures in an isolated worker with a bounded lifetime. */
export function validateProfile(bytes:Uint8Array):Promise<void>{
 const worker=createBundledWorker(new URL('./validate-worker.js',import.meta.url));
 return new Promise((resolve,reject)=>{const cleanup=()=>{clearTimeout(timer);worker.terminate();};const timer=setTimeout(()=>{cleanup();reject(Error('ICC validation timed out'));},30000);
 worker.onmessage=event=>{cleanup();if(event.data.ok)resolve();else reject(Error(event.data.error??'ICC profile rejected'));};worker.onerror=()=>{cleanup();reject(Error('ICC validation worker failed'));};try{worker.postMessage(Uint8Array.from(bytes));}catch(error){cleanup();reject(error);}});
}
