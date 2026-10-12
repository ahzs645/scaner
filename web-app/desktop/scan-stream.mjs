// At most one page waits for durable renderer storage. Tokens and sequence
// numbers prevent stale acknowledgements from advancing a later job.
export class ScanStream {
  constructor(token,send,{timeoutMs=30000}={}) {this.token=token;this.send=send;this.timeoutMs=timeoutMs;this.sequence=0;this.controller=new AbortController();}
  page(image) {
    if(this.controller.signal.aborted)return Promise.reject(this.failure??Error('Network scan stopped'));
    if(this.pending)throw Error('A page is already awaiting storage');
    return new Promise((resolve,reject)=>{
      const sequence=++this.sequence;
      const timer=setTimeout(()=>this.stop(Error('Page storage acknowledgement timed out')),this.timeoutMs);
      this.pending={sequence,resolve,reject,timer};
      try{this.send({token:this.token,sequence,...image});}catch(error){this.stop(error);}
    });
  }
  ack(token,sequence,ok,error) {
    if(token!==this.token||sequence!==this.pending?.sequence)return false;
    const pending=this.pending;clearTimeout(pending.timer);this.pending=undefined;
    if(ok===true)pending.resolve();else{const failure=Error(typeof error==='string'?error.slice(0,500):'Page could not be saved');pending.reject(failure);this.stop(failure);}
    return true;
  }
  stop(error=Error('Network scan stopped')) {
    this.failure??=error;this.controller.abort();
    if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(this.failure);this.pending=undefined;}
  }
}
