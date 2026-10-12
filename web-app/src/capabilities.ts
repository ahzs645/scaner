// SANE-style option constraints: availability comes from CAPA, separate from the UI.
export interface Capabilities {
  resolutions:number[]; cropResolutions:number[]; duplex:boolean; color:boolean; gray:boolean;
  crop:boolean; deskew:boolean; doubleFeed:boolean; quality:{min:number;max:number};
}
export interface CapabilityLimits { resolutions: readonly number[]; cropResolutions: readonly number[] }
export function capabilities(items:unknown[], limits?:CapabilityLimits):Capabilities {
  const values=(name:string)=>items.filter((item):item is {name:string;value:string}=>typeof item==='object'&&item!==null&&'name' in item&&item.name===name&&'value' in item&&typeof item.value==='string').map(item=>item.value);
  const adf=values('ADF'),colors=values('COL').join('');
  const decimals=(values:string[])=>values.flatMap(value=>[...value.matchAll(/d([0-9]{3})/g)].map(match=>Number(match[1])));
  const horizontal=decimals(values('RSM')),vertical=decimals(values('RSS'));
  const resolutions=[...new Set(limits?.resolutions ?? horizontal)].filter(dpi=>horizontal.includes(dpi)&&vertical.includes(dpi));
  const cropResolutions=[...new Set(decimals(adf.filter(value=>value.startsWith('RSMS'))))].filter(dpi=>!limits||limits.cropResolutions.includes(dpi));
  const quality=decimals(values('JPG'));
  return {resolutions,cropResolutions,duplex:adf.some(v=>v.includes('DPLX')),color:colors.includes('C024'),gray:colors.includes('M008'),
    crop:adf.some(v=>v.includes('CRP '))&&adf.some(v=>v.includes('PEDT')),deskew:adf.some(v=>v.includes('SKEW')),doubleFeed:adf.some(v=>v.includes('DFL1')),
    quality:{min:quality[0]??1,max:quality[1]??100}};
}
export function cropUnavailableReason(caps:Capabilities,dpi:number):string|undefined {
  if(!caps.crop)return 'This scanner does not advertise crop and paper-end detection.';
  if(!caps.cropResolutions.includes(dpi))return 'Cropping requires '+caps.cropResolutions.join(' or ')+' dpi.';
  return undefined;
}
