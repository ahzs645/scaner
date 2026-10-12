import {ColorUI} from './color/ui.js';
import type {ProfileRecord} from './color/types.js';
import {captureSignature} from './color/types.js';
import './desktop.js';
import {NetworkScannerDriver} from './network-driver.js';
import type {NetworkScannerTarget} from './desktop.js';
import {createDefaultRegistry,SUPPORTED_DRIVERS} from './profiles/index.js';
import {cropUnavailableReason} from './capabilities.js';
import type {ScannerDriver,Capabilities,DeviceSettings,ScanOptions} from './driver.js';
import {OrientationDetector} from './processing/orientation.js';
import {WorkerImageProcessor} from './processing/client.js';
import {originalRecipe,isEdited,applyOrientation} from './processing/types.js';
import type {ProcessingRecipe,ProcessingResult,SavedEdit} from './processing/types.js';
import {ScanStore} from './storage.js';
import type {Job,SavedImage} from './storage.js';
import {createZip} from './zip.js';

const element=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const button=(id:string)=>element<HTMLButtonElement>(id);
const input=(id:string)=>element<HTMLInputElement>(id);
const select=(id:string)=>element<HTMLSelectElement>(id);
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
const store=new ScanStore();
const desktop=window.scanStudioDesktop;
let networkTargets:NetworkScannerTarget[]=[];
element('network-panel').hidden=!desktop;
let busy=false,storageReady=false,abort:AbortController|undefined,currentJob:Job|undefined,caps:Capabilities|undefined;
let currentImages:SavedImage[]=[],urls:string[]=[],savedJobs:Job[]=[],selected=-1;
let scanner:ScannerDriver|undefined;
const processor=new WorkerImageProcessor();
const orientation=new OrientationDetector();
let colorSelection:ProfileRecord|null=null;
type EditOperation='color'|'remove-color'|'left'|'right'|'crop'|'orient'|'auto'|'restore'|'undo';
const edits=new Map<string,SavedEdit>(),editUrls=new Map<string,string>(),processingMessages=new Map<string,string>();
let phase:'scan'|'processing'|undefined;
const workspace=document.querySelector<HTMLElement>('.workspace')!;
const dateLabel=(job:Job)=>new Date(job.created).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
const timeLabel=(job:Job)=>new Date(job.created).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
const bytesLabel=(bytes:number)=>bytes<1024?`${bytes} B`:bytes<1024*1024?`${(bytes/1024).toFixed(0)} KB`:`${(bytes/(1024*1024)).toFixed(1)} MB`;
const icon=(name:string)=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS(svg.namespaceURI,'use');use.setAttribute('href','#i-'+name);svg.append(use);svg.setAttribute('aria-hidden','true');return svg;};
const log=(text:string)=>{const target=element('log');target.textContent+=new Date().toLocaleTimeString()+' '+text+'\n';target.scrollTop=target.scrollHeight;};
const state=(text:string)=>{element('status').textContent=text;};
const colorUI=new ColorUI({current:()=>({job:currentJob,image:currentImages[selected]}),preview:()=>currentImages[selected]?displayOf(currentImages[selected]!,selected).blob:undefined,apply:profile=>{colorSelection=profile;editPages(profile?'color':'remove-color');},download,changed:controls,log});
const registry=navigator.usb?createDefaultRegistry(navigator.usb,{log,onDisconnect:()=>{caps=undefined;state('Scanner disconnected');controls();}}):undefined;
element('supported-models').textContent=SUPPORTED_DRIVERS.map(driver=>driver.profile.label).join(', ');

