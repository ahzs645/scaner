import test from 'node:test';
import assert from 'node:assert/strict';
import {SHORTCUTS,matchShortcut,formatChord,ariaChord} from '../dist/shortcuts.js';
const event=(key,extra={})=>({key,metaKey:false,ctrlKey:false,altKey:false,shiftKey:false,repeat:false,isComposing:false,defaultPrevented:false,getModifierState:()=>false,...extra});
const match=(key,extra={},mac=true,single=true)=>matchShortcut(event(key,extra),mac,single)?.id;
test('rotation direction and OS-specific undo/redo chords match without consuming browser reload',()=>{
  assert.equal(match('r'),'rotate-right');assert.equal(match('R',{shiftKey:true}),'rotate-left');
  assert.equal(match('z',{metaKey:true}),'undo-edit');assert.equal(match('Z',{metaKey:true,shiftKey:true}),'redo-edit');
  assert.equal(match('y',{ctrlKey:true},false),'redo-edit');assert.equal(match('s',{ctrlKey:true},false),'export');
  assert.equal(match('Enter',{metaKey:true}),'scan');
  for(const key of ['r','l','f','n','t','w','1']){
    assert.equal(match(key,{metaKey:true}),undefined,key);
    assert.equal(match(key,{ctrlKey:true},false),undefined,key);
  }
  assert.equal(match('r',{metaKey:true,shiftKey:true}),undefined);
  assert.equal(match('®',{code:'KeyR',altKey:true}),'edit-right');
  assert.equal(match('®',{code:'KeyR',altKey:true,shiftKey:true}),'edit-left');
});
test('single-character shortcuts can be disabled without disabling undo, navigation or stopping',()=>{
  for(const key of ['r','c','a','n','/','1','?','0'])assert.equal(match(key,{},true,false),undefined,key);
  assert.equal(match('ArrowRight',{},true,false),'next');assert.equal(match('Escape',{},true,false),'stop');
  assert.equal(match('z',{metaKey:true},true,false),'undo-edit');assert.equal(match('0',{metaKey:true},true,false),'fit');
});
test('IME, AltGraph, handled events, wrong modifiers and repeated edits never run commands',()=>{
  for(const extra of [{isComposing:true},{defaultPrevented:true},{getModifierState:key=>key==='AltGraph'},{altKey:true,metaKey:true},{ctrlKey:true},{repeat:true}])assert.equal(match('r',extra),undefined);
  assert.equal(match('z',{ctrlKey:true}),undefined);assert.equal(match('z',{metaKey:true},false),undefined);
  assert.equal(match('z',{ctrlKey:true,metaKey:true}),undefined);
  assert.equal(match('Enter',{metaKey:true,repeat:true}),undefined);
  assert.equal(match('ArrowRight',{repeat:true}),'next');assert.equal(match('=',{repeat:true}),'zoom-in');
});
test('shifted punctuation, platform hints and ARIA descriptions stay consistent',()=>{
  assert.equal(match('+',{metaKey:true,shiftKey:true}),'zoom-in');assert.equal(match('+',{metaKey:true}),'zoom-in');
  assert.equal(match('?',{shiftKey:true}),'shortcuts');assert.equal(match('?'),'shortcuts');
  assert.equal(formatChord({key:'z',mod:true,shift:true},true),'⌘ + Shift + Z');
  assert.equal(formatChord({key:'z',mod:true},false),'Ctrl + Z');
  assert.equal(formatChord({key:'?',shift:true},true),'?');
  assert.equal(ariaChord({key:'z',mod:true,shift:true},true),'Meta+Shift+z');
  assert.equal(ariaChord({key:'+',mod:true},false),'Control+Plus');
});
test('the command registry has unique IDs and no ambiguous chord on either platform',()=>{
  assert.equal(new Set(SHORTCUTS.map(s=>s.id)).size,SHORTCUTS.length);
  for(const mac of [true,false]){
    const seen=new Set();
    for(const command of SHORTCUTS)for(const chord of command.keys){
      const signature=JSON.stringify([chord.key,!!chord.mod,!!chord.alt,!!chord.shift]);assert.ok(!seen.has(signature),signature);seen.add(signature);
      assert.equal(matchShortcut(event(chord.key,{[mac?'metaKey':'ctrlKey']:true&&!!chord.mod,altKey:!!chord.alt,shiftKey:!!chord.shift}),mac)?.id,command.id);
    }
  }
});
