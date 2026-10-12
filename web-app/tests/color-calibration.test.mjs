import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {instantiate,TYPE_RGB_DBL,TYPE_XYZ_DBL,INTENT_RELATIVE_COLORIMETRIC,cmsFLAGS_NOOPTIMIZE} from 'lcms-wasm';
import {parseReference,fitScannerProfile,encodeInputICC,predictXYZ,xyzToLab,labToXYZ,deltaE76,D50} from '../dist/color/calibration.js';
import {inspectICC} from '../dist/color/icc.js';
// These are numerical fixtures, never measurements or a supplied target reference.
const known={matrix:[[.4360747,.3850649,.1430804],[.2225045,.7168786,.0606169],[.0139322,.0971045,.7141733]],gamma:[1.65,1.9,2.2]};
const date=new Date('2026-10-11T00:00:00Z');
function fixture(){const samples=[],refs=[];for(const r of [.08,.25,.45,.68,.92])for(const g of [.08,.25,.45,.68,.92])for(const b of [.08,.25,.45,.68,.92]){const id='P'+samples.length,rgb=[r,g,b],xyz=predictXYZ(known,rgb);samples.push({id,rgb});refs.push({id,xyz,lab:xyzToLab(xyz)});}return {samples,refs};}
const data=fixture(),result=fitScannerProfile(data.samples,data.refs,{createdAt:date,name:'Numerical test fixture'});
const cgats=(format,rows,extra='')=>`CGATS.17\n${extra}\nNUMBER_OF_FIELDS ${format.split(' ').length}\nBEGIN_DATA_FORMAT\n${format}\nEND_DATA_FORMAT\nNUMBER_OF_SETS ${rows.length}\nBEGIN_DATA\n${rows.join('\n')}\nEND_DATA\n`;

