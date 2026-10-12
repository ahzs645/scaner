import {WorkerImageProcessor} from './processing/client.js';
const button=document.getElementById('run'),report=document.getElementById('report');
button.onclick=async()=>{
 button.disabled=true;const processor=new WorkerImageProcessor(),results=[];
 try {
  const width=16,height=10,canvas=new OffscreenCanvas(width,height),context=canvas.getContext('2d'),rgba=context.createImageData(width,height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;rgba.data.set([x*11,y*17,(x+y)*6,255],i);}
  context.putImageData(rgba,0,0);const blob=await canvas.convertToBlob({type:'image/png'}),crop={x:3,y:2,width:9,height:6};
  for(const rotation of [0,90,180,270]){
   const result=await processor.process({blob,width,height},{recipe:{version:1,rotation,crop}}),bitmap=await createImageBitmap(result.blob);
   const out=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=out.getContext('2d');ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,out.width,out.height).data;let mismatches=0;
   for(let y=0;y<out.height;y++)for(let x=0;x<out.width;x++){
    const [sx,sy]=rotation===0?[x,y]:rotation===90?[y,crop.height-1-x]:rotation===180?[crop.width-1-x,crop.height-1-y]:[crop.width-1-y,x];
    const expected=rgba.data.slice(((sy+crop.y)*width+sx+crop.x)*4,((sy+crop.y)*width+sx+crop.x)*4+4),actual=pixels.slice((y*out.width+x)*4,(y*out.width+x)*4+4);
    if(actual.some((value,index)=>value!==expected[index]))mismatches++;
   }
   results.push({rotation,width:out.width,height:out.height,pixelMismatches:mismatches,passed:mismatches===0});bitmap.close();
  }
  report.textContent=JSON.stringify({passed:results.every(result=>result.passed),results},null,2);
 }catch(error){report.textContent='FAIL: '+error.message;}finally{processor.dispose();button.disabled=false;}
};

