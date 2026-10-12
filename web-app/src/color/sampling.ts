export interface GridSpec{x:number;y:number;width:number;height:number;rows:number;columns:number;start:number;inset:number}
export interface PatchSample{id:string;rgb:[number,number,number];spread:number;clippedFraction:number}
export function sampleGrid(data:Uint8ClampedArray,width:number,height:number,grid:GridSpec,ids:readonly string[]):PatchSample[]{
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width*height>40_000_000||data.length!==width*height*4)throw Error('Invalid color chart pixels');
 const {x,y,rows,columns,start,inset}=grid;
 if(![x,y,grid.width,grid.height,rows,columns,start].every(Number.isSafeInteger)||x<0||y<0||grid.width<=0||grid.height<=0||x+grid.width>width||y+grid.height>height||rows<1||columns<1||rows*columns>2000||start<0||start+rows*columns>ids.length||!Number.isFinite(inset)||inset<0.1||inset>0.45)throw Error('Align a valid grid inside the original color target image');
 const patches:PatchSample[]=[];
 for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
  const left=Math.ceil(x+(col+inset)*grid.width/columns),right=Math.floor(x+(col+1-inset)*grid.width/columns),top=Math.ceil(y+(row+inset)*grid.height/rows),bottom=Math.floor(y+(row+1-inset)*grid.height/rows);
  if(right-left<2||bottom-top<2)throw Error('Target patch regions are too small');
  const hist=[new Uint32Array(256),new Uint32Array(256),new Uint32Array(256)];let n=0,clipped=0;
  const step=Math.max(1,Math.ceil(Math.sqrt((right-left)*(bottom-top)/4096)));
  for(let sy=top;sy<bottom;sy+=step)for(let sx=left;sx<right;sx+=step){const i=(sy*width+sx)*4;if(data[i+3]!==255)throw Error('Reference chart contains transparent pixels');n++;let clip=false;for(let c=0;c<3;c++){const v=data[i+c]!;hist[c]![v]=hist[c]![v]!+1;if(v<=1||v>=254)clip=true;}if(clip)clipped++;}
  const quantile=(h:Uint32Array,q:number)=>{let sum=0;for(let v=0;v<256;v++){sum+=h[v]!;if(sum>=n*q)return v;}return 255;};
  const rgb=hist.map(h=>quantile(h,0.5)/255) as [number,number,number];const spread=Math.max(...hist.map(h=>(quantile(h,0.9)-quantile(h,0.1))/255));
  patches.push({id:ids[start+row*columns+col]!,rgb,spread,clippedFraction:clipped/n});
 }
 return patches;
}
