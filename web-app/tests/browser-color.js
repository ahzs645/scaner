import {fixtureJPEG} from './color-fixture.js';
import {WorkerImageProcessor} from './processing/client.js';
import {ColorLibrary} from './color/library.js';
import {CalibrationWorker} from './color/client.js';
import {encodeInputICC,predictXYZ,xyzToLab} from './color/calibration.js';
const run=document.getElementById('run'),report=document.getElementById('report'),download=document.getElementById('download');let evidence;
const bytes=(blob)=>blob.arrayBuffer().then(b=>new Uint8Array(b));
function same(a,b){return a.length===b.length&&a.every((v,i)=>v===b[i]);}
run.onclick=async()=>{run.disabled=true;const processor=new WorkerImageProcessor(),calibration=new CalibrationWorker(),checks=[];
 try{
  const blob=new Blob([Uint8Array.from(fixtureJPEG)],{type:'image/jpeg'}),width=1000,height=200,model={matrix:[[.4360747,.3850649,.1430804],[.2225045,.7168786,.0606169],[.0139322,.0971045,.7141733]],gamma:[1.65,1.9,2.2]};
  const refs=[];for(const r of [20,64,115,173,235])for(const g of [20,64,115,173,235])for(const b of [20,64,115,173,235]){const xyz=predictXYZ(model,[r/255,g/255,b/255]);refs.push({id:'P'+refs.length,xyz,lab:xyzToLab(xyz)});}
  const fitted=await calibration.fit(blob,{x:0,y:0,width,height,rows:5,columns:25,start:0,inset:.25},refs,'Synthetic validation profile');checks.push({name:'JPEG target sampling + withheld validation',passed:fitted.report.accepted,report:fitted.report});
  const library=new ColorLibrary('scan-studio-color-validation'),profile=await library.save(fitted.iccBytes,{name:'Synthetic validation profile',source:'measured',captureSignature:'synthetic-fixture',report:fitted.report});const reopened=await new ColorLibrary('scan-studio-color-validation').get(profile.id);checks.push({name:'ICC validation worker + durable exact-byte storage',passed:same(reopened.bytes,fitted.iccBytes)});
  const recipe={version:1,rotation:0,crop:null,color:{profileId:profile.id,profileName:profile.name,intent:'relative-colorimetric',output:'srgb',source:'measured'}};
  const source={blob,width,height},corrected=await processor.process(source,{recipe,colorProfile:profile.bytes}),png=await bytes(corrected.blob);const restored=await processor.process(source,{recipe:{version:1,rotation:0,crop:null}});
  checks.push({name:'Real WASM correction + output ICC PNG + original restoration',passed:corrected.blob.type==='image/png'&&new TextDecoder().decode(png).includes('iCCP')&&same(await bytes(restored.blob),await bytes(blob)),width:corrected.width,height:corrected.height,bytes:png.length});
  for(const rotation of [90,180,270]){const edited=await processor.process(source,{recipe:{...recipe,rotation,crop:{x:100,y:20,width:300,height:120}},colorProfile:profile.bytes});checks.push({name:'Color + crop + '+rotation+' degree rotation',passed:edited.width===(rotation===180?300:120)&&edited.height===(rotation===180?120:300)});}
  const bad=Uint8Array.from(profile.bytes);bad[36]=0;let rejected=false;try{await library.save(bad,{name:'bad',source:'imported'});}catch{rejected=true;}checks.push({name:'Malformed source ICC rejected',passed:rejected});
  evidence={passed:checks.every(c=>c.passed),kind:'synthetic numerical fixtures; not physical scanner calibration',checks};report.textContent=JSON.stringify(evidence,null,2);download.disabled=false;
 }catch(error){report.textContent='FAIL: '+error.message;}finally{processor.dispose();calibration.dispose();run.disabled=false;}
};
download.onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(evidence,null,2)],{type:'application/json'}));a.download='browser-color-validation.json';a.click();};