// Separate real-engine checks: no hardware, uploaded documents, remote fonts,
// injected OCR decisions, or changes to the existing pixel-check harness.
import {OrientationDetector} from './processing/orientation.js';
const orientationButton=document.getElementById('run-orientation');
const orientationReport=document.getElementById('orientation-report');
const orientationDownload=document.getElementById('download-orientation');
let orientationEvidence;
const syntheticParagraphs=[
 'The morning light fell across the library tables while neighbors selected books for the weekend.',
 'A small garden needs regular water, patient attention, and room for the roots to grow in spring.',
 'We followed the walking path beside the river and stopped to watch the birds above the bridge.',
 'Before starting a new project, write a clear description of the goal and gather the needed tools.',
 'The kitchen window was open, and the pleasant smell of fresh bread drifted toward the orchard.',
 'A good map helps travelers understand unfamiliar streets without losing sight of nearby landmarks.',
 'Several friends planned a picnic with apples, sandwiches, cold drinks, and a comfortable blanket.',
 'When the afternoon rain arrived, the group moved indoors and continued their conversation quietly.',
 'Music can turn an ordinary evening into a memorable occasion, especially when everyone joins in.',
 'The teacher explained that careful observation often matters more than a quick answer to a question.',
 'On Saturday we repaired the old wooden gate, swept the front steps, and planted three young trees.',
 'A bicycle ride through the park offers exercise, fresh air, and a chance to notice seasonal changes.',
 'Our fictional town has a bakery, a bookshop, a public garden, and a busy market near the station.',
 'People at the market compared different vegetables and shared suggestions for simple homemade meals.',
 'The museum display showed how artists use color, shape, and texture to create a distinctive impression.',
 'At the end of the trail, a wide meadow opened toward distant hills beneath a clear blue summer sky.',
 'An organized workshop keeps small parts in labeled drawers and leaves enough space around the bench.',
 'The sailing lesson began with an explanation of wind direction, boat balance, and the basic safety rules.',
 'A neighborhood concert brought together singers, violin players, and families enjoying the warm weather.',
 'Writing notes after a meeting helps preserve decisions and makes the next step easier to understand.',
 'The cheerful dog waited beside the door while its owner found a jacket and a pair of walking shoes.',
 'Early in autumn, leaves turn yellow and red before falling gently onto the quiet paths beneath the trees.',
 'The train journey passed through farmland, wooded slopes, and several villages with colorful houses.',
 'Learning a practical skill takes repetition, thoughtful feedback, and time to correct small mistakes.',
 'We prepared a reading list with stories about exploration, friendship, science, and everyday adventures.',
 'The community center offers painting classes, chess evenings, and a friendly place to meet new people.',
 'At sunrise, workers opened the market stalls and arranged fresh flowers in tall buckets of clean water.',
 'A well designed experiment changes one condition at a time and records what happens to the result.',
 'The children built a model bridge from paper and discussed which shapes made the structure stronger.',
 'For a quiet afternoon, choose a shaded seat, bring a favorite book, and leave room for an unhurried walk.',
 'The weather forecast suggested sunshine in the morning followed by light clouds later in the day.',
 'We measured the shelf carefully before cutting the boards and checked that every corner stayed square.',
 'A helpful instruction explains both the action to take and the reason that the action is necessary.',
 'The drawing class practiced light pencil strokes before adding details to the outlines of familiar objects.',
 'Fresh herbs grow well in modest pots if the soil drains properly and the plants receive enough daylight.',
 'During the winter festival, the square was filled with lanterns, warm drinks, and lively conversations.',
 'An evening walk can reveal details that busy visitors overlook, such as carved doors and small courtyards.',
 'The orchestra rehearsed a difficult passage slowly before trying the complete piece at its usual tempo.',
 'A strong team shares information clearly, asks useful questions, and gives each person time to contribute.',
 'These paragraphs are invented for a local image test and contain no personal records or private documents.',
];
function nativeTextFixture(){
 const canvas=new OffscreenCanvas(1400,1900),context=canvas.getContext('2d');
 if(!context)throw Error('Native fixture canvas unavailable');
 context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);
 context.fillStyle='black';context.font='28px Georgia, "Times New Roman", serif';context.textBaseline='alphabetic';
 let y=90,lines=0;
 for(const paragraph of syntheticParagraphs){
  let line='';
  for(const word of paragraph.split(' ')){
   const proposed=line?line+' '+word:word;
   if(line&&context.measureText(proposed).width>1220){
    if(y>1810)return {canvas,lines};
    context.fillText(line,90,y);y+=36;lines++;line=word;
   }else line=proposed;
  }
  if(line){if(y>1810)break;context.fillText(line,90,y);y+=36;lines++;}
 }
 return {canvas,lines};
}
async function physicallyRotateFixture(source,clockwise){
 const swaps=clockwise===90||clockwise===270;
 const canvas=new OffscreenCanvas(swaps?source.height:source.width,swaps?source.width:source.height),context=canvas.getContext('2d');
 if(!context)throw Error('Rotation fixture canvas unavailable');
 context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);
 if(clockwise===90){context.translate(canvas.width,0);context.rotate(Math.PI/2);}
 else if(clockwise===180){context.translate(canvas.width,canvas.height);context.rotate(Math.PI);}
 else if(clockwise===270){context.translate(0,canvas.height);context.rotate(-Math.PI/2);}
 context.drawImage(source,0,0);
 const blob=await canvas.convertToBlob({type:'image/png'});
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()));
 return {source:{blob,width:canvas.width,height:canvas.height},sha256:[...hash].map(value=>value.toString(16).padStart(2,'0')).join(''),bytes:blob.size};
}
orientationButton.onclick=async()=>{
 orientationButton.disabled=true;orientationDownload.disabled=true;orientationEvidence=undefined;
 const started=new Date().toISOString(),detector=new OrientationDetector({confidenceThreshold:15}),results=[];
 const show=extra=>{orientationReport.textContent=JSON.stringify({started,confidenceThreshold:15,results,...extra},null,2);};
 try{
  if(document.fonts?.ready)await document.fonts.ready;
  const fixture=nativeTextFixture();
  for(const [physicalClockwise,expectedClockwiseCorrection] of [[0,0],[90,270],[180,180],[270,90]]){
   show({status:'running',physicalClockwise});
   const rotated=await physicallyRotateFixture(fixture.canvas,physicalClockwise),begin=performance.now();
   try{
    const decision=await detector.detect(rotated.source);
    results.push({kind:'synthetic-English-text',physicalClockwise,expectedClockwiseCorrection,width:rotated.source.width,height:rotated.source.height,
     lines:fixture.lines,sha256:rotated.sha256,bytes:rotated.bytes,elapsedMs:Math.round(performance.now()-begin),decision,
     passed:decision.accepted===true&&decision.rotation===expectedClockwiseCorrection&&decision.confidence>=15});
   }catch(error){results.push({kind:'synthetic-English-text',physicalClockwise,expectedClockwiseCorrection,passed:false,error:String(error?.message??error)});}
  }
  const blank=new OffscreenCanvas(1400,1900),context=blank.getContext('2d');
  if(!context)throw Error('Blank fixture canvas unavailable');
  context.fillStyle='white';context.fillRect(0,0,blank.width,blank.height);
  const blankInput=await physicallyRotateFixture(blank,0);show({status:'running',current:'blank rejection'});
  try{
   const decision=await detector.detect(blankInput.source);
   results.push({kind:'blank-white-page',sha256:blankInput.sha256,decision,passed:decision.accepted===false&&decision.rotation===null});
  }catch(error){
   const message=String(error?.message??error);
   // An unrelated engine failure is not evidence of a correct blank rejection.
   results.push({kind:'blank-white-page',error:message,passed:/too few|not enough|insufficient|too little|blank|empty/i.test(message)});
  }
  orientationEvidence={started,finished:new Date().toISOString(),passed:results.length===5&&results.every(result=>result.passed),
   confidenceThreshold:15,fixture:{width:1400,height:1900,font:'28px Georgia, Times New Roman, serif',lines:fixture.lines,content:'own synthetic nonsensitive English'},
   environment:{userAgent:navigator.userAgent,secureContext:isSecureContext},results};
 }catch(error){orientationEvidence={started,finished:new Date().toISOString(),passed:false,error:String(error?.message??error),results};}
 finally{
  detector.dispose();orientationButton.disabled=false;
  orientationReport.textContent=JSON.stringify(orientationEvidence,null,2);orientationDownload.disabled=!orientationEvidence;
 }
};
orientationDownload.onclick=()=>{
 if(!orientationEvidence)return;
 const blob=new Blob([JSON.stringify(orientationEvidence,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download='orientation-browser-evidence.json';document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
};
