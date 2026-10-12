import type {ICCMetadata} from './icc.js';
export const CAPTURE_COLOR_PIPELINE='ff680w-rgb-identity-ug18-explicit-unit-jpeg-v1';
export interface ColorEdit {
 profileId:string;profileName:string;intent:'relative-colorimetric';output:'srgb';source:'imported'|'measured';
}
export interface ProfileRecord {
 id:string;name:string;bytes:Uint8Array;created:string;source:'imported'|'measured';
 metadata:ICCMetadata;
 captureSignature?:string;side?:'front'|'back';report?:unknown;referenceName?:string;referenceSHA256?:string;
}
export function captureSignature(job:{driverId?:string;deviceIdentity?:{model:string;serial:string;firmware:string};options:{mode:string;dpi:number;quality:number;paper?:string;auto_crop?:boolean;deskew?:boolean;color_capture?:string}},side?:string):string {
 const o=job.options;return JSON.stringify({driver:job.driverId??'unknown',device:job.deviceIdentity??'unknown-unit',pipeline:o.color_capture==='neutral-v1'?CAPTURE_COLOR_PIPELINE:'legacy-unspecified-matrix',mode:o.mode,dpi:o.dpi,quality:o.quality,paper:o.paper,crop:!!o.auto_crop,deskew:!!o.deskew,side:side??'unspecified'});
}
export function validateColorEdit(color:ColorEdit|undefined):void {
 if(color===undefined)return;
 if(!color||!/^icc:[a-f0-9]{64}$/.test(color.profileId)||typeof color.profileName!=='string'||color.profileName.length>160||color.intent!=='relative-colorimetric'||color.output!=='srgb'||!['imported','measured'].includes(color.source))throw Error('Invalid color correction recipe');
}
