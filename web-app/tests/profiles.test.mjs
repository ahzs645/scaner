import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {FF680W_PROFILE} from '../dist/profiles/ff680w.js';
import {DEFAULT_OPTIONS,buildScanPlan} from '../dist/planner.js';
import {capabilities} from '../dist/capabilities.js';
const live=JSON.parse(await readFile(new URL('./fixtures/ff680w-capabilities.json',import.meta.url),'utf8')).CAPA;

test('FF-680W profile preserves the existing hardware payload and defaults',()=>{
  assert.equal(FF680W_PROFILE.defaults,DEFAULT_OPTIONS);
  assert.equal(FF680W_PROFILE.usbInterface.number,0);
  assert.deepEqual(FF680W_PROFILE.settingsCommands,['INFO','CAPA','RESA','STAT']);
  for(const variant of [{},{mode:'gray'},{duplex:true,auto_crop:true,dpi:600}]) {
    const options={...DEFAULT_OPTIONS,...variant};
    assert.deepEqual(FF680W_PROFILE.buildScanPlan(options),buildScanPlan(options));
  }
});

test('FF-680W resolution constraints belong to the profile rather than the generic decoder',()=>{
  const items=live.filter(t=>!['RSM','RSS'].includes(t.name)).concat([
    {name:'RSM',value:'LISTd300d900'},{name:'RSS',value:'LISTd300d900'},
    {name:'ADF',value:'RSMSLISTd900'},
  ]);
  const generic=capabilities(items),specific=FF680W_PROFILE.decodeCapabilities(items);
  assert.deepEqual(generic.resolutions,[300,900]);
  assert.deepEqual(specific.resolutions,[300]);
  assert.deepEqual(generic.cropResolutions,[300,600,900]);
  assert.deepEqual(specific.cropResolutions,[300,600]);
});

test('FF-680W profile only issues manual feeder load when CAPA advertises it',()=>{
  for(const settings of [{},{CAPA:live},{CAPA:[{name:'ADF',value:'DPLX'}]}]) {
    assert.deepEqual(FF680W_PROFILE.mechanicalActions(settings),[]);
  }
  assert.deepEqual(FF680W_PROFILE.mechanicalActions({CAPA:[{name:'ADF',value:'LISTLOADDPLX'}]}),['#ADFLOAD']);
});
