const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('scanStudioDesktop',Object.freeze({
 discoverNetwork:()=>ipcRenderer.invoke('scanner:discover-network'),
 readNetworkSettings:id=>ipcRenderer.invoke('scanner:network-settings',id),
 stopNetworkScan:token=>ipcRenderer.invoke('scanner:network-stop',token),
 scanNetwork:async(id,token,options,onImage)=>{
  let localError,sequence=0;
  const receive=async(_event,page)=>{
   if(page?.token!==token)return;
   try{
    if(page.sequence!==sequence+1||!(page.image instanceof Uint8Array)||page.image.length>24*1024*1024)throw Error('Invalid scanner page');
    sequence=page.sequence;
    await onImage({image:page.image,filename:page.filename,sheet:page.sheet,side:page.side});
    await ipcRenderer.invoke('scanner:network-page-ack',token,sequence,true);
   }catch(error){localError=String(error?.message??error);await ipcRenderer.invoke('scanner:network-page-ack',token,page.sequence,false,localError).catch(()=>{});}
  };
  ipcRenderer.on('scanner:network-page',receive);
  try{const result=await ipcRenderer.invoke('scanner:network-scan',id,token,options);return localError?{ok:false,error:localError}:result;}
  finally{ipcRenderer.removeListener('scanner:network-page',receive);}
 }
}));
