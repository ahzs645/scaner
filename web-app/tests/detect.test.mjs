import test from 'node:test';
import assert from 'node:assert/strict';
import {detectDocument} from '../dist/processing/detect.js';
function raster(width=400,height=300,background=160){
 const data=new Uint8ClampedArray(width*height*4);
 for(let i=0;i<data.length;i+=4){data[i]=background;data[i+1]=background;data[i+2]=background;data[i+3]=255;}
 return {width,height,data};
}
function box(image,x,y,width,height,value){
 for(let row=Math.max(0,y);row<Math.min(image.height,y+height);row++)for(let col=Math.max(0,x);col<Math.min(image.width,x+width);col++){
  const p=(row*image.width+col)*4;image.data[p]=image.data[p+1]=image.data[p+2]=value;
 }
 return image;
}
function marks(image,x,y){for(let line=0;line<8;line++)for(let word=0;word<6;word++)box(image,x+word*28,y+line*16,19,3,30);}
const abstains=result=>{assert.equal(result.bounds,null);assert.equal(result.confidence,0);assert.ok(result.reason.length>10);assert.equal(result.method,'perimeter-bright-region-v1');};

test('paper on gray bed preserves all text, real boundary and a safety margin without changing input',()=>{
 const image=box(raster(),60,40,280,220,245);marks(image,90,65);const before=image.data.slice();
 const result=detectDocument(image);assert.ok(result.bounds);assert.ok(result.confidence>0.85);
 assert.ok(result.bounds.x<60);assert.ok(result.bounds.y<40);
 assert.ok(result.bounds.x+result.bounds.width>340);assert.ok(result.bounds.y+result.bounds.height>260);
 assert.ok(result.bounds.width<300);assert.deepEqual(image.data,before);
});

test('uniform full-width white padding is ignored while enclosed paper is detected',()=>{
 const image=box(raster(),60,30,280,180,245);marks(image,90,55);box(image,0,240,400,60,255);
 const result=detectDocument(image);assert.ok(result.bounds);assert.ok(result.bounds.y+result.bounds.height<240);
 assert.ok(result.bounds.x<=60&&result.bounds.x+result.bounds.width>=340);
});

test('ADF paper may align exactly to one capture edge with three strong boundaries',()=>{
 const image=box(raster(),60,0,280,220,245);marks(image,90,35);box(image,0,250,400,50,255);
 const result=detectDocument(image);assert.ok(result.bounds);assert.equal(result.bounds.y,0);
 assert.match(result.reason,/Three closed paper edges plus capture-edge alignment/);
 assert.ok(result.confidence>=0.8);assert.ok(result.bounds.y+result.bounds.height<250);
});

test('padding containing notes is not silently removed as blank scanner padding',()=>{
 const image=box(raster(),60,20,280,180,245);box(image,0,240,400,60,255);
 for(let y=250;y<290;y+=8)box(image,30,y,180,4,20);
 abstains(detectDocument(image));
});

test('blank uniform scans and white-on-white paper abstain instead of trimming whitespace',()=>{
 for(const value of [0,160,255])abstains(detectDocument(raster(400,300,value)));
 abstains(detectDocument(box(raster(400,300,246),60,40,280,220,255)));
});

test('dark paper on a white bed is unsupported rather than confused with dark ink',()=>{
 const image=box(raster(400,300,250),60,40,280,220,35);box(image,100,100,30,12,245);
 abstains(detectDocument(image));
});

test('fragmented text and repeated outlined boxes are not paper boundaries',()=>{
 const ink=raster(400,300,255);marks(ink,70,40);abstains(detectDocument(ink));
 const outlines=raster();
 for(const x of [50,220]){box(outlines,x,30,120,2,250);box(outlines,x,220,120,2,250);box(outlines,x,30,2,190,250);box(outlines,x+118,30,2,190,250);}
 abstains(detectDocument(outlines));
});

test('small isolated noise and strip-like bright marks cannot drive a crop',()=>{
 const image=raster();for(let i=0;i<50;i++)box(image,5+(i*17)%380,5+(i*31)%280,2,2,250);
 abstains(detectDocument(image));abstains(detectDocument(box(raster(),40,120,320,10,250)));
});

test('two separate cards or repeated filled rectangles are ambiguous',()=>{
 const image=raster();box(image,25,50,150,180,245);box(image,225,50,150,180,245);
 const result=detectDocument(image);abstains(result);assert.match(result.reason,/Multiple/);
});

test('paper spanning multiple edges or a ragged partial boundary abstains',()=>{
 abstains(detectDocument(box(raster(),0,0,280,220,245)));
 const image=raster();
 for(let y=0;y<220;y++)box(image,60+(y%12),y,250-(y%12),1,245);
 abstains(detectDocument(image));
});

test('low contrast and insufficient bed evidence leave the original unchanged',()=>{
 abstains(detectDocument(box(raster(400,300,230),60,40,280,220,245)));
 const image=box(raster(400,300,255),40,30,320,240,180);abstains(detectDocument(image));
});

test('dimensions, buffer shape and analysis budget are validated before allocation',()=>{
 for(const image of [null,{width:NaN,height:10,data:new Uint8ClampedArray()},{width:0,height:1,data:new Uint8ClampedArray()},{width:2.5,height:1,data:new Uint8ClampedArray()}])
  assert.throws(()=>detectDocument(image),TypeError);
 assert.throws(()=>detectDocument({width:1001,height:1000,data:new Uint8ClampedArray()}),RangeError);
 assert.throws(()=>detectDocument({width:400,height:300,data:new Uint8Array(400*300*4)}),TypeError);
 assert.throws(()=>detectDocument({width:400,height:300,data:new Uint8ClampedArray(4)}),TypeError);
 abstains(detectDocument(raster(20,20)));
});

test('transparent background makes paper detection uncertain',()=>{
 const image=box(raster(),60,40,280,220,245);image.data[3]=0;abstains(detectDocument(image));
});

test('small ADF shear does not cut off extremal corners or text',()=>{
 const image=raster();
 for(let y=40;y<260;y++)box(image,60+Math.floor((y-40)/60),y,280,1,245);
 marks(image,95,65);
 const result=detectDocument(image);assert.ok(result.bounds);
 assert.ok(result.bounds.x<60);assert.ok(result.bounds.x+result.bounds.width>343);
 assert.ok(result.bounds.y<40&&result.bounds.y+result.bounds.height>260);
});

test('single-edge aligned documents preserve each touching extent exactly',()=>{
 for(const [x,y,w,h,touch] of [[0,40,300,220,'left'],[100,40,300,220,'right'],[60,60,280,240,'bottom']]){
  const image=box(raster(),x,y,w,h,245),result=detectDocument(image);assert.ok(result.bounds,touch);
  if(touch==='left')assert.equal(result.bounds.x,0);
  if(touch==='right')assert.equal(result.bounds.x+result.bounds.width,400);
  if(touch==='bottom')assert.equal(result.bounds.y+result.bounds.height,300);
  assert.match(result.reason,/capture-edge alignment/);
 }
});

test('the largest supported analysis raster is bounded and returns raster-coordinate bounds',()=>{
 const image=box(raster(1000,1000),150,100,700,800,245),result=detectDocument(image);assert.ok(result.bounds);
 assert.deepEqual(result.bounds,{x:143,y:93,width:714,height:814});
});

test('even a small ink note prevents classifying a padding band as blank',()=>{
 const image=box(raster(),60,20,280,180,245);box(image,0,240,400,60,255);box(image,30,260,4,4,25);
 abstains(detectDocument(image));
});
