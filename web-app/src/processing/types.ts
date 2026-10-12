import {validateColorEdit} from '../color/types.js';
import type {ColorEdit} from '../color/types.js';
import type {OrientationDecision} from './orientation.js';
import type {Bounds,Detection} from './detect.js';
export type {Bounds,Detection};
export type QuarterTurn=0|90|180|270;
export interface ProcessingRecipe {version:1; rotation:QuarterTurn; crop:Bounds|null; color?:ColorEdit}
export const originalRecipe=():ProcessingRecipe=>({version:1,rotation:0,crop:null});
/** OSD returns a clockwise correction relative to the CURRENT render. */
export function applyOrientation(recipe:ProcessingRecipe,decision:OrientationDecision):ProcessingRecipe {
  const next=structuredClone(recipe);
  if(decision.accepted&&decision.rotation!==null){
    if(![0,90,180,270].includes(decision.rotation))throw Error('Invalid orientation correction');
    next.rotation=((next.rotation+decision.rotation)%360) as QuarterTurn;
  }
  return next;
}
export interface ImageSource {blob:Blob; width:number; height:number}
export interface ProcessingRequest {recipe:ProcessingRecipe; autoCrop?:boolean; colorProfile?:Uint8Array}
export interface ProcessingResult {
  recipe:ProcessingRecipe; blob:Blob; width:number; height:number;
  detection?:Detection; orientation?:OrientationDecision & {inputRotation:QuarterTurn}; notices:string[];
}
export interface SavedEdit extends ProcessingResult {
  jobId:string; filename:string; updated:string; history:ProcessingRecipe[]; redo?:ProcessingRecipe[];
}
export interface ImageProcessor {
  process(source:ImageSource,request:ProcessingRequest,signal?:AbortSignal):Promise<ProcessingResult>;
  dispose():void;
}
export const isEdited=(recipe:ProcessingRecipe):boolean=>recipe.rotation!==0||recipe.crop!==null||!!recipe.color;
export function validateRecipe(recipe:ProcessingRecipe,width:number,height:number):void {
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||width*height>40_000_000)throw Error('Processing is limited to 40 million source pixels');
  if(!recipe||recipe.version!==1||![0,90,180,270].includes(recipe.rotation))throw Error('Rotation must be 0, 90, 180 or 270 degrees');
  validateColorEdit(recipe.color);
  if(recipe.crop!==null){
    const crop=recipe.crop;
    if(!crop||![crop.x,crop.y,crop.width,crop.height].every(Number.isSafeInteger)||crop.x<0||crop.y<0||crop.width<=0||crop.height<=0||crop.x+crop.width>width||crop.y+crop.height>height)throw Error('Crop must be a nonempty rectangle inside the original image');
  }
}
/** Round outwards when returning downsampled boundaries to original pixels. */
export function mapBounds(bounds:Bounds,width:number,height:number,analysisWidth:number,analysisHeight:number):Bounds {
  if(![width,height,analysisWidth,analysisHeight].every(value=>Number.isSafeInteger(value)&&value>0))throw Error('Invalid image geometry');
  validateRecipe({version:1,rotation:0,crop:bounds},analysisWidth,analysisHeight);
  const left=Math.floor(bounds.x*width/analysisWidth),top=Math.floor(bounds.y*height/analysisHeight);
  const right=Math.min(width,Math.ceil((bounds.x+bounds.width)*width/analysisWidth)),bottom=Math.min(height,Math.ceil((bounds.y+bounds.height)*height/analysisHeight));
  return {x:left,y:top,width:right-left,height:bottom-top};
}
export function transformGeometry(recipe:ProcessingRecipe,width:number,height:number):{crop:Bounds;width:number;height:number;translate:[number,number];radians:number} {
  validateRecipe(recipe,width,height);const crop=recipe.crop??{x:0,y:0,width,height};
  const quarter=recipe.rotation===90||recipe.rotation===270;
  return {crop:{...crop},width:quarter?crop.height:crop.width,height:quarter?crop.width:crop.height,
    translate:recipe.rotation===90?[crop.height,0]:recipe.rotation===180?[crop.width,crop.height]:recipe.rotation===270?[0,crop.width]:[0,0],radians:recipe.rotation*Math.PI/180};
}
