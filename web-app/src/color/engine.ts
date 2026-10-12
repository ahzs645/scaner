import {iccBytes,inspectICC} from './icc.js';
import type {ICCBytes} from './icc.js';
export const MAX_COLOR_PIXELS=40_000_000;
const BLOCK_PIXELS=32_768;
interface LCMS {
  cmsOpenProfileFromMem(bytes:Uint8Array,length:number):number;
  cmsCloseProfile(profile:number):void;
  cmsCreate_sRGBProfile():number;
  cmsCreateTransform(input:number,inputFormat:number,output:number,outputFormat:number,intent:number,flags:number):number;
  cmsDeleteTransform(transform:number):void;
  cmsDoTransform(transform:number,input:Uint8Array,count:number):Uint8Array;
}
interface Vendor {
  instantiate(options:{locateFile:(name:string)=>string;printErr:(message:unknown)=>void}):Promise<LCMS>;
  TYPE_RGB_8:number;INTENT_RELATIVE_COLORIMETRIC:number;
}
let runtime:Promise<{lcms:LCMS;vendor:Vendor}>|undefined;
function sourceProfile(input:ICCBytes):Uint8Array {
  inspectICC(input); // Enforce the bound before allocating a defensive copy.
  const result=Uint8Array.from(iccBytes(input));inspectICC(result);return result;
}
async function loadEngine():Promise<{lcms:LCMS;vendor:Vendor}> {
  return runtime??= (async()=>{
    const vendor=await import(new URL('../vendor/color/lcms.js',import.meta.url).href) as Vendor;
    const lcms=await vendor.instantiate({
      locateFile:name=>{if(name!=='lcms.wasm')throw Error('Unexpected color engine asset');return new URL('../vendor/color/lcms.wasm',import.meta.url).href;},
      printErr:()=>{},
    });
    return {lcms,vendor};
  })().catch(error=>{runtime=undefined;throw error;});
}
function pixels(width:number,height:number,bytes:number,channels:number):number {
  const count=width*height;
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1
    ||!Number.isSafeInteger(count)||count>MAX_COLOR_PIXELS||bytes!==count*channels)
    throw Error('Color raster must have exact channels and at most 40 million pixels');
  return count;
}
function openTransform(lcms:LCMS,vendor:Vendor,profile:Uint8Array):{input:number;output:number;transform:number} {
  let input=0,output=0,transform=0;
  try {
    input=lcms.cmsOpenProfileFromMem(profile,profile.length);
    if(!input)throw Error('LittleCMS rejected the source ICC profile');
    output=lcms.cmsCreate_sRGBProfile();
    if(!output)throw Error('LittleCMS could not create the sRGB destination');
    transform=lcms.cmsCreateTransform(input,vendor.TYPE_RGB_8,output,vendor.TYPE_RGB_8,vendor.INTENT_RELATIVE_COLORIMETRIC,0);
    if(!transform)throw Error('LittleCMS could not build the source-to-sRGB transform');
    return {input,output,transform};
  } catch(error) {
    if(transform)lcms.cmsDeleteTransform(transform);
    if(output)lcms.cmsCloseProfile(output);
    if(input)lcms.cmsCloseProfile(input);
    throw error;
  }
}
/** Check semantic transform readiness, including LUT profiles, without an image. */
export async function validateICC(input:ICCBytes):Promise<void> {
  const profile=sourceProfile(input);
  const {lcms,vendor}=await loadEngine(),handles=openTransform(lcms,vendor,profile);
  lcms.cmsDeleteTransform(handles.transform);lcms.cmsCloseProfile(handles.output);lcms.cmsCloseProfile(handles.input);
}

/** Input values are unassociated device RGB samples, never Canvas pixels already
 * normalized by browser ICC handling. No source profile is inferred or assigned. */
export async function transformRGBA(input:Uint8ClampedArray,width:number,height:number,source:ICCBytes):Promise<Uint8ClampedArray> {
  if(!(input instanceof Uint8ClampedArray))throw Error('RGBA input must be Uint8ClampedArray');
  const count=pixels(width,height,input.length,4),profile=sourceProfile(source);
  const {lcms,vendor}=await loadEngine(),handles=openTransform(lcms,vendor,profile);
  try {
    const result=new Uint8ClampedArray(input.length),scratch=new Uint8Array(Math.min(count,BLOCK_PIXELS)*3);
    for(let start=0;start<count;start+=BLOCK_PIXELS) {
      const n=Math.min(BLOCK_PIXELS,count-start);
      for(let i=0;i<n;i++){const p=(start+i)*4;for(let c=0;c<3;c++)scratch[i*3+c]=input[p+c]!;}
      const rgb=lcms.cmsDoTransform(handles.transform,scratch.subarray(0,n*3),n);
      if(rgb.length!==n*3)throw Error('LittleCMS returned an invalid RGB block');
      for(let i=0;i<n;i++){const p=(start+i)*4;for(let c=0;c<3;c++)result[p+c]=rgb[i*3+c]!;result[p+3]=input[p+3]!;}
    }
    return result;
  } finally {lcms.cmsDeleteTransform(handles.transform);lcms.cmsCloseProfile(handles.output);lcms.cmsCloseProfile(handles.input);}
}

export async function transformRGB(input:Uint8Array,width:number,height:number,source:ICCBytes):Promise<Uint8Array> {
  if(!(input instanceof Uint8Array))throw Error('RGB input must be Uint8Array');
  const count=pixels(width,height,input.length,3),profile=sourceProfile(source);
  const {lcms,vendor}=await loadEngine(),handles=openTransform(lcms,vendor,profile);
  try {
    const result=new Uint8Array(input.length);
    for(let start=0;start<count;start+=BLOCK_PIXELS){const n=Math.min(BLOCK_PIXELS,count-start),rgb=lcms.cmsDoTransform(handles.transform,input.subarray(start*3,(start+n)*3),n);if(rgb.length!==n*3)throw Error('LittleCMS returned an invalid RGB block');result.set(rgb,start*3);}
    return result;
  } finally {lcms.cmsDeleteTransform(handles.transform);lcms.cmsCloseProfile(handles.output);lcms.cmsCloseProfile(handles.input);}
}

let exportedProfile:Promise<Uint8Array>|undefined;
export async function exportSRGBProfile():Promise<Uint8Array> {
  exportedProfile??=(async()=>{
    const url=new URL('../vendor/color/srgb.icc',import.meta.url);
    let result:Uint8Array;
    if(url.protocol==='file:') {
      // Node tests use the same bundled asset; browser/worker never sees Node.
      const moduleName='node:fs/promises';
      const fs=await import(moduleName) as {readFile:(url:URL)=>Promise<Uint8Array>};
      result=Uint8Array.from(await fs.readFile(url));
    } else {
      const response=await fetch(url);
      if(!response.ok)throw Error('Bundled sRGB profile could not be loaded');
      result=new Uint8Array(await response.arrayBuffer());
    }
    inspectICC(result);return result;
  })().catch(error=>{exportedProfile=undefined;throw error;});
  return Uint8Array.from(await exportedProfile);
}
