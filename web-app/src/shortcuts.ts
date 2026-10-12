/** Shared command definitions drive matching, tooltips, ARIA and the help sheet. */
export interface KeyChord {key:string; mod?:boolean; shift?:boolean; alt?:boolean}
export interface ShortcutCommand {
  id:string; label:string; group:string; keys:readonly KeyChord[];
  button?:string; repeat?:boolean;
}
const key=(key:string,extra:Omit<KeyChord,'key'>={}):KeyChord=>({key,...extra});
export const SHORTCUTS:readonly ShortcutCommand[]=[
  {id:'connect',label:'Connect USB scanner',group:'Capture',button:'connect',keys:[key('u')]},
  {id:'disconnect',label:'Disconnect scanner',group:'Capture',button:'disconnect',keys:[key('u',{alt:true})]},
  {id:'discover-network',label:'Find network scanners (desktop)',group:'Capture',button:'discover-network',keys:[key('n',{shift:true})]},
  {id:'read-network',label:'Connect selected network scanner (desktop)',group:'Capture',button:'read-network',keys:[key('Enter',{alt:true})]},
  {id:'scan',label:'Scan loaded sheets',group:'Capture',button:'scan',keys:[key('Enter',{mod:true})]},
  {id:'stop',label:'Stop capture or processing',group:'Capture',button:'stop',keys:[key('Escape')]},
  {id:'new-job',label:'New scan workspace',group:'Capture',button:'new-job',keys:[key('n')]},
  {id:'read',label:'Read device settings',group:'Capture',button:'read',keys:[key('u',{shift:true})]},
  {id:'previous',label:'Previous page',group:'Pages',button:'previous',repeat:true,keys:[key('ArrowLeft'),key('PageUp')]},
  {id:'next',label:'Next page',group:'Pages',button:'next',repeat:true,keys:[key('ArrowRight'),key('PageDown')]},
  {id:'first',label:'First page',group:'Pages',keys:[key('Home')]},
  {id:'last',label:'Last page',group:'Pages',keys:[key('End')]},
  {id:'rotate-right',label:'Rotate selected page clockwise',group:'Edit',button:'rotate-right',keys:[key('r')]},
  {id:'rotate-left',label:'Rotate selected page counterclockwise',group:'Edit',button:'rotate-left',keys:[key('r',{shift:true})]},
  {id:'edit-right',label:'Rotate clockwise in Edit scope',group:'Edit',button:'edit-right',keys:[key('r',{alt:true})]},
  {id:'edit-left',label:'Rotate counterclockwise in Edit scope',group:'Edit',button:'edit-left',keys:[key('r',{alt:true,shift:true})]},
  {id:'undo-edit',label:'Undo edit',group:'Edit',button:'undo-edit',keys:[key('z',{mod:true})]},
  {id:'redo-edit',label:'Redo edit',group:'Edit',button:'redo-edit',keys:[key('z',{mod:true,shift:true}),key('y',{mod:true})]},
  {id:'auto-crop',label:'Auto-crop paper boundary',group:'Edit',button:'auto-crop',keys:[key('c')]},
  {id:'auto-orient',label:'Auto-orient text',group:'Edit',button:'auto-orient',keys:[key('o')]},
  {id:'auto-enhance',label:'Auto-crop and orient',group:'Edit',button:'auto-enhance',keys:[key('a')]},
  {id:'restore-original',label:'Restore original',group:'Edit',button:'restore-original',keys:[key('x',{shift:true})]},
  {id:'preview-version',label:'Switch original / edited preview',group:'View',keys:[key('v')]},
  {id:'zoom-in',label:'Zoom page in',group:'View',button:'zoom-in',repeat:true,keys:[key('='),key('+',{shift:true}),key('+'),key('=',{mod:true}),key('+',{mod:true,shift:true}),key('+',{mod:true})]},
  {id:'zoom-out',label:'Zoom page out',group:'View',button:'zoom-out',repeat:true,keys:[key('-'),key('-',{mod:true})]},
  {id:'fit',label:'Fit page to workspace',group:'View',button:'fit',keys:[key('f'),key('0',{mod:true})]},
  {id:'actual-size',label:'Actual size (100%)',group:'View',keys:[key('0')]},
  {id:'view-grid',label:'Switch page overview / preview',group:'View',button:'view-grid',keys:[key('g')]},
  {id:'toggle-library',label:'Toggle saved jobs',group:'Workspace',button:'toggle-library',keys:[key('l')]},
  {id:'toggle-inspector',label:'Toggle inspector',group:'Workspace',button:'toggle-inspector',keys:[key('i')]},
  {id:'search',label:'Search saved jobs',group:'Workspace',keys:[key('/')]},
  ...['Capture','Edit','Page info','Activity'].map((name,index)=>({id:'tab-'+['capture','process','details','activity'][index],label:'Show '+name,group:'Workspace',button:'tab-'+['capture','process','details','activity'][index],keys:[key(String(index+1))]})),
  {id:'theme',label:'Switch light / dark theme',group:'Workspace',button:'theme',keys:[key('t')]},
  {id:'export',label:'Export scan ZIP',group:'Export',button:'export',keys:[key('s',{mod:true})]},
  {id:'download-page',label:'Download selected page',group:'Export',button:'download-page',keys:[key('s',{mod:true,shift:true})]},
  {id:'download-original',label:'Download original JPEG',group:'Export',button:'download-original',keys:[key('s',{mod:true,alt:true})]},
  {id:'export-mode',label:'Switch edited / original export',group:'Export',keys:[key('b')]},
  {id:'apply-color',label:'Apply selected color profile',group:'Color',button:'apply-color',keys:[key('p')]},
  {id:'remove-color',label:'Remove color correction',group:'Color',button:'remove-color',keys:[key('p',{shift:true})]},
  {id:'import-profile',label:'Import ICC profile',group:'Color',button:'import-profile',keys:[key('i',{shift:true})]},
  {id:'compare-color',label:'Compare with another scan',group:'Color',button:'compare-color',keys:[key('c',{shift:true})]},
  {id:'calibrate-color',label:'Create measured profile',group:'Color',button:'calibrate-color',keys:[key('m',{shift:true})]},
  {id:'help',label:'Scanning help',group:'Help',button:'help',keys:[key('h')]},
  {id:'shortcuts',label:'Keyboard shortcuts',group:'Help',button:'shortcuts',keys:[key('?',{shift:true}),key('?')]},
];
export type ShortcutEvent=Pick<KeyboardEvent,'key'|'metaKey'|'ctrlKey'|'altKey'|'shiftKey'|'repeat'|'isComposing'|'defaultPrevented'|'getModifierState'>&{code?:string};
const normalized=(value:string)=>value.length===1?value.toLowerCase():value;
const character=(chord:KeyChord)=>chord.key.length===1&&!chord.mod&&!chord.alt;
export function matchShortcut(event:ShortcutEvent,mac:boolean,singleKeys=true):ShortcutCommand|undefined {
  if(event.defaultPrevented||event.isComposing||event.getModifierState('AltGraph'))return;
  // A macOS Control chord is not a Command chord; mixed modifiers also stay native.
  if(mac?event.ctrlKey:event.metaKey)return;
  // macOS Option produces glyphs such as ® for R. Those modifier commands use
  // their named physical letter key while ordinary typing stays untouched.
  const pressed=mac&&event.altKey&&/^Key[A-Z]$/.test(event.code??'')?event.code!.slice(3).toLowerCase():normalized(event.key);
  return SHORTCUTS.find(command=>(!event.repeat||command.repeat)&&command.keys.some(chord=>
    (singleKeys||!character(chord))&&pressed===normalized(chord.key)&&
    (mac?event.metaKey:event.ctrlKey)===!!chord.mod&&event.altKey===!!chord.alt&&event.shiftKey===!!chord.shift));
}
export function ownsKeyboard(target:EventTarget|null,eventKey=''):boolean {
  // Adopted DOM nodes can come from another realm; instanceof misses those.
  const node=target as Element|null;if(!node||node.nodeType!==1||typeof node.closest!=='function')return false;
  const editable=node.closest('[contenteditable]');
  return (node as HTMLElement).isContentEditable===true||!!(editable&&editable.getAttribute('contenteditable')!=='false')||
    !!node.closest('input,textarea,select,[role="textbox"],[role="combobox"],[role="slider"],[role="spinbutton"],[role="listbox"],[role="menu"],[role="tree"],[role="grid"],audio,video')||
    !!node.closest('[role="tab"]')&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Enter',' '].includes(eventKey);
}
const names:Record<string,string>={ArrowLeft:'←',ArrowRight:'→',PageUp:'Page Up',PageDown:'Page Down',Escape:'Esc',Enter:'Enter',' ':'Space'};
export function formatChord(chord:KeyChord,mac:boolean):string {
  return [...(chord.mod?[mac?'⌘':'Ctrl']:[]),...(chord.alt?[mac?'Option':'Alt']:[]),...(chord.shift&&!['+','?'].includes(chord.key)?['Shift']:[]),names[chord.key]??chord.key.toUpperCase()].join(' + ');
}
export function ariaChord(chord:KeyChord,mac:boolean):string {
  return [...(chord.mod?[mac?'Meta':'Control']:[]),...(chord.alt?['Alt']:[]),...(chord.shift?['Shift']:[]),chord.key==='+'?'Plus':chord.key].join('+');
}
/** Attach only after app commands exist. Disabled controls are authoritative. */
export function installShortcuts(options:{document:Document;mac:boolean;execute(id:string):boolean}):()=>void {
  const doc=options.document,checkbox=doc.getElementById('single-key-shortcuts') as HTMLInputElement;
  const storageKey='scan-studio-single-key-shortcuts';
  let singleKeys=true;try{singleKeys=localStorage.getItem(storageKey)!=='off';}catch{}
  checkbox.checked=singleKeys;
  const guide=doc.getElementById('shortcut-list')!;
  for(const group of ['Edit','Pages','View','Capture','Workspace','Export','Color','Help']) {
    const section=doc.createElement('section'),heading=doc.createElement('h3'),list=doc.createElement('dl');heading.textContent=group;
    for(const command of SHORTCUTS.filter(command=>command.group===group)) {
      const name=doc.createElement('dt'),keys=doc.createElement('dd');name.textContent=command.label;
      // Physical Plus and shifted Equals variants share the same display shortcut.
      const visible=command.keys.filter(chord=>!['+','?'].includes(chord.key)||chord.shift);
      const formatted=[...new Set(visible.map(chord=>formatChord(chord,options.mac)))];
      for(const [index,shortcut] of formatted.entries()){if(index)keys.append(doc.createTextNode(' / '));const kbd=doc.createElement('kbd');kbd.textContent=shortcut;keys.append(kbd);}
      list.append(name,keys);
    }
    section.append(heading,list);guide.append(section);
  }
  const decorate=()=>{
    for(const command of SHORTCUTS)if(command.button){
      const control=doc.getElementById(command.button)!;
      const chords=command.keys.filter(chord=>singleKeys||!character(chord));
      if(chords.length)control.setAttribute('aria-keyshortcuts',chords.map(chord=>ariaChord(chord,options.mac)).join(' '));else control.removeAttribute('aria-keyshortcuts');
      const base=control.dataset.shortcutTitle??control.getAttribute('title')??control.getAttribute('aria-label')??command.label;
      control.dataset.shortcutTitle=base;
      control.dataset.shortcutSuffix=chords.length?' ('+formatChord(chords[0]!,options.mac)+')':'';
      control.title=base+control.dataset.shortcutSuffix;
    }
  };
  const change=()=>{singleKeys=checkbox.checked;try{localStorage.setItem(storageKey,singleKeys?'on':'off');}catch{}decorate();};
  checkbox.addEventListener('change',change);decorate();
  const handler=(event:KeyboardEvent)=>{
    // Modal dialogs, editing widgets, IME input and selected text keep their keys.
    // Escape in a dialog uses native cancel, including its existing cleanup hooks.
    if(doc.querySelector('dialog[open]'))return;
    const command=matchShortcut(event,options.mac,singleKeys);
    const global=command&&['scan','export','download-page','download-original'].includes(command.id);
    if(!global&&(ownsKeyboard(event.composedPath()[0]??event.target,event.key)||doc.getSelection()?.toString()))return;
    if(command&&options.execute(command.id))event.preventDefault();
  };
  doc.addEventListener('keydown',handler);
  return ()=>{doc.removeEventListener('keydown',handler);checkbox.removeEventListener('change',change);};
}
