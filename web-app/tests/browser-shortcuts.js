import {ScanStore} from './storage.js';
import {DEFAULT_OPTIONS} from './planner.js';
const report=document.getElementById('report'),frame=document.getElementById('app');
const store=new ScanStore();let count=0;
function assert(condition,label){if(!condition)throw Error(label);report.textContent+='\nPASS '+label;count++;}
async function until(predicate,label){const deadline=performance.now()+10000;while(!await predicate()){if(performance.now()>deadline)throw Error('Timed out: '+label);await new Promise(resolve=>setTimeout(resolve,20));}}
const el=id=>frame.contentDocument?.getElementById(id);
async function loaded(){await until(()=>el('next')&&!el('next').disabled,'load synthetic job');}
async function reloadApp(){const load=new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}));frame.src='./index.html?keyboard-check='+crypto.randomUUID();await load;await loaded();}
function key(name,{shift=false,mod=false,ctrl=false,alt=false,repeat=false,target}={}){
 const mac=/Mac|iPhone|iPad/.test(frame.contentWindow.navigator.platform);
 const event=new frame.contentWindow.KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true,shiftKey:shift,metaKey:mod&&mac,ctrlKey:ctrl||(mod&&!mac),altKey:alt,repeat});
 (target??frame.contentDocument.body).dispatchEvent(event);return event.defaultPrevented;
}
async function edit(name,extra={},rotation){assert(key(name,extra),'handled '+name);assert(!key('ArrowRight'),'page navigation stays disabled during an edit');await until(async()=>!el('rotate-right').disabled&&(await store.edits((await store.jobs())[0].id)).find(edit=>edit.filename==='001-front.jpg')?.recipe.rotation===rotation,'finish '+name);}
document.getElementById('run').onclick=async()=>{
 document.getElementById('run').disabled=true;report.textContent='Running';count=0;
 try{
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=96;const ctx=canvas.getContext('2d');ctx.fillStyle='#f4f0e0';ctx.fillRect(0,0,64,96);ctx.fillStyle='#8427bb';ctx.fillRect(2,4,20,35);
  const jpeg=new Uint8Array(await (await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.95))).arrayBuffer());
  const job=await store.createJob({...DEFAULT_OPTIONS,duplex:true});
  for(const [index,side] of ['front','back','front'].entries())await store.saveImage(job.id,{filename:(index<2?'001':'002')+'-'+side+'.jpg',sheet:index<2?1:2,side,image:jpeg});
  await store.finish(job.id,'complete');
  await reloadApp();
  assert(el('page-counter').textContent==='1 / 3','initial page restored');
  assert(key('ArrowRight')&&el('page-counter').textContent==='2 / 3','right arrow selects next page');
  assert(key('End')&&el('page-counter').textContent==='3 / 3','End selects last page');
  assert(key('Home')&&el('page-counter').textContent==='1 / 3','Home selects first page');
  assert(!key('r',{mod:true})&&!key('R',{mod:true,shift:true}),'browser reload shortcuts remain native');
  assert(!key('Enter',{mod:true}),'disconnected scan shortcut is disabled');
  const typing=document.createElement('div');typing.contentEditable='true';typing.textContent='editable';frame.contentDocument.body.append(typing);
  assert(!key('r',{target:typing})&&!key('z',{mod:true,target:typing}),'contenteditable keeps rotation and undo keys');typing.remove();
  assert(!key('r',{target:el('job-search')})&&!key('r',{target:el('dpi')})&&!key('ArrowRight',{target:el('sheets')}),'search and capture controls retain normal keys');
  assert(key('2'),'Edit tab shortcut');assert(el('tab-process').getAttribute('aria-selected')==='true','Edit panel opened');
  assert(!key('ArrowRight',{target:el('tab-process')})||el('tab-details').getAttribute('aria-selected')==='true','tab arrow navigation belongs to tab widget');
  await edit('r',{target:el('tab-process')},90);
  assert(!key('r',{repeat:true}),'held rotation cannot enqueue edits');
  await edit('R',{shift:true},0);
  await edit('z',{mod:true},90);
  assert(!el('redo-edit').disabled,'redo becomes available after undo');
  // Reload through a real app startup, preserving the synthetic job and redo.
  await reloadApp();
  assert(!el('redo-edit').disabled,'redo survives page reload');
  await edit('Z',{mod:true,shift:true},0);
  assert(el('redo-edit').disabled,'redo stack empties after redo');
  if(frame.contentDocument.querySelector('.workspace').classList.contains('inspector-open')||frame.contentDocument.querySelector('.workspace').classList.contains('library-open'))assert(key('Escape'),'Escape closes the drawer first');
  assert(key('r'),'start cancellable edit');assert(key('Escape'),'Escape requests processing stop');await until(()=>!el('rotate-right').disabled,'processing stopped');
  assert((await store.edits(job.id)).find(edit=>edit.filename==='001-front.jpg').recipe.rotation===0,'cancellation preserves prior edit and originals');
  assert(key('4'),'Activity tab shortcut');assert(key('2'),'return to Edit tab');
  el('process-scope').value='all';el('process-scope').dispatchEvent(new frame.contentWindow.Event('change'));assert(key('r',{alt:true}),'rotate all pages using modifier shortcut');
  await until(async()=>!el('rotate-right').disabled&&(await store.edits(job.id)).length===3,'batch edit complete');
  assert(key('z',{mod:true}),'batch undo shortcut');await until(async()=>!el('rotate-right').disabled&&(await store.edits(job.id)).every(edit=>edit.recipe.rotation===0),'batch undo complete');
  assert(key('Z',{mod:true,shift:true}),'batch redo shortcut');await until(async()=>!el('rotate-right').disabled&&(await store.edits(job.id)).every(edit=>edit.recipe.rotation===90),'batch redo complete');
  assert((await store.edits(job.id)).every(edit=>edit.recipe.rotation===90),'undo and redo honor the all-pages scope');
  el('process-scope').value='page';el('process-scope').dispatchEvent(new frame.contentWindow.Event('change'));
  assert(key('0')&&el('zoom').value==='100','actual-size shortcut');
  assert(key('+',{shift:true})&&el('zoom').value==='150','shifted plus zooms preview');
  assert(key('f')&&el('zoom').value==='fit','fit shortcut');
  assert(key('v')&&el('preview-version').value==='original','preview original switch');
  assert(key('b')&&el('export-mode').value==='original','export version switch');
  assert(key('g')&&el('view-grid').getAttribute('aria-pressed')==='true','page overview switch');
  assert(key('/')&&frame.contentDocument.activeElement===el('job-search'),'search shortcut moves focus');
  frame.contentDocument.activeElement.blur();
  assert(key('?',{shift:true})&&el('shortcuts-dialog').open,'shortcut sheet opens');
  assert(!key('r')&&!key('Escape'),'dialogs isolate app keys and retain native Escape cancel');
  assert(el('rotate-right').getAttribute('aria-keyshortcuts')==='r','rotation has ARIA shortcut metadata');
  el('single-key-shortcuts').checked=false;el('single-key-shortcuts').dispatchEvent(new frame.contentWindow.Event('change'));
  el('close-shortcuts').click();assert(!key('r')&&!key('1'),'single keys can be disabled');
  assert(!el('rotate-right').hasAttribute('aria-keyshortcuts'),'disabled single shortcuts clear ARIA metadata');
  assert(key('ArrowRight'),'navigation works with single keys disabled');
  await reloadApp();assert(!el('single-key-shortcuts').checked&&!key('r'),'shortcut preference survives reload');
  el('shortcuts').click();el('single-key-shortcuts').checked=true;el('single-key-shortcuts').dispatchEvent(new frame.contentWindow.Event('change'));el('close-shortcuts').click();
  const images=await store.images(job.id);assert(images.length===3&&new Uint8Array(await images[0].blob.arrayBuffer()).every((value,index)=>value===jpeg[index])&&images[0].blob.size===jpeg.length,'keyboard edits preserve all original JPEGs');
  report.textContent+='\nCOMPLETE '+count+' checks passed';
 }catch(error){report.textContent+='\nFAIL '+error.stack;}
 finally{document.getElementById('run').disabled=false;}
};
