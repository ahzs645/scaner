import {validateICC} from './engine.js';
self.onmessage=event=>{void validateICC(event.data).then(()=>self.postMessage({ok:true}),error=>self.postMessage({ok:false,error:error instanceof Error?error.message:String(error)}));};
