import {app,BrowserWindow,protocol,ipcMain,session} from 'electron';
import {readFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,sep,extname} from 'node:path';
import {discoverNetworkScanners,createDnsSdRunner,resolveNetworkAddress} from './discovery.mjs';
import {scanNetwork} from './network-scanner.mjs';
import {ScanStream} from './scan-stream.mjs';
import {FF680W_PROFILE} from '../dist/profiles/ff680w.js';
import {readNetworkSettings} from './network-settings.mjs';
import {APP_SCHEME,APP_HOST,APP_ORIGIN,isAppURL,isPrivateIPv4,assertMainFrameSender} from './security.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../dist');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.wasm':'application/wasm'};
protocol.registerSchemesAsPrivileged([{scheme:APP_SCHEME,privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
app.setName('Scan Studio');
let window,targets=new Map(),networkBusy=false,discoveredAt=0,activeScan;
async function selectedConnection(id){
 if(typeof id!=='string'||id.length>256||!targets.has(id))throw Error('Choose a scanner from current discovery results');
 if(Date.now()-discoveredAt>300000)throw Error('Find scanners again; discovery expired');
 const target=targets.get(id);if(target.available===false)throw Error('Scanner advertises that it is busy');
 const address=await resolveNetworkAddress(target,{timeoutMs:3000});if(!isPrivateIPv4(address.address))throw Error('Scanner must resolve to private LAN IPv4');
 return {host:address.address,port:target.port};
}

async function networkAction(event,work){assertMainFrameSender(event,window.webContents);if(networkBusy)throw Error('Network scanner is busy');networkBusy=true;try{return await work();}finally{networkBusy=false;}}
if(!app.requestSingleInstanceLock())app.quit();
else void app.whenReady().then(async()=>{
const ownSession=session.fromPartition('persist:scan-studio');
ownSession.protocol.handle(APP_SCHEME,async request=>{
  try{
    if(!isAppURL(request.url)||!['GET','HEAD'].includes(request.method))return new Response('Not allowed',{status:403});
    const path=decodeURIComponent(new URL(request.url).pathname),file=resolve(root,'.'+(path==='/'?'/index.html':path));
    if(!file.startsWith(root+sep))return new Response('Not found',{status:404});
    const actual=await realpath(file);if(!actual.startsWith(root+sep))return new Response('Not found',{status:404});
    const data=await readFile(actual);
    const csp=['/processing/worker.js','/color/worker.js','/color/validate-worker.js'].includes(path)
      ? `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src ${APP_ORIGIN}/vendor/color/; object-src 'none'`
      : path==='/vendor/ocr/worker.min.js'
      ? `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src ${APP_ORIGIN}/vendor/ocr/; object-src 'none'`
      : "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
    return new Response(request.method==='HEAD'?null:data,{headers:{'Content-Type':mime[extname(file)]??'application/octet-stream','Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});
  }catch{return new Response('Not found',{status:404});}
});
window=new BrowserWindow({width:1440,height:1000,minWidth:860,minHeight:650,title:'Scan Studio',backgroundColor:'#252529',webPreferences:{session:ownSession,preload:resolve(dirname(fileURLToPath(import.meta.url)),'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true}});
window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
window.webContents.on('will-navigate',(event,url)=>{if(!isAppURL(url))event.preventDefault();});
ownSession.setPermissionCheckHandler((contents,permission,origin)=>contents===window.webContents&&permission==='usb'&&origin===APP_ORIGIN);
ownSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
ownSession.setDevicePermissionHandler(details=>details.deviceType==='usb'&&details.origin===APP_ORIGIN&&details.device?.vendorId===0x04b8&&details.device?.productId===0x016b);
ownSession.on('select-usb-device',(event,details,callback)=>{
  event.preventDefault();const candidates=details.deviceList.filter(device=>device.vendorId===0x04b8&&device.productId===0x016b);
  callback(details.frame===window.webContents.mainFrame&&candidates.length===1?candidates[0].deviceId:'');
});
ipcMain.handle('scanner:discover-network',(event)=>networkAction(event,async()=>{
  const runner=createDnsSdRunner();
  const found=await discoverNetworkScanners({timeoutMs:5000,runner:async(args,options)=>{const output=await runner(args,options);if(process.env.SCANNER_DESKTOP_DIAGNOSTICS==='1')console.log('Bonjour '+args[0]+': '+JSON.stringify(output.slice(0,8192)));return output;}});targets=new Map(found.map(target=>[target.id,target]));discoveredAt=Date.now();return found;
}));
ipcMain.handle('scanner:network-settings',(event,id)=>networkAction(event,async()=>{
  if(typeof id!=='string'||id.length>256||!targets.has(id))throw Error('Choose a scanner from the current discovery results');
  if(Date.now()-discoveredAt>300000)throw Error('Discovery results expired; find scanners again');
  const target=targets.get(id);if(target.available===false)throw Error('The scanner advertises that it is busy');
  const address=await resolveNetworkAddress(target,{timeoutMs:3000});if(!isPrivateIPv4(address.address))throw Error('Scanner address must resolve to a private LAN IPv4 address');
  // Connect to the pinned numeric result, rather than resolving the name again.
  return readNetworkSettings({host:address.address,port:target.port});
}));
ipcMain.handle('scanner:network-scan',async(event,id,token,options)=>{
 try{return await networkAction(event,async()=>{
  if(typeof token!=='string'||!/^[a-f0-9-]{36}$/.test(token))throw Error('Invalid scan token');
  FF680W_PROFILE.buildScanPlan(options);
  const stream=new ScanStream(token,page=>event.sender.send('scanner:network-page',page));activeScan={stream,owner:event.sender};
  try{
   const connection=await selectedConnection(id);
   const result=await scanNetwork(connection,options,image=>stream.page(image),stream.controller.signal);
   return {ok:true,...result};
  }catch(error){return {ok:false,error:String(stream.failure?.message??error.message??error),images:error.images??0,warnings:error.warnings??[]};}
  finally{stream.stop();activeScan=undefined;}
 });}catch(error){return {ok:false,error:String(error.message??error)};}
});
ipcMain.handle('scanner:network-page-ack',(event,token,sequence,ok,error)=>{
 assertMainFrameSender(event,window.webContents);
 if(activeScan?.owner!==event.sender)return false;
 return activeScan.stream.ack(token,sequence,ok,error);
});
ipcMain.handle('scanner:network-stop',(event,token)=>{
 assertMainFrameSender(event,window.webContents);
 if(activeScan?.owner===event.sender&&activeScan.stream.token===token)activeScan.stream.stop();
});
window.webContents.on('destroyed',()=>activeScan?.stream.stop(Error('Scanner window closed')));
window.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame)activeScan?.stream.stop(Error('Scanner window navigated'));});
await window.loadURL(APP_ORIGIN+'/index.html');
app.on('window-all-closed',()=>app.quit());

}).catch(error=>{console.error(error);app.quit();});
