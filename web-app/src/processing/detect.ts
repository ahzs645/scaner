/** Conservative flat ADF paper detection. This is not a camera quadrilateral
 * detector and confidence is a heuristic score, not a calibrated probability.
 * Bright paper needs a closed rectangular boundary against darker bed; one
 * capture-aligned edge is allowed when all other edges are complete.
 * Dark paper is intentionally unsupported: dark ink is not a paper boundary.
 * No source image is mutated, and abstention always leaves it unchanged. */
export interface Raster {width:number; height:number; data:Uint8ClampedArray}
export interface Bounds {x:number; y:number; width:number; height:number}
export interface Detection {bounds:Bounds|null; confidence:number; reason:string; method:string}
const METHOD='perimeter-bright-region-v1';
const MAX_SIDE=1000, MAX_PIXELS=1_000_000;
const refusal=(reason:string):Detection=>({bounds:null,confidence:0,reason,method:METHOD});
const percentile=(values:number[],fraction:number):number=>{
  values.sort((a,b)=>a-b);return values[Math.floor((values.length-1)*fraction)]!;
};
interface Region {left:number; top:number; right:number; bottom:number; count:number; sum:number}

export function detectDocument(raster:Raster):Detection {
  if(!raster||!Number.isSafeInteger(raster.width)||!Number.isSafeInteger(raster.height)||raster.width<=0||raster.height<=0)
    throw new TypeError('Raster dimensions must be positive integers');
  const {width,height,data}=raster,pixels=width*height;
  if(width>MAX_SIDE||height>MAX_SIDE||pixels>MAX_PIXELS)throw new RangeError('Document analysis is limited to 1000 pixels per side and one million pixels');
  if(!(data instanceof Uint8ClampedArray)||data.length!==pixels*4)throw new TypeError('Raster must contain exactly width × height RGBA bytes');
  if(width<32||height<32)return refusal('Image is too small to establish a reliable paper boundary');
  const luminance=new Uint8Array(pixels);
  let minimum=255,maximum=0;
  for(let i=0;i<pixels;i++){
    const p=i*4;
    if(data[p+3]!==255)return refusal('Transparent pixels make the scanner background uncertain');
    const value=(77*data[p]!+150*data[p+1]!+29*data[p+2]!)>>8;
    luminance[i]=value;minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);
  }
  if(maximum-minimum<20)return refusal('Blank or low contrast image has no reliable document boundary');
  const perimeter:number[]=[];
  for(let x=0;x<width;x++){perimeter.push(luminance[x]!,luminance[(height-1)*width+x]!);}
  for(let y=1;y<height-1;y++){perimeter.push(luminance[y*width]!,luminance[y*width+width-1]!);}
  // White post-scan padding may occupy a substantial part of the frame. Find
  // a supported darker cluster instead of averaging it with scanner-bed gray.
  const histogram=new Uint32Array(256);
  for(const value of perimeter)if(value<238)histogram[value]=(histogram[value]??0)+1;
  let best=0,centre=0;
  for(let candidate=0;candidate<238;candidate++){
    let count=0;
    for(let value=Math.max(0,candidate-14);value<=Math.min(237,candidate+14);value++)count+=histogram[value]!;
    if(count>best){best=count;centre=candidate;}
  }
  if(best<perimeter.length*0.20)return refusal('No sufficiently supported darker scanner-bed background; dark paper and white-on-white scans are unsupported');
  const cluster=perimeter.filter(value=>value<238&&Math.abs(value-centre)<=14);
  const background=percentile([...cluster],0.5),upper=percentile([...cluster],0.95);
  const threshold=Math.max(background+18,upper+10);
  if(threshold>242)return refusal('Paper and scanner bed have too little contrast for a safe crop');
  const mask=new Uint8Array(pixels);
  for(let i=0;i<pixels;i++)if(luminance[i]!>=threshold)mask[i]=1;
  // A 3×3 closing bridges thin printed rules without erasing larger text.
  // Clamping at the image edge preserves touching-region evidence.
  const dilated=new Uint8Array(pixels),closed=new Uint8Array(pixels);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let value=0;
    for(let dy=-1;dy<=1&&!value;dy++)for(let dx=-1;dx<=1;dx++){
      const index=Math.max(0,Math.min(height-1,y+dy))*width+Math.max(0,Math.min(width-1,x+dx));
      if(mask[index]){value=1;break;}
    }
    dilated[y*width+x]=value;
  }
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let value=1;
    for(let dy=-1;dy<=1&&value;dy++)for(let dx=-1;dx<=1;dx++){
      const index=Math.max(0,Math.min(height-1,y+dy))*width+Math.max(0,Math.min(width-1,x+dx));
      if(!dilated[index]){value=0;break;}
    }
    closed[y*width+x]=value;
  }
  const seen=new Uint8Array(pixels),queue=new Int32Array(pixels),regions:Region[]=[];
  const minRegion=Math.max(64,Math.ceil(pixels*0.01));
  for(let start=0;start<pixels;start++){
    if(!closed[start]||seen[start])continue;
    let begin=0,end=1;queue[0]=start;seen[start]=1;
    const region:Region={left:width,top:height,right:0,bottom:0,count:0,sum:0};
    while(begin<end){
      const index=queue[begin++]!,x=index%width,y=Math.floor(index/width);
      region.left=Math.min(region.left,x);region.right=Math.max(region.right,x);
      region.top=Math.min(region.top,y);region.bottom=Math.max(region.bottom,y);
      region.count++;region.sum+=luminance[index]!;
      // Each pixel enters the preallocated queue at most once.
      if(x>0&&!seen[index-1]&&closed[index-1]){seen[index-1]=1;queue[end++]=index-1;}
      if(x+1<width&&!seen[index+1]&&closed[index+1]){seen[index+1]=1;queue[end++]=index+1;}
      if(y>0&&!seen[index-width]&&closed[index-width]){seen[index-width]=1;queue[end++]=index-width;}
      if(y+1<height&&!seen[index+width]&&closed[index+width]){seen[index+width]=1;queue[end++]=index+width;}
    }
    if(region.count>=minRegion)regions.push(region);
  }
  const candidates:Region[]=[];
  for(const region of regions){
    const w=region.right-region.left+1,h=region.bottom-region.top+1,fill=region.count/(w*h);
    const touches=[region.left===0,region.right===width-1,region.top===0,region.bottom===height-1];
    const topBand=touches[0]&&touches[1]&&touches[2]&&!touches[3]&&h<height*0.35;
    const bottomBand=touches[0]&&touches[1]&&touches[3]&&!touches[2]&&h<height*0.35;
    const sideBand=touches[2]&&touches[3]&&(touches[0]!==touches[1])&&w<width*0.35;
    // A high fill ratio alone can hide small notes. Verify padding's interior
    // has no dark marks, while allowing a narrow antialiasing boundary band.
    let blankPadding=false;
    if((topBand||bottomBand||sideBand)&&fill>=0.995&&region.sum/region.count>=248){
      let dark=0;
      for(let y=region.top+2;y<=region.bottom-2&&dark<4;y++)
        for(let x=region.left+2;x<=region.right-2&&dark<4;x++)
          if(luminance[y*width+x]!<236)dark++;
      blankPadding=dark<4;
    }
    if(blankPadding)continue;
    candidates.push(region);
  }
  if(!candidates.length)return refusal('No substantial enclosed bright paper region; text and tiny marks are not document boundaries');
  if(candidates.length!==1)return refusal('Multiple substantial regions make document selection ambiguous');
  const region=candidates[0]!,w=region.right-region.left+1,h=region.bottom-region.top+1;
  const touching=[region.top<2,region.bottom>height-3,region.left<2,region.right>width-3];
  const touchingCount=touching.filter(Boolean).length;
  if(touchingCount>1)return refusal('Document touches multiple analysis edges; a reliable boundary cannot be established');
  if(touchingCount===1&&!((touching[0]&&region.top===0)||(touching[1]&&region.bottom===height-1)||(touching[2]&&region.left===0)||(touching[3]&&region.right===width-1)))
    return refusal('Paper is too close to the capture edge to preserve a safe margin');
  const fill=region.count/(w*h),contrast=region.sum/region.count-background;
  if(w*h<pixels*0.10||w<width*0.10||h<height*0.10||w/h<0.2||w/h>5)
    return refusal('Region is too small or strip-like to distinguish safely from image content');
  if(fill<0.78||contrast<24)return refusal('Fragmented or low contrast region does not establish rectangular paper');
  // Mild ADF skew/blur produces extremal corners rather than one perfectly
  // aligned edge row. Require support inside a narrow inward edge band, not
  // one exact row/column. Large ragged edges still fail this closure test.
  const band=Math.max(2,Math.ceil(Math.min(w,h)*0.015));
  const support=(horizontal:boolean,position:number,inward:number):number=>{
    let count=0;const length=horizontal?w:h;
    for(let i=0;i<length;i++){
      let found=false;
      for(let depth=0;depth<band;depth++){
        const index=horizontal?(position+inward*depth)*width+region.left+i:(region.top+i)*width+position+inward*depth;
        if(closed[index]){found=true;break;}
      }
      if(found)count++;
    }
    return count/length;
  };
  const edges=[support(true,region.top,1),support(true,region.bottom,-1),support(false,region.left,1),support(false,region.right,-1)];
  const edge=Math.min(...edges.filter((_,index)=>!touching[index]));
  if(edge<0.85||(touchingCount===1&&edges.find((_,index)=>touching[index])!<0.70))return refusal('Paper edges are incomplete or irregular; automatic crop would be uncertain');
  const margin=Math.max(3,Math.ceil(Math.min(w,h)*0.01));
  const left=Math.max(0,region.left-margin),top=Math.max(0,region.top-margin);
  const right=Math.min(width,region.right+1+margin),bottom=Math.min(height,region.bottom+1+margin);
  return {bounds:{x:left,y:top,width:right-left,height:bottom-top},confidence:Math.min(0.99,(touchingCount?0.65:0.70)+fill*0.12+edge*0.08+Math.min(contrast/100,1)*0.09),
    reason:touchingCount?'Three closed paper edges plus capture-edge alignment; touching coordinate preserved':'One closed rectangular bright paper boundary with a preserved margin',method:METHOD};
}
