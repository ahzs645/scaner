import {matchShortcut} from '../dist/shortcuts.js';
/** Let the renderer own app chords rather than Electron's default Edit/View menu.
 * Native text input still handles unconsumed key events; clipboard, quit and
 * reload keep their normal menu accelerators. No global shortcuts are registered. */
export function rendererOwnsChord(input,platform=process.platform){
  if(!input.meta&&!input.control)return false;
  return !!matchShortcut({key:input.key,code:input.code,metaKey:!!input.meta,ctrlKey:!!input.control,
    altKey:!!input.alt,shiftKey:!!input.shift,repeat:false,isComposing:!!input.isComposing,
    defaultPrevented:false,getModifierState:()=>false},platform==='darwin');
}
export function installRendererShortcuts(contents,platform=process.platform){
  contents.on('before-input-event',(_event,input)=>contents.setIgnoreMenuShortcuts(rendererOwnsChord(input,platform)));
}