function controls():void {
  const connected=!!scanner?.connected;
  button('connect').disabled=busy||!registry||connected;
  for(const id of ['read','reset','disconnect'])button(id).disabled=busy||!connected;
  button('reset').disabled=busy||!connected||scanner?.transport==='network';
  button('scan').disabled=busy||!connected||!storageReady;
  button('discover-network').disabled=busy||!desktop;select('network-scanner').disabled=busy;button('read-network').disabled=busy||!desktop||!select('network-scanner').value;
  button('stop').disabled=!abort;button('stop').textContent=phase==='processing'?'Stop image processing':'Stop after current transfer';
  button('export').disabled=busy||!currentImages.length;
  for(const id of ['refresh','new-job'])button(id).disabled=busy;
  for(const field of document.querySelectorAll<HTMLInputElement|HTMLSelectElement>('.capture-grid input,.capture-grid select'))field.disabled=busy;
  for(const item of document.querySelectorAll<HTMLButtonElement>('#history button,#images button'))item.disabled=busy;
  const hasPage=selected>=0&&!!currentImages[selected];
  for(const id of ['rotate-left','rotate-right','edit-left','edit-right','auto-crop','auto-orient','auto-enhance','restore-original','download-original','zoom-out','zoom-in','fit','download-page'])button(id).disabled=busy||!hasPage;
  select('zoom').disabled=busy||!hasPage;
  for(const id of ['process-scope','preview-version','export-mode'])select(id).disabled=busy;
  input('auto-process').disabled=busy;input('auto-orient-after').disabled=busy;
  const undoTargets=processTargets();
  button('undo-edit').disabled=busy||!hasPage||!undoTargets.some(image=>!!edits.get(image.filename)?.history.length);
  button('previous').disabled=busy||selected<=0;
  button('next').disabled=busy||selected<0||selected>=currentImages.length-1;
  element('connection-label').textContent=connected?scanner!.profile.label+' connected':'Scanner disconnected';
  element('device-name').textContent=scanner?.profile.label??'Choose a scanner';
  element('device-state').textContent=connected?'Connected · '+(scanner?.transport==='network'?'Network':'USB')+' · ready':'Not connected';
  document.querySelector('.device-tag')!.textContent=scanner?.transport==='network'?'LAN':'USB';
  element('device-dot').classList.toggle('connected',connected);
  element('status-dot').classList.toggle('connected',connected);
  element('status-dot').classList.toggle('busy',busy);
  colorUI.setBusy(busy,hasPage&&currentJob?.options.mode==='color',!!(hasPage&&edits.get(currentImages[selected]!.filename)?.recipe.color));
  constraints();
}
function constraints():void {
  if(!caps)return;
  for(const option of select('dpi').options)option.disabled=!caps.resolutions.includes(Number(option.value));
  for(const option of select('mode').options)option.disabled=option.value==='color'?!caps.color:!caps.gray;
  select('duplex').options[0]!.disabled=!caps.duplex;
  if(!caps.duplex)select('duplex').value='false';
  const reason=cropUnavailableReason(caps,Number(select('dpi').value));
  input('crop').disabled=busy||!!reason;if(reason)input('crop').checked=false;
  element('crop-hint').textContent=reason??'Crop to detected document edges';
  for(const [id,supported] of [['deskew',caps.deskew],['doublefeed',caps.doubleFeed]] as const){input(id).disabled=busy||!supported;if(!supported)input(id).checked=false;}
  input('quality').min=String(caps.quality.min);input('quality').max=String(caps.quality.max);
}
function settings(result:DeviceSettings):void {
  element('settings').textContent=JSON.stringify(result,null,2);caps=scanner?.capabilities;
  if(!caps)return;
  const chosenDpi=Number(select('dpi').value);select('dpi').replaceChildren(...caps.resolutions.map(dpi=>{const option=document.createElement('option');option.value=String(dpi);option.textContent=String(dpi);return option;}));
  select('dpi').value=String(caps.resolutions.includes(chosenDpi)?chosenDpi:scanner!.profile.defaults.dpi);
  if(caps.resolutions.length&&!caps.resolutions.includes(Number(select('dpi').value)))select('dpi').value=String(caps.resolutions[0]);
  if(!caps.color&&caps.gray)select('mode').value='gray';
  constraints();
}
select('dpi').onchange=constraints;
select('network-scanner').onchange=controls;
button('discover-network').onclick=()=>void action(async()=>{
  element('network-status').textContent='Looking for scanners on this network…';select('network-scanner').replaceChildren();
  const targets=await desktop!.discoverNetwork().catch(error=>{element('network-status').textContent=message(error);throw error;});
  networkTargets=targets;
  for(const target of targets){const option=document.createElement('option');option.value=target.id;option.textContent=target.label+' · '+target.host+':'+target.port+(target.available===false?' · Busy':'');select('network-scanner').append(option);}
  element('network-status').textContent=targets.length?`Found ${targets.length} network ${targets.length===1?'scanner':'scanners'}. Choose Connect network scanner to begin.`:'No supported scanner found. Check that it is on the same network.';
  element('network-settings').textContent='';state(targets.length?'Network scanner found':'No network scanner found');
});
button('read-network').onclick=()=>void action(async()=>{
  if(scanner?.connected)throw Error('Disconnect the current scanner first');
  const target=networkTargets.find(item=>item.id===select('network-scanner').value);
  if(!target)throw Error('Find and choose a network scanner first');
  element('network-status').textContent='Connecting to network scanner…';
  try{
    const driver=new NetworkScannerDriver(desktop!,target);const live=await driver.connect();scanner=driver;settings(live);
    element('network-settings').textContent=JSON.stringify(live,null,2);
    element('network-status').textContent='Connected over the local network · scan settings above apply';
    state('Network connected · ready to scan');log('Network settings verified · no paper fed');
  }catch(error){element('network-status').textContent=message(error);throw error;}
});

