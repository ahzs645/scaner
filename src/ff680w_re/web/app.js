import {buildHeader, replyLength, tokens, compact, errorTokens, ImageBatch, cleanupSession} from './protocol.js';
const $=id=>document.getElementById(id), enc=new TextEncoder(), dec=new TextDecoder('latin1');
let device,epIn,epOut,intf,busy=false,scanning=false,stopRequested=false,supportsLoad=false;
function log(s){$('log').textContent+=`${new Date().toLocaleTimeString()} ${s}\n`;}
function state(s){$('status').textContent=s;}
function controls(){ $('connect').disabled=!!device||busy; $('read').disabled=!device||busy; $('disconnect').disabled=!device||busy; $('reset').disabled=!device||busy; $('scan').disabled=!device||busy; $('stop').disabled=!scanning; }
async function api(path,body){const r=await fetch(path,{method:'POST',headers:{'X-Launch-Token':window.launchToken,'Content-Type':body instanceof Uint8Array?'image/jpeg':'application/json'},body:body instanceof Uint8Array?body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||r.statusText);return data;}
async function transfer(promise){let timer,timedOut=false;const activeDevice=device;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;reject(Error('USB transfer timed out; disconnect/reconnect scanner'));},20000);})]);}catch(e){if(timedOut){device=null;try{await activeDevice.close();}catch{}controls();}throw e;}finally{clearTimeout(timer);}}
async function send(bytes){const r=await transfer(device.transferOut(epOut,bytes));if(r.status!=='ok'||r.bytesWritten!==bytes.length)throw Error(`USB write ${r.status}`);}
async function recv(n){const r=await transfer(device.transferIn(epIn,n));if(r.status!=='ok'||!r.data)throw Error(`USB read ${r.status}`);return new Uint8Array(r.data.buffer,r.data.byteOffset,r.data.byteLength).slice();}
async function control(letter){await send(new Uint8Array([28,letter.charCodeAt(0)]));const reply=await recv(64);if(reply[0]===6||dec.decode(reply.slice(0,4))==='UNKN')return;if(reply[0]===21)throw Error('Scanner rejected USB lock');throw Error('Unexpected USB control response');}
async function query(command,payload=new Uint8Array()){await send(buildHeader(command,payload.length));if(payload.length)await send(payload);const head=await recv(64);let parsed;try{parsed=replyLength(command,head);}catch(e){throw Error(command.trim()+': '+e.message);}const {header,length}=parsed;const data=length?await recv(length):new Uint8Array();if(data.length!==length)throw Error('Short data block');return {header,items:[...tokens(head,12),...(command==='IMG '?[]:tokens(data))],data};}
async function readSettings(){
 let locked=false,readError;
 try{
  await control('X');locked=true;const result={};
  for(const cmd of ['INFO','CAPA','RESA','STAT']){
   const reply=await query(cmd);result[cmd]=reply.items.map(compact);
   if(cmd==='CAPA')supportsLoad=reply.items.some(t=>t.name==='ADF'&&t.value.includes('LOAD'));
  }
  $('settings').textContent=JSON.stringify(result,null,2);
  state('Connected · device settings read');log('INFO, CAPA, RESA and STAT read directly over WebUSB');
 }catch(e){readError=e;throw e;}
 finally{
  if(locked)try{errorTokens((await query('FIN ')).items,'Settings finalization');}
  catch(e){if(readError)log('Settings finalization: '+e.message);else throw e;}
 }
}
async function openScanner(){
 await device.open();
 if(!device.configuration)await device.selectConfiguration(device.configurations[0].configurationValue);
 const match=device.configuration.interfaces.find(i=>i.interfaceNumber===0&&i.alternates.some(a=>a.endpoints.some(e=>e.type==='bulk'&&e.direction==='in')&&a.endpoints.some(e=>e.type==='bulk'&&e.direction==='out')));
 if(!match)throw Error('Scanner bulk interface not found');
 intf=match.interfaceNumber;await device.claimInterface(intf);
 const alt=match.alternates.find(a=>a.endpoints.some(e=>e.type==='bulk'&&e.direction==='in')&&a.endpoints.some(e=>e.type==='bulk'&&e.direction==='out'));
 if(match.alternate.alternateSetting!==alt.alternateSetting)await device.selectAlternateInterface(intf,alt.alternateSetting);
 epIn=alt.endpoints.find(e=>e.type==='bulk'&&e.direction==='in').endpointNumber;
 epOut=alt.endpoints.find(e=>e.type==='bulk'&&e.direction==='out').endpointNumber;
 supportsLoad=false;
 log(`Claimed interface ${intf}, bulk IN ${epIn}, OUT ${epOut}`);
 await readSettings();
}
async function closeFailedConnection(message){
 state(message);log(message);
 const failedDevice=device;device=null;
 if(failedDevice)try{await failedDevice.close();}catch{}
}
$('connect').onclick=async()=>{
 busy=true;controls();
 try{
  if(!navigator.usb)throw Error('WebUSB requires Chrome/Edge in a secure or localhost context');
  const paired=(await navigator.usb.getDevices()).filter(d=>d.vendorId===0x04b8&&d.productId===0x016b);
  device=paired.length===1?paired[0]:await navigator.usb.requestDevice({filters:[{vendorId:0x04b8,productId:0x016b}]});
  await openScanner();
 }catch(e){await closeFailedConnection(e.message);}finally{busy=false;controls();}
};
$('reset').onclick=async()=>{
 if(busy||!device)return;
 busy=true;controls();const activeDevice=device;
 try{
  state('Resetting USB session…');
  await activeDevice.releaseInterface(intf);
  await activeDevice.reset();
  await activeDevice.close();
  device=activeDevice;
  await openScanner();
  state('Connected · USB session reset');log('USB reset completed; scanner reopened and settings read');
 }catch(e){await closeFailedConnection('USB reset failed: '+e.message+'; disconnect other scanner applications and reconnect');}
 finally{busy=false;controls();}
};
$('read').onclick=async()=>{busy=true;controls();try{await readSettings();}catch(e){state(e.message);log(e.message);}finally{busy=false;controls();}};
$('disconnect').onclick=async()=>{busy=true;controls();const activeDevice=device;try{try{await activeDevice.releaseInterface(intf);}catch(e){log('Release: '+e.message);}await activeDevice.close();}catch(e){log('Close: '+e.message);}finally{device=null;busy=false;state('Disconnected');controls();}};
$('stop').onclick=()=>{stopRequested=true;state('Stopping after pending USB transfer');};
$('scan').onclick=async()=>{
 busy=true;scanning=true;stopRequested=false;controls();let locked=false,acquisitionAttempted=false,batch,savedImages=0,resultMessage;
 try{
  const options={mode:$('mode').value,duplex:$('duplex').value==='true',dpi:Number($('dpi').value),max_sheets:Number($('sheets').value),paper:$('paper').value,quality:Number($('quality').value),deskew:$('deskew').checked,auto_crop:$('crop').checked,double_feed:$('doublefeed').checked};
  const plan=await api('/api/plan',options);
  const job=await api('/api/jobs',{});
  batch=new ImageBatch(options);
  $('output').textContent=job.directory;$('images').replaceChildren();log(`Job ${job.id}: ${JSON.stringify(options)}`);
  // Stop can be requested while the local service prepares the job.
  if(stopRequested)throw Error('Stopped before feeding paper');
  await control('X');locked=true;
  errorTokens((await query('STAT')).items,'Scanner status');
  if(stopRequested)throw Error('Stopped before feeding paper');
  if(supportsLoad)errorTokens((await query('MECH',enc.encode('#ADFLOAD'))).items,'Feeder load');else log('Using automatic feeder loading; ADFLOAD is not advertised');
  const payload=Uint8Array.from(plan.payload_hex.match(/../g),b=>parseInt(b,16));
  const para=await query('PARA',payload);errorTokens(para.items,'Parameters');
  if(!para.items.some(t=>t.name==='par'&&t.value==='OK  '))throw Error('Scanner did not accept parameters');
  if(stopRequested)throw Error('Stopped before starting image transfer');
  acquisitionAttempted=true;
  errorTokens((await query('TRDT')).items,'Scan start');state('Scanning…');
  const deadline=Date.now()+120000;
  while(Date.now()<deadline&&!stopRequested){
   const b=await query('IMG ');
   const completed=batch.accept(b);
   if(completed){
    const {image,filename,sheet,side}=completed;
    const saved=await api('/api/jobs/'+job.id+'/'+filename,image);savedImages++;
    const figure=document.createElement('div'),img=document.createElement('img'),link=document.createElement('a');
    img.src=saved.url;img.alt=`Sheet ${sheet}, ${side}`;link.href=saved.url;link.download=filename;link.textContent=`Sheet ${sheet} · ${side}`;
    figure.append(img,link);$('images').append(figure);log(`Saved ${filename}: ${saved.bytes} bytes`);
    state(`Saved ${batch.counts.front+batch.counts.back} images`);
   }
   if(batch.done)break;
   if(!b.data.length)await new Promise(r=>setTimeout(r,100));
  }
  if(stopRequested&&!batch.done)throw Error('Stopped');
  batch.validate();
  resultMessage=`Complete · ${batch.counts.front} sheets · ${savedImages} images`;state(resultMessage);log('Job ended with lftd000');
 }catch(e){resultMessage=e.message+(savedImages?` · ${savedImages} completed images preserved`:'');state(resultMessage);log(resultMessage);}
 finally{
  const warnings=[];
  if(device)await cleanupSession({query,control},{locked,done:batch?.done,acquisitionAttempted},message=>{log(message);warnings.push(message);});
  if(warnings.length)state(`${resultMessage} · Cleanup warning; use Reset USB session`);
  busy=false;scanning=false;controls();
 }
};
navigator.usb?.addEventListener('disconnect',event=>{if(event.device===device){device=null;state('Scanner disconnected');controls();}});
window.addEventListener('pagehide',()=>{if(device)device.close().catch(()=>{});});
controls();