test('D50 Lab conversion has published white/black boundary values and round trips',()=>{assert.deepEqual(xyzToLab([0,0,0]),[0,0,0]);assert.deepEqual(xyzToLab(D50),[100,0,0]);for(const lab of [[50,20,-30],[3,-2,1],[90,0,0]]){assert.ok(deltaE76(xyzToLab(labToXYZ(lab)),lab)<1e-10);}});
test('CGATS Lab and 0..100 XYZ tables preserve actual ID order, quoting and comments',()=>{
 const parsed=parseReference(cgats('SAMPLE_ID LAB_L LAB_A LAB_B',['"A 1" 50 10 -20 # patch','B2 80 -5 4'],'ILLUMINANT "D50"'));
 assert.deepEqual(parsed.map(p=>p.id),['A 1','B2']);assert.deepEqual(parsed[0].lab,[50,10,-20]);
 const p=parseReference(cgats('SAMPLE_NAME XYZ_X XYZ_Y XYZ_Z',['W 96.42 100 82.49']))[0];assert.ok(p.xyz.every((v,i)=>Math.abs(v-D50[i])<1e-12));assert.ok(deltaE76(p.lab,[100,0,0])<1e-10);
});
test('reference parser rejects bad counts, duplicate IDs, truncation, unsupported illuminant and nonfinite values',()=>{
 for(const value of [cgats('SAMPLE_ID LAB_L LAB_A LAB_B',['A NaN 0 0']),cgats('SAMPLE_ID LAB_L LAB_A LAB_B',['A 50 0 0','A 60 0 0']),cgats('SAMPLE_ID LAB_L LAB_A LAB_B',['A 50 0 0'],'ILLUMINANT D65'),cgats('SAMPLE_ID LAB_L LAB_A LAB_B',['A 50 0 0']).replace('NUMBER_OF_SETS 1','NUMBER_OF_SETS 4'),cgats('SAMPLE_ID LAB_L LAB_A LAB_B',['A 50 0 0']).replace('END_DATA\n',''),cgats('SAMPLE_ID LAB_L LAB_A LAB_B',['"bad 50 0 0'])])assert.throws(()=>parseReference(value));
 assert.throws(()=>parseReference('x'.repeat(2*1024*1024+1)),/limited/);
 assert.throws(()=>parseReference(cgats('SAMPLE_ID XYZ_X XYZ_Y XYZ_Z LAB_L LAB_A LAB_B',['A 50 50 50 10 0 0'])),/disagree/);
});
test('per-channel tone + matrix fit recovers distinct exponents and validates withheld colors',()=>{
 assert.equal(result.report.accepted,true);assert.equal(result.report.metric,'DeltaE76');assert.equal(result.report.training.count+result.report.validation.count,125);assert.equal(result.report.validation.count,31);
 assert.ok(result.report.validation.max<.15,JSON.stringify(result.report));for(let c=0;c<3;c++)assert.ok(Math.abs(result.model.gamma[c]-known.gamma[c])<.025,JSON.stringify(result.model));
 const unseen=[.37,.56,.83];assert.ok(deltaE76(xyzToLab(predictXYZ(result.model,unseen)),xyzToLab(predictXYZ(known,unseen)))<.15);
 assert.deepEqual(result.report.validationIndices.map(i=>data.samples[i].id),result.report.validationIds);
 assert.equal(result.report.validationIds.some(id=>result.report.trainingIds.includes(id)),false);
});
test('holdout corruption fails acceptance without influencing fitted model or profile bytes',()=>{
 const ids=result.report.validationIds,changed=data.refs.map(p=>ids.includes(p.id)?{...p,xyz:labToXYZ([p.lab[0],p.lab[1]+35,p.lab[2]]),lab:[p.lab[0],p.lab[1]+35,p.lab[2]]}:p);
 const bad=fitScannerProfile(data.samples,changed,{validationIds:ids,createdAt:date,name:'Numerical test fixture'});
 assert.deepEqual(bad.model,result.model);assert.deepEqual(bad.iccBytes,result.iccBytes);assert.equal(bad.report.accepted,false);assert.ok(bad.report.validation.mean>20);assert.deepEqual(bad.report.training,result.report.training);
});
test('invalid/clipped/too few/singular/limited coverage measurements cannot produce trusted profiles',()=>{
 assert.throws(()=>fitScannerProfile(data.samples.slice(0,23),data.refs),/24/);
 assert.throws(()=>fitScannerProfile([{...data.samples[0],rgb:[NaN,.3,.4]},...data.samples.slice(1)],data.refs),/finite/);
 assert.throws(()=>fitScannerProfile([data.samples[0],...data.samples],data.refs),/unique/);
 assert.throws(()=>fitScannerProfile([{id:'UNKNOWN',rgb:[.5,.5,.5]},...data.samples.slice(1)],data.refs),/missing/);
 const excluded=fitScannerProfile(data.samples.map((p,i)=>i===0?{...p,clippedFraction:.2}:p),data.refs,{createdAt:date});assert.deepEqual(excluded.report.excludedIds,['P0']);
 const gray=Array.from({length:32},(_,i)=>({id:'G'+i,rgb:[.05+i*.025,.05+i*.025,.05+i*.025]})),refs=gray.map(p=>{const xyz=predictXYZ(known,p.rgb);return {id:p.id,xyz,lab:xyzToLab(xyz)};});assert.throws(()=>fitScannerProfile(gray,refs),/diverse|singular/);
 assert.throws(()=>fitScannerProfile(data.samples,data.refs,{validationIds:['P0','P0']}),/uniquely/);
 assert.throws(()=>fitScannerProfile(data.samples,data.refs,{validationIds:['P0']}),/18 training and 6/);
});
test('ICC input profile structure, D50 colorants and sampled monotonic curves are valid',()=>{
 const metadata=inspectICC(result.iccBytes);assert.equal(metadata.deviceClass,'scnr');assert.equal(metadata.pcs,'XYZ ');assert.equal(metadata.version,'4.3.0');assert.equal(metadata.description,'Numerical test fixture');
 assert.deepEqual(metadata.tags.map(t=>t.signature),['desc','cprt','wtpt','rXYZ','gXYZ','bXYZ','rTRC','gTRC','bTRC']);
 const d=new DataView(result.iccBytes.buffer);for(const t of metadata.tags){assert.equal(t.offset%4,0);if(t.signature.endsWith('TRC')){const n=d.getUint32(t.offset+8);assert.equal(n,4096);assert.equal(d.getUint16(t.offset+12),0);assert.equal(d.getUint16(t.offset+12+2*(n-1)),65535);let last=0;for(let i=0;i<n;i++){const v=d.getUint16(t.offset+12+i*2);assert.ok(v>=last);last=v;}}}
 assert.throws(()=>encodeInputICC({...known,gamma:[-1,1,1]},'Invalid'),/Invalid/);
 assert.throws(()=>encodeInputICC({...known,matrix:[[1,1,1],[1,1,1],[1,1,1]]},'Invalid'),/Invalid/);
});
test('independent LittleCMS reads profile and XYZ transform agrees with fitted model',async()=>{
 const binary=await readFile(new URL('../node_modules/lcms-wasm/dist/lcms.wasm',import.meta.url));const lcms=await instantiate({wasmBinary:binary});
 const src=lcms.cmsOpenProfileFromMem(result.iccBytes,result.iccBytes.length),dst=lcms.cmsCreateXYZProfile();assert.ok(src);assert.ok(dst);let transform;
 try { transform=lcms.cmsCreateTransform(src,TYPE_RGB_DBL|4,dst,TYPE_XYZ_DBL|4,INTENT_RELATIVE_COLORIMETRIC,cmsFLAGS_NOOPTIMIZE);assert.ok(transform);
  for(const rgb of [[.12,.56,.87],[.75,.22,.61],[.45,.45,.45],[1,1,1]]){const actual=lcms.cmsDoTransform(transform,rgb,1),expected=predictXYZ(result.model,rgb);for(let c=0;c<3;c++)assert.ok(Math.abs(actual[c]-expected[c])<.0003,`${actual} vs ${expected}`);}
 }finally{if(transform)lcms.cmsDeleteTransform(transform);lcms.cmsCloseProfile(src);lcms.cmsCloseProfile(dst);}
});
test('robust fit limits the influence of one misread training patch',()=>{
 const id=result.report.trainingIds[12];const dirty=data.samples.map(p=>p.id===id?{...p,rgb:[.82,.11,.48]}:p);
 const robust=fitScannerProfile(dirty,data.refs,{validationIds:result.report.validationIds,createdAt:date});
 assert.equal(robust.report.accepted,true);assert.ok(robust.report.validation.max<.5,JSON.stringify(robust.report.validation));assert.ok(robust.report.training.max>10);
});
test('nonsingular-design guard rejects nearly indistinguishable RGB channel responses',()=>{
 const near=data.samples.map((p,i)=>({...p,rgb:[p.rgb[0],p.rgb[0]+1e-7*(i%4),p.rgb[0]+1e-7*(i%7)]}));
 assert.throws(()=>fitScannerProfile(near,data.refs),/singular|conditioned/);
});
test('explicit incompatible observer metadata is rejected',()=>{
 assert.throws(()=>parseReference(cgats('SAMPLE_ID LAB_L LAB_A LAB_B',['A 50 0 0'],'OBSERVER_ANGLE 10')),/2 degree/);
 assert.equal(parseReference(cgats('SAMPLE_ID LAB_L LAB_A LAB_B',['A 50 0 0'],'OBSERVER_ANGLE 2')).length,1);
});
test('ICC export rejects negative XYZ colorants permitted by some CMMs but forbidden by XYZType',()=>{
 assert.throws(()=>encodeInputICC({...known,matrix:[[.436,-.01,.143],[.222,.716,.060],[.013,.097,.714]]},'Negative primary'),/Invalid/);
});
test('fit uses nonnegative constraints rather than clamping final profile colorants',()=>{
 const response={...known,matrix:[[.436,.385,.143],[.222,.716,.060],[-.0005,.097,.714]]};
 const refs=data.samples.map(p=>{const xyz=predictXYZ(response,p.rgb);return {id:p.id,xyz,lab:xyzToLab(xyz)};});
 const constrained=fitScannerProfile(data.samples,refs,{createdAt:date});
 assert.ok(constrained.model.matrix.flat().every(v=>v>=0));assert.equal(inspectICC(constrained.iccBytes).deviceClass,'scnr');assert.ok(constrained.report.validation.max<5);
});