async function action(work:()=>Promise<void>):Promise<void> {
  if(busy)return;busy=true;controls();
  try{await work();}catch(error){state(message(error));log(message(error));}
  finally{busy=false;controls();}
}
button('connect').onclick=()=>void action(async()=>{scanner=await registry!.chooseDriver();const live=await scanner.connect();if(currentJob?.driverId&&currentJob.driverId!==scanner.profile.id)applyOptions({...scanner.profile.defaults,max_sheets:1});settings(live);document.title='Scan Studio · '+scanner.profile.label;state('Connected · ready to scan');});
button('read').onclick=()=>void action(async()=>{settings(await scanner!.settings());state('Device settings updated');});
button('reset').onclick=()=>void action(async()=>{state('Resetting USB session…');settings(await scanner!.reset());state('USB session reset · ready');});
button('disconnect').onclick=()=>void action(async()=>{await scanner!.disconnect();caps=undefined;state('Disconnected');});
button('stop').onclick=()=>{abort?.abort();state(phase==='processing'?'Stopping image processing · originals preserved':'Stopping after pending transfer');};
function options():ScanOptions {
  return {mode:select('mode').value as ScanOptions['mode'],duplex:select('duplex').value==='true',dpi:Number(select('dpi').value),max_sheets:Number(input('sheets').value),paper:select('paper').value as ScanOptions['paper'],quality:Number(input('quality').value),auto_crop:input('crop').checked,deskew:input('deskew').checked,double_feed:input('doublefeed').checked,...(select('mode').value==='color'&&scanner?.profile.id==='epson-ff680w'?{color_capture:'neutral-v1' as const}:{})};
}
function applyOptions(request:ScanOptions):void {
  select('mode').value=request.mode;select('duplex').value=String(request.duplex);select('dpi').value=String(request.dpi);
  select('paper').value=request.paper;input('quality').value=String(request.quality);input('sheets').value=String(request.max_sheets);
  input('crop').checked=request.auto_crop;input('deskew').checked=request.deskew;input('doublefeed').checked=request.double_feed;
  constraints();
}
function title():void {
  element('document-title').textContent=currentJob?`Scan · ${dateLabel(currentJob)} · ${timeLabel(currentJob)}`:'Untitled scan';
  element('output').textContent=currentJob?`${dateLabel(currentJob)} · ${currentImages.length} ${currentImages.length===1?'page':'pages'} · Saved locally`:'No scan selected';
  element('image-count').textContent=String(currentImages.length);
}
function clearView():void {
  element<HTMLImageElement>('preview-image').removeAttribute('src');
  for(const url of urls)URL.revokeObjectURL(url);
  for(const url of editUrls.values())URL.revokeObjectURL(url);editUrls.clear();edits.clear();processingMessages.clear();
  urls=[];currentImages=[];selected=-1;element('images').replaceChildren();select('zoom').value='fit';
  renderPreview();title();
}
function showImage(saved:SavedImage):void {
  const index=currentImages.push(saved)-1,url=URL.createObjectURL(saved.blob);urls.push(url);
  const entry=document.createElement('button'),image=document.createElement('img'),label=document.createElement('span');
  entry.className='page-thumbnail';entry.setAttribute('aria-label',`Select sheet ${saved.sheet}, ${saved.side}`);entry.setAttribute('aria-pressed','false');
  image.src=displayOf(saved,index).url;image.alt=`Sheet ${saved.sheet}, ${saved.side}`;image.loading='lazy';image.draggable=false;
  label.textContent=`${saved.sheet.toString().padStart(2,'0')} · ${saved.side==='front'?'Front':'Back'}`;
  entry.append(image,label);entry.onclick=()=>{if(!busy)selectPage(index);};element('images').append(entry);
  selected=index;renderPreview();title();
}
function selectPage(index:number):void {
  if(index<0||index>=currentImages.length)return;
  selected=index;renderPreview();controls();
}
function displayOf(saved:SavedImage,index:number):{blob:Blob;width:number;height:number;url:string;edited:boolean} {
  const edit=edits.get(saved.filename),useEdit=select('preview-version').value==='processed'&&edit&&isEdited(edit.recipe);
  return useEdit?{blob:edit.blob,width:edit.width,height:edit.height,url:editUrls.get(saved.filename)!,edited:true}:{blob:saved.blob,width:saved.width,height:saved.height,url:urls[index]!,edited:false};
}
function updateThumbnails():void {
  for(const [index,saved] of currentImages.entries()){const image=element('images').children[index]?.querySelector('img');if(image)image.src=displayOf(saved,index).url;}
}
function renderPreview():void {
  const saved=currentImages[selected],image=element<HTMLImageElement>('preview-image');
  element('empty-state').hidden=!!saved;element('page-frame').hidden=!saved;
  for(const [index,entry] of [...element('images').children].entries())entry.setAttribute('aria-pressed',String(index===selected));
  element('page-counter').textContent=saved?`${selected+1} / ${currentImages.length}`:'No pages';
  const view=saved?displayOf(saved,selected):undefined,edit=saved?edits.get(saved.filename):undefined;
  element('page-title').textContent=saved?`${saved.filename.replace(/\.jpg$/i,view?.edited?'.png':'.jpg')} · ${view?.edited?'Edited':'Original'}`:'Document preview';
  const fields:{[id:string]:string}={
    'detail-file':saved?.filename??'—','detail-side':saved?`${saved.sheet} / ${saved.side}`:'—',
    'detail-size':view?`${view.width} × ${view.height} px`:'—','detail-dpi':saved&&currentJob?`${currentJob.options.dpi} dpi`:'—',
    'detail-color':saved&&currentJob?(currentJob.options.mode==='color'?'RGB · 24 bit':'Grayscale · 8 bit'):'—',
    'detail-bytes':view?`${bytesLabel(view.blob.size)} (${view.blob.size.toLocaleString()} B)`:'—'};
  for(const [id,value] of Object.entries(fields))element(id).textContent=value;
  const crop=edit?.recipe.crop;
  element('processing-info').textContent=saved?(processingMessages.get(saved.filename)??(edit&&isEdited(edit.recipe)?`Saved edit · ${edit.recipe.rotation}° rotation`+(crop?` · Crop ${crop.width} × ${crop.height} at ${crop.x}, ${crop.y}`:'')+(edit.detection?` · Boundary score ${(edit.detection.confidence*100).toFixed(0)}%`:'')+(edit.recipe.color?` · sRGB using ${edit.recipe.color.profileName}`:'')+(edit.orientation?` · ${edit.orientation.reason}`+(edit.orientation.confidence!==null?` · Text confidence ${edit.orientation.confidence.toFixed(1)}`:''):''):'No edits. Original capture is kept.'+(edit?.orientation?` · ${edit.orientation.reason}`:''))):'Choose a scanned page to edit.';
  element('selection-summary').textContent=view?`${view.width} × ${view.height} px · ${currentJob?.options.dpi??'—'} dpi · ${bytesLabel(view.blob.size)} · ${view.edited?'PNG':'Original'}`:'No page selected';
  if(!saved||!view){image.removeAttribute('src');return;}
  if(image.getAttribute('src')!==view.url)image.src=view.url;
  image.dataset.rotation='0';image.alt=`Sheet ${saved.sheet}, ${saved.side} ${view.edited?'edited':'original'} preview`;
  element('page-frame').classList.remove('quarter-turn');
  const zoom=select('zoom').value;element('stage').classList.toggle('actual-size',zoom!=='fit');
  if(zoom==='fit'){
    const stage=element('stage'),padding=getComputedStyle(stage);
    const width=Math.max(1,stage.clientWidth-parseFloat(padding.paddingLeft)-parseFloat(padding.paddingRight)-24);
    const height=Math.max(1,stage.clientHeight-parseFloat(padding.paddingTop)-parseFloat(padding.paddingBottom)-24);
    const scale=Math.min(width/view.width,height/view.height);image.width=Math.round(view.width*scale);image.height=Math.round(view.height*scale);
  }else{image.width=Math.round(view.width*Number(zoom)/100);image.height=Math.round(view.height*Number(zoom)/100);}
}
async function saveProcessed(saved:SavedImage,result:ProcessingResult,historyOverride?:ProcessingRecipe[]):Promise<void> {
  const previous=edits.get(saved.filename);
  if(!result.detection&&previous?.detection&&JSON.stringify(previous.recipe.crop)===JSON.stringify(result.recipe.crop))result={...result,detection:previous.detection};
  const edit=await store.saveEdit(saved.jobId,saved.filename,result,historyOverride);edits.set(saved.filename,edit);
  const oldUrl=editUrls.get(saved.filename);if(oldUrl)URL.revokeObjectURL(oldUrl);editUrls.set(saved.filename,URL.createObjectURL(edit.blob));
  processingMessages.delete(saved.filename);updateThumbnails();renderPreview();
}
async function processPage(saved:SavedImage,operation:EditOperation,signal?:AbortSignal):Promise<boolean> {
  const previous=edits.get(saved.filename);let recipe=structuredClone(previous?.recipe??originalRecipe());let historyOverride:ProcessingRecipe[]|undefined;
  if(operation==='left'||operation==='right')recipe.rotation=((recipe.rotation+(operation==='right'?90:270))%360) as ProcessingRecipe['rotation'];
  if(operation==='restore'){recipe.rotation=0;recipe.crop=null;delete recipe.color;}
  if(operation==='remove-color')delete recipe.color;
  if(operation==='color'){
    if(!colorSelection||currentJob?.options.mode!=='color')throw Error('Choose a matching RGB scanner profile');
    if(colorSelection.captureSignature&&colorSelection.captureSignature!==captureSignature(currentJob,saved.side))throw Error('Profile does not match '+saved.filename+' capture settings and scan side');
    recipe.color={profileId:colorSelection.id,profileName:colorSelection.name,intent:'relative-colorimetric',output:'srgb',source:colorSelection.source};
  }
  if(operation==='undo'){
    const prior=previous?.history.at(-1);if(!prior)return false;
    recipe=structuredClone(prior);historyOverride=previous!.history.slice(0,-1);
  }
  const colorProfile=recipe.color?(await colorUI.library.get(recipe.color.profileId)).bytes:undefined;
  let result=await processor.process(saved,{recipe,autoCrop:operation==='crop'||operation==='auto',colorProfile},signal);
  if(operation==='crop'&&!result.detection?.bounds){const reason=result.notices[0]??'Paper boundary is uncertain';processingMessages.set(saved.filename,reason);log(saved.filename+': '+reason);renderPreview();return false;}
  if(operation==='orient'||operation==='auto'){
    state('Detecting upright text · '+saved.filename+' · first use loads local OCR assets');
    const decision=await orientation.detect(result,signal),inputRotation=result.recipe.rotation;
    const evidence={...decision,inputRotation};
    if(decision.accepted&&decision.rotation!==null&&decision.rotation!==0){
      const corrected=applyOrientation(result.recipe,decision);
      const rendered=await processor.process(saved,{recipe:corrected,colorProfile},signal);
      result={...rendered,detection:result.detection,notices:result.notices,orientation:evidence};
    }else result={...result,orientation:evidence};
    log(saved.filename+': '+decision.reason);
  }
  const changed=JSON.stringify(result.recipe)!==JSON.stringify(previous?.recipe??originalRecipe());
  if(!changed&&!result.orientation)return false;
  if(!changed)historyOverride=previous?.history??[];
  await saveProcessed(saved,result,historyOverride);
  if(result.orientation&&!changed)processingMessages.set(saved.filename,result.orientation.reason);
  renderPreview();log(saved.filename+': '+(changed?'saved '+result.width+' × '+result.height+' '+result.blob.type+' edit':'saved orientation result'));return changed;
}
function processTargets(selectedOnly=false):SavedImage[]{const scope=select('process-scope').value;return selectedOnly||scope==='page'?(currentImages[selected]?[currentImages[selected]!]:[]):scope==='front'||scope==='back'?currentImages.filter(image=>image.side===scope):[...currentImages];}
function editPages(operation:EditOperation,selectedOnly=false):void {
  void action(async()=>{
    const targets=processTargets(selectedOnly);
    if(operation==='color'&&colorSelection?.captureSignature)for(const saved of targets)if(!currentJob||captureSignature(currentJob,saved.side)!==colorSelection.captureSignature)throw Error('A measured front/back profile applies only to its matching side and capture settings. Choose Selected page or import an externally validated profile.');
    if(!targets.length)return;abort=new AbortController();phase='processing';controls();select('preview-version').value='processed';let updated=0;
    try{for(const [index,saved] of targets.entries()){if(abort.signal.aborted)throw Error('Image processing stopped');state(`Processing page ${index+1} / ${targets.length}`);if(await processPage(saved,operation,abort.signal))updated++;}
      state(updated?`Saved edits to ${updated} ${updated===1?'page':'pages'} · originals preserved`:processingMessages.get(targets[0]!.filename)??'Pages already match this edit');
    }finally{abort=undefined;phase=undefined;renderPreview();}
  });
}
function renderHistory():void {
  const term=input('job-search').value.trim().toLowerCase();element('history').replaceChildren();element('job-count').textContent=String(savedJobs.length);
  const jobs=savedJobs.filter(job=>`${dateLabel(job)} ${timeLabel(job)} ${job.status} ${job.options.mode} ${job.options.dpi} ${job.id}`.toLowerCase().includes(term));
  if(!jobs.length){const empty=document.createElement('p');empty.className='empty-list';empty.textContent=term?'No matching scans.':'Your saved scans will appear here.';element('history').append(empty);return;}
  for(const job of jobs){
    const entry=document.createElement('button'),badge=document.createElement('span'),text=document.createElement('span'),name=document.createElement('strong'),meta=document.createElement('small'),status=document.createElement('span');
    entry.className='job';entry.setAttribute('aria-current',String(job.id===currentJob?.id));entry.title=job.id;
    badge.className='job-icon';badge.append(icon('pages'));text.className='job-text';name.textContent=dateLabel(job)+' · '+timeLabel(job);
    meta.textContent=`${job.images} ${job.images===1?'page':'pages'} · ${job.options.mode==='color'?'Color':'Gray'} · ${job.options.dpi} dpi`;
    status.className='job-status'+(job.status==='complete'?'':' incomplete');status.textContent=job.status==='complete'?'Complete':job.status==='scanning'?'Interrupted':`${job.images} pages preserved · Incomplete`;
    text.append(name,meta,status);entry.append(badge,text);entry.disabled=busy;
    entry.onclick=()=>void action(async()=>{await loadJob(job);renderHistory();if(window.matchMedia('(max-width:1100px)').matches)workspace.classList.remove('library-open');panelState();});element('history').append(entry);
  }
}
async function loadJob(job:Job):Promise<void> {
  const [images,savedEdits]=await Promise.all([store.images(job.id),store.edits(job.id)]);currentJob=job;clearView();applyOptions(job.options);
  for(const edit of savedEdits){edits.set(edit.filename,edit);editUrls.set(edit.filename,URL.createObjectURL(edit.blob));}
  for(const saved of images)showImage(saved);if(images.length)selectPage(0);title();
  state(job.error??(job.status==='complete'?`Saved scan · ${images.length} pages`:'Incomplete scan · completed pages preserved'));
}
async function history():Promise<void> {savedJobs=await store.jobs();renderHistory();}
input('job-search').oninput=renderHistory;
button('refresh').onclick=()=>void action(history);
button('new-job').onclick=()=>void action(async()=>{currentJob=undefined;clearView();renderHistory();state(scanner?.connected?'Ready for a new scan':'Connect the scanner to start');showTab('capture');workspace.classList.remove('inspector-hidden','library-open');if(window.matchMedia('(max-width:760px)').matches)workspace.classList.add('inspector-open');document.querySelector('.document-workspace')!.classList.remove('overview');button('view-grid').setAttribute('aria-pressed','false');button('view-grid').setAttribute('aria-label','Show page overview');panelState();});
button('scan').onclick=()=>void action(async()=>{
  const request=options();scanner!.validateOptions(request);
  if(caps&&(!caps.resolutions.includes(request.dpi)||(request.mode==='color'?!caps.color:!caps.gray)))throw Error('Choose an image type and resolution supported by this scanner');
  const job=await store.createJob(request,{driverId:scanner!.profile.id,deviceLabel:scanner!.profile.label,deviceIdentity:scanner!.deviceIdentity});const postCrop=input('auto-process').checked,postOrient=input('auto-orient-after').checked;currentJob=job;clearView();title();
  document.querySelector('.document-workspace')!.classList.remove('overview');button('view-grid').setAttribute('aria-pressed','false');
  abort=new AbortController();phase='scan';controls();log('Job '+job.id+': '+JSON.stringify(request));state('Scanning…');
  try {
    const result=await scanner!.scan(request,async captured=>{const saved=await store.saveImage(job.id,captured);showImage(saved);state(`Scanning · ${currentImages.length} pages saved`);},abort.signal);
    await store.finish(job.id,'complete',undefined,result.warnings);currentJob=(await store.jobs()).find(saved=>saved.id===job.id)??job;
    state(`Complete · ${result.sheets} ${result.sheets===1?'sheet':'sheets'} · ${result.images} pages`+(result.warnings.length?' · Cleanup warning':''));
    if((postCrop||postOrient)&&!abort.signal.aborted){phase='processing';controls();let processingError:string|undefined,processed=0;for(const [index,saved] of currentImages.entries()){try{if(abort.signal.aborted)break;state(`Processing page ${index+1} / ${currentImages.length}`);if(await processPage(saved,postCrop&&postOrient?'auto':postCrop?'crop':'orient',abort.signal))processed++;}catch(error){processingError=message(error);log('Post-capture processing: '+processingError+' · originals preserved');break;}}state(abort.signal.aborted?'Capture complete · image processing stopped':processingError?'Capture complete · image processing failed · originals preserved':`Capture complete · ${processed} pages edited · ${currentImages.length-processed} unchanged`);}
  }catch(error){
    const description=message(error);try{await store.finish(job.id,'failed',description);}catch(storageError){log('Job record update: '+message(storageError));}
    currentJob={...job,status:'failed',images:currentImages.length,error:description};state(description);log(description);
  }finally{abort=undefined;phase=undefined;await history();controls();}
});
function download(blob:Blob,filename:string):void {
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
button('export').onclick=()=>void action(async()=>{
  if(!currentJob||!currentImages.length)return;
  const processed=select('export-mode').value==='processed';
  const descriptors=currentImages.map(image=>{const edit=edits.get(image.filename),useEdit=processed&&edit&&isEdited(edit.recipe);return {image,edit:processed?edit:undefined,blob:useEdit?edit.blob:image.blob,filename:useEdit?image.filename.replace(/\.jpg$/i,'.png'):image.filename,width:useEdit?edit.width:image.width,height:useEdit?edit.height:image.height};});
  const entries=await Promise.all(descriptors.map(async page=>({name:page.filename,data:new Uint8Array(await page.blob.arrayBuffer())})));
  const persisted=(await store.jobs()).find(job=>job.id===currentJob!.id)??currentJob;
  const manifest={...persisted,exportVersion:processed?'processed':'original',captureBytes:persisted.bytes,bytes:descriptors.reduce((sum,page)=>sum+page.blob.size,0),images:descriptors.map(page=>({filename:page.filename,originalFilename:page.image.filename,sheet:page.image.sheet,side:page.image.side,width:page.width,height:page.height,bytes:page.blob.size,originalWidth:page.image.width,originalHeight:page.image.height,...(page.edit?{processing:{recipe:page.edit.recipe,updated:page.edit.updated,detection:page.edit.detection,orientation:page.edit.orientation,notices:page.edit.notices}}:{})}))};
  if(processed){const ids=[...new Set(descriptors.flatMap(page=>page.edit?.recipe.color?[page.edit.recipe.color.profileId]:[]))];for(const id of ids){const profile=await colorUI.library.get(id);const stem=id.slice(4);entries.push({name:'source-profile-'+stem+'.icc',data:Uint8Array.from(profile.bytes)});entries.push({name:'source-profile-'+stem+'.json',data:new TextEncoder().encode(JSON.stringify({...profile,bytes:undefined},null,2))});}}
  entries.push({name:'scan-job.json',data:new TextEncoder().encode(JSON.stringify(manifest,null,2))});
  download(createZip(entries),'scan-studio-'+(processed?'processed':'original')+'-'+currentJob.id+'.zip');log('ZIP exported locally · '+(processed?'edited pages':'original JPEGs'));state(`Exported ${currentImages.length} ${processed?'processed':'original'} pages`);
});
button('download-page').onclick=()=>{const saved=currentImages[selected];if(!busy&&saved){const edit=edits.get(saved.filename),useEdit=select('export-mode').value==='processed'&&edit&&isEdited(edit.recipe);download(useEdit?edit.blob:saved.blob,useEdit?saved.filename.replace(/\.jpg$/i,'.png'):saved.filename);state('Downloaded '+(useEdit?'edited PNG':'original JPEG'));}};
button('download-original').onclick=()=>{const saved=currentImages[selected];if(!busy&&saved)download(saved.blob,saved.filename);};
button('previous').onclick=()=>selectPage(selected-1);button('next').onclick=()=>selectPage(selected+1);
button('rotate-left').onclick=()=>editPages('left',true);button('rotate-right').onclick=()=>editPages('right',true);
button('edit-left').onclick=()=>editPages('left');button('edit-right').onclick=()=>editPages('right');
select('process-scope').onchange=controls;
button('auto-crop').onclick=()=>editPages('crop');button('auto-orient').onclick=()=>editPages('orient');button('auto-enhance').onclick=()=>editPages('auto');button('undo-edit').onclick=()=>editPages('undo');button('restore-original').onclick=()=>editPages('restore');
select('preview-version').onchange=()=>{updateThumbnails();renderPreview();};
select('zoom').onchange=renderPreview;
button('fit').onclick=()=>{select('zoom').value='fit';renderPreview();};
function zoomStep(direction:number):void {const steps=['25','50','100','150','200'],value=select('zoom').value,index=value==='fit'?1:steps.indexOf(value);select('zoom').value=steps[Math.max(0,Math.min(steps.length-1,index+direction))]!;renderPreview();}
button('zoom-in').onclick=()=>zoomStep(1);button('zoom-out').onclick=()=>zoomStep(-1);
button('view-grid').onclick=()=>{const overview=document.querySelector('.document-workspace')!.classList.toggle('overview');button('view-grid').setAttribute('aria-pressed',String(overview));button('view-grid').setAttribute('aria-label',overview?'Show document preview':'Show page overview');};
button('toggle-library').onclick=()=>{const narrow=window.matchMedia('(max-width:1100px)').matches,show=narrow?workspace.classList.toggle('library-open'):!workspace.classList.toggle('library-hidden');if(narrow&&show)workspace.classList.remove('inspector-open');panelState();};
button('toggle-inspector').onclick=()=>{const narrow=window.matchMedia('(max-width:760px)').matches,show=narrow?workspace.classList.toggle('inspector-open'):!workspace.classList.toggle('inspector-hidden');if(narrow&&show)workspace.classList.remove('library-open');panelState();};
function panelState():void {
  button('toggle-library').setAttribute('aria-expanded',String(window.matchMedia('(max-width:1100px)').matches?workspace.classList.contains('library-open'):!workspace.classList.contains('library-hidden')));
  button('toggle-inspector').setAttribute('aria-expanded',String(window.matchMedia('(max-width:760px)').matches?workspace.classList.contains('inspector-open'):!workspace.classList.contains('inspector-hidden')));
}
window.matchMedia('(max-width:1100px)').addEventListener('change',panelState);
window.matchMedia('(max-width:760px)').addEventListener('change',panelState);
new ResizeObserver(()=>{if(select('zoom').value==='fit')renderPreview();}).observe(element('stage'));
function showTab(name:string):void {
  for(const tab of ['capture','process','details','activity']){button('tab-'+tab).setAttribute('aria-selected',String(tab===name));button('tab-'+tab).tabIndex=tab===name?0:-1;element(tab+'-panel').hidden=tab!==name;}
}
for(const [index,name] of ['capture','process','details','activity'].entries()){
  const tab=button('tab-'+name);tab.onclick=()=>showTab(name);
  tab.onkeydown=event=>{if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;event.preventDefault();const next=['capture','process','details','activity'][(index+(event.key==='ArrowRight'?1:3))%4]!;showTab(next);button('tab-'+next).focus();};
}
const help=element<HTMLDialogElement>('help-dialog');button('help').onclick=()=>help.showModal();button('close-help').onclick=()=>help.close();
function theme(value:string):void {
  document.documentElement.dataset.theme=value;button('theme').setAttribute('aria-label',value==='dark'?'Switch to light theme':'Switch to dark theme');button('theme').title=value==='dark'?'Switch to light theme':'Switch to dark theme';
}
try{theme(localStorage.getItem('ff680w-theme')==='light'?'light':'dark');}catch{theme('dark');}
button('theme').onclick=()=>{const value=document.documentElement.dataset.theme==='dark'?'light':'dark';theme(value);try{localStorage.setItem('ff680w-theme',value);}catch{}};
document.addEventListener('keydown',event=>{
  if(busy||help.open||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||!(event.target instanceof HTMLElement)||event.target.closest('input,select,textarea,[role=tab]'))return;
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();selectPage(selected+(event.key==='ArrowRight'?1:-1));}
});
window.addEventListener('pagehide',()=>{abort?.abort();processor.dispose();orientation.dispose();colorUI.dispose();if(!busy)void scanner?.disconnect();});
controls();panelState();
void action(async()=>{
  try{await colorUI.init();await history();storageReady=true;if(savedJobs[0]){await loadJob(savedJobs[0]);renderHistory();}}
  catch(error){state('Browser storage unavailable: '+message(error));log(message(error));}
  if(!window.isSecureContext||!registry)state('Use Chrome or Edge on HTTPS or localhost for USB scanning');
});
