import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {rendererOwnsChord,installRendererShortcuts} from '../keyboard.mjs';
test('app undo, redo, save and preview zoom reach the renderer instead of native menu accelerators',()=>{
 for(const platform of ['darwin','win32','linux']){
  const mod=platform==='darwin'?{meta:true}:{control:true};
  for(const key of ['z','s','+','-','0','Enter'])assert.equal(rendererOwnsChord({key,...mod},platform),true,key);
  for(const key of ['r','c','v','x','q','w','l','t','f','1'])assert.equal(rendererOwnsChord({key,...mod},platform),false,key);
  assert.equal(rendererOwnsChord({key:'z',...mod,isComposing:true},platform),false);
 }
});
test('the native shortcut bypass resets for the next non-app chord without suppressing renderer events',()=>{
 const contents=new EventEmitter(),calls=[];contents.setIgnoreMenuShortcuts=value=>calls.push(value);
 installRendererShortcuts(contents,'darwin');const event={preventDefault(){throw Error('Renderer must still receive the key');}};
 contents.emit('before-input-event',event,{key:'z',meta:true});contents.emit('before-input-event',event,{key:'c',meta:true});contents.emit('before-input-event',event,{key:'r'});
 assert.deepEqual(calls,[true,false,false]);
});
