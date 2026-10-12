import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {capabilities,cropUnavailableReason} from '../dist/capabilities.js';
const live=JSON.parse(await readFile(new URL('./fixtures/ff680w-capabilities.json',import.meta.url),'utf8')).CAPA;
test('live FF-680W capabilities provide model-supported option constraints',()=>{
  const c=capabilities(live);
  assert.deepEqual(c.resolutions,[50,75,100,150,200,240,300,360,400,600]);
  assert.deepEqual(c.cropResolutions,[300,600]);assert.deepEqual(c.quality,{min:1,max:100});
  for(const flag of ['duplex','color','gray','crop','deskew','doubleFeed'])assert.equal(c[flag],true,flag);
});
test('hardware cropping requires both crop and paper-end detection capabilities',()=>{
  for(const missing of ['CRP ','PEDT']){const c=capabilities(live.filter(item=>!(item.name==='ADF'&&item.value===missing)));assert.equal(c.crop,false);assert.match(cropUnavailableReason(c,300),/does not advertise/);}
});
test('crop resolution is separate from general scan resolution',()=>{
  const c=capabilities(live);assert.equal(cropUnavailableReason(c,300),undefined);assert.equal(cropUnavailableReason(c,600),undefined);
  for(const dpi of [50,200,360,400])assert.equal(cropUnavailableReason(c,dpi),'Cropping requires 300 or 600 dpi.');
});
test('general resolution must be advertised for both acquisition axes',()=>{
  const c=capabilities(live.map(item=>item.name==='RSS'?{name:'RSS',value:'LISTd200d300d1200'}:item));assert.deepEqual(c.resolutions,[200,300]);
});
test('missing or malformed capabilities do not claim optional feature support',()=>{
  const c=capabilities([null,7,{name:'ADF',value:7},{name:'RSM',value:'LISTd300'}]);
  assert.deepEqual(c.resolutions,[]);assert.equal(c.duplex,false);assert.equal(c.crop,false);assert.equal(c.gray,false);assert.equal(c.doubleFeed,false);
});
