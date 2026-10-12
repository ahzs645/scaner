import {decodeCapture} from '../color/decode.js';
import {transformRGBA,exportSRGBProfile} from '../color/engine.js';
import {embedSRGBProfile} from '../color/png.js';
import {profileId} from '../color/library.js';
import {detectDocument} from './detect.js';
import {isEdited,mapBounds,transformGeometry,validateRecipe} from './types.js';
import type {ImageSource,ProcessingRequest,ProcessingResult} from './types.js';
/** Render each revision from its immutable capture: never rotate/crop an already
 * re-encoded edit. Lossless PNG is used for derived files. */
export async function processImage(source:ImageSource,request:ProcessingRequest):Promise<ProcessingResult> {
  validateRecipe(request.recipe,source.width,source.height);
  let recipe=structuredClone(request.recipe);
  const notices:string[]=[];
  if(!request.autoCrop&&!isEdited(recipe))return {recipe,blob:source.blob,width:source.width,height:source.height,notices};
  let bitmap:ImageBitmap;
  if(recipe.color){
    if(!request.colorProfile||await profileId(request.colorProfile)!==recipe.color.profileId)throw Error('The matching source ICC profile is required for this edit');
    const decoded=await decodeCapture(source.blob);
    if(decoded.width!==source.width||decoded.height!==source.height)throw Error('Capture dimensions changed');
    const corrected=await transformRGBA(decoded.data,decoded.width,decoded.height,request.colorProfile);
    const colorCanvas=new OffscreenCanvas(decoded.width,decoded.height),colorContext=colorCanvas.getContext('2d');
    if(!colorContext)throw Error('Color canvas unavailable');
    try{colorContext.putImageData(new ImageData(Uint8ClampedArray.from(corrected),decoded.width,decoded.height),0,0);bitmap=await createImageBitmap(colorCanvas);}finally{colorCanvas.width=1;colorCanvas.height=1;}
    notices.push('Converted scanner RGB to sRGB using '+recipe.color.profileName+' · original JPEG preserved');
  }else bitmap=await createImageBitmap(source.blob);
  try {
    if(bitmap.width!==source.width||bitmap.height!==source.height)throw Error('Capture dimensions no longer match the original image');
    let detection;
    if(request.autoCrop){
      const scale=Math.min(1,1000/Math.max(bitmap.width,bitmap.height)),width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
      const analysis=new OffscreenCanvas(width,height),context=analysis.getContext('2d',{willReadFrequently:true});
      if(!context)throw Error('Image analysis canvas is unavailable');
      try {
        context.drawImage(bitmap,0,0,width,height);const result=detectDocument(context.getImageData(0,0,width,height));
        detection={...result,bounds:result.bounds?mapBounds(result.bounds,bitmap.width,bitmap.height,width,height):null};
        if(detection.bounds)recipe={...recipe,crop:detection.bounds};
        else notices.push('Auto-crop skipped: '+result.reason);
      }finally{analysis.width=1;analysis.height=1;}
    }
    if(!isEdited(recipe))return {recipe,blob:source.blob,width:source.width,height:source.height,notices,...(detection?{detection}:{})};
    const geometry=transformGeometry(recipe,bitmap.width,bitmap.height),output=new OffscreenCanvas(geometry.width,geometry.height),context=output.getContext('2d');
    if(!context)throw Error('Image processing canvas is unavailable');
    try {
      context.translate(...geometry.translate);context.rotate(geometry.radians);
      const {crop}=geometry;context.drawImage(bitmap,crop.x,crop.y,crop.width,crop.height,0,0,crop.width,crop.height);
      let blob=await output.convertToBlob({type:'image/png'});
      if(recipe.color)blob=await embedSRGBProfile(blob,await exportSRGBProfile());
      if(blob.type!=='image/png'||!blob.size||blob.size>64*1024*1024)throw Error('Processed PNG exceeds the 64 MiB page limit');
      return {recipe,blob,width:geometry.width,height:geometry.height,notices,...(detection?{detection}:{})};
    }finally{output.width=1;output.height=1;}
  }finally{bitmap.close();}
}
