/** Measured-target scanner characterization. No chart or reference values are invented. */
export type Triple = [number, number, number];
export interface ReferencePatch { id: string; xyz: Triple; lab: Triple }
export interface CalibrationSample { id: string; rgb: Triple; spread?: number; clippedFraction?: number }
export interface ScannerColorModel { matrix: [Triple, Triple, Triple]; gamma: Triple }
export interface ErrorSummary { count: number; mean: number; median: number; p95: number; max: number }
export interface CalibrationReport {
 version: 1; metric: 'DeltaE76'; model: 'matrix-per-channel-gamma'; accepted: boolean;
 training: ErrorSummary; validation: ErrorSummary; validationIds: string[]; validationIndices: number[];
 trainingIds: string[]; excludedIds: string[]; warnings: string[];
 thresholds: { mean: number; p95: number; max: number };
 patches: { id: string; index: number; set: 'training' | 'validation'; deltaE: number }[];
}
export interface FitOptions { name?: string; validationIds?: readonly string[]; createdAt?: Date }
export const D50: Triple = [0.9642, 1, 0.8249];
const MAX_PATCHES = 4096;
const thresholds = { mean: 4, p95: 8, max: 15 };
const finiteTriple = (v: readonly number[]): boolean => v.length === 3 && v.every(Number.isFinite);
const dot = (a: readonly number[], b: readonly number[]): number => a.reduce((s, v, i) => s + v * b[i]!, 0);
const norm = (v: readonly number[]): number => Math.sqrt(dot(v, v));
const median = (v: readonly number[]): number => { const s = [...v].sort((a,b) => a-b); return (s[Math.floor((s.length-1)/2)]! + s[Math.floor(s.length/2)]!)/2; };

export function xyzToLab(xyz: Triple): Triple {
 const f = (v: number) => v > 216/24389 ? Math.cbrt(v) : (24389/27*v + 16)/116;
 const [x,y,z] = xyz.map((v,i) => f(v/D50[i]!));
 return [116*y!-16, 500*(x!-y!), 200*(y!-z!)];
}
export function labToXYZ(lab: Triple): Triple {
 const y = (lab[0]+16)/116, x = y+lab[1]/500, z = y-lab[2]/200;
 const f = (v: number) => v*v*v > 216/24389 ? v*v*v : (116*v-16)/(24389/27);
 return [f(x)*D50[0], f(y), f(z)*D50[2]];
}
export function deltaE76(a: Triple, b: Triple): number { return Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]); }

/** CGATS tokens: quoted strings and # comments; no expressions, JSON, or executable syntax. */
function tokens(line: string): string[] {
 const result: string[] = []; let i = 0;
 while (i < line.length) {
  if (/\s/.test(line[i]!)) { i++; continue; }
  if (line[i] === '#') break;
  if (line[i] === '"') {
   i++; let value = ''; let closed = false;
   while (i < line.length) { const c = line[i++]!; if (c === '"') { closed = true; break; } if (c === '\\') { if (i >= line.length) throw Error('Invalid reference quoting'); value += line[i++]!; } else value += c; }
   if (!closed || (i < line.length && !/\s|#/.test(line[i]!))) throw Error('Invalid reference quoting');
   result.push(value);
  } else { const start = i; while (i < line.length && !/\s|#/.test(line[i]!)) i++; result.push(line.slice(start,i)); }
 }
 return result;
}
const numeric = (v: string): number => { if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v) || !Number.isFinite(Number(v))) throw Error('Non-finite or invalid reference number'); return Number(v); };
function validateReference(p: ReferencePatch): void {
 if (!p || typeof p.id !== 'string' || !p.id.trim() || p.id.length > 128 || /[\x00-\x1f]/.test(p.id) || !finiteTriple(p.xyz) || p.xyz.some(v => v < 0 || v > 1.8) || !finiteTriple(p.lab) || p.lab[0] < 0 || p.lab[0] > 100.1 || Math.abs(p.lab[1]) > 180 || Math.abs(p.lab[2]) > 180) throw Error('Reference patches must contain finite D50 colorimetry in range');
}
/** XYZ CGATS fields use the standard 0..100 scale. Lab fields are CIELAB D50.
 * Missing illuminant metadata requires the user to verify D50; explicit other illuminants are rejected. */
export function parseReference(text: string): ReferencePatch[] {
 if (typeof text !== 'string' || text.length > 2*1024*1024 || text.includes('\0')) throw Error('Reference text is limited to 2 MiB');
 const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/); if (lines.length > 20000) throw Error('Too many reference lines');
 let state: 'header' | 'format' | 'between' | 'data' | 'done' = 'header';
 let fields: string[] = [], rows: string[][] = [], fieldCount: number | undefined, rowCount: number | undefined;
 for (const line of lines) {
  if (line.length > 8192) throw Error('Reference line is too long');
  const t = tokens(line); if (!t.length) continue; const key = t[0]!.toUpperCase();
  if (key === 'BEGIN_DATA_FORMAT') { if (state !== 'header' || t.length !== 1) throw Error('Expected one reference table'); state = 'format'; continue; }
  if (key === 'END_DATA_FORMAT') { if (state !== 'format' || t.length !== 1 || !fields.length) throw Error('Invalid data format'); state = 'between'; continue; }
  if (key === 'BEGIN_DATA') { if (state !== 'between' || t.length !== 1) throw Error('Invalid data start'); state = 'data'; continue; }
  if (key === 'END_DATA') { if (state !== 'data' || t.length !== 1) throw Error('Invalid data end'); state = 'done'; continue; }
  if (state === 'format') { fields.push(...t.map(v=>v.toUpperCase())); if(fields.length>256) throw Error('Too many reference fields'); continue; }
  if (state === 'data') { rows.push(t); if (rows.length > MAX_PATCHES) throw Error('Reference is limited to 4096 patches'); continue; }
  if (state === 'done') throw Error('Only a single reference table is supported');
  if (key === 'NUMBER_OF_FIELDS' || key === 'NUMBER_OF_SETS') {
   if (t.length !== 2 || !/^\d+$/.test(t[1]!)) throw Error('Invalid reference count');
   const count = Number(t[1]); if (!Number.isSafeInteger(count) || count < 1 || count > (key === 'NUMBER_OF_FIELDS' ? 256 : MAX_PATCHES)) throw Error('Reference count out of range');
   if (key === 'NUMBER_OF_FIELDS') { if (fieldCount !== undefined) throw Error('Duplicate field count'); fieldCount = count; }
   else { if (rowCount !== undefined) throw Error('Duplicate row count'); rowCount = count; }
  }
  if (['OBSERVER_ANGLE','REFERENCE_OBSERVER'].includes(key) && !['2','2.0','1931_2','CIE1931_2'].includes(t.slice(1).join(' ').toUpperCase())) throw Error('Only CIE 1931 2 degree reference colorimetry is supported');
  if (['ILLUMINANT','REFERENCE_ILLUMINANT','ILLUMINATION_NAME'].includes(key) && t.slice(1).join(' ').toUpperCase() !== 'D50') throw Error('Only D50 reference colorimetry is supported');
 }
 if (state !== 'done' || !rows.length || (fieldCount !== undefined && fieldCount !== fields.length) || (rowCount !== undefined && rowCount !== rows.length) || new Set(fields).size !== fields.length) throw Error('Reference table is incomplete or counts do not match');
 const id = fields.indexOf('SAMPLE_ID') >= 0 ? fields.indexOf('SAMPLE_ID') : fields.indexOf('SAMPLE_NAME');
 const xi = ['XYZ_X','XYZ_Y','XYZ_Z'].map(v=>fields.indexOf(v)), li = ['LAB_L','LAB_A','LAB_B'].map(v=>fields.indexOf(v));
 const hasXYZ = xi.every(v=>v>=0), hasLab = li.every(v=>v>=0);
 if (id < 0 || (!hasXYZ && !hasLab)) throw Error('Reference requires SAMPLE_ID or SAMPLE_NAME and XYZ_X/Y/Z or LAB_L/A/B fields');
 const seen = new Set<string>();
 return rows.map(row => {
  if (row.length !== fields.length) throw Error('Reference row field count does not match');
  const name = row[id]!; if (seen.has(name)) throw Error('Duplicate reference patch ID'); seen.add(name);
  const xyz: Triple = hasXYZ ? xi.map(i=>numeric(row[i]!)/100) as Triple : labToXYZ(li.map(i=>numeric(row[i]!)) as Triple);
  const lab: Triple = hasLab ? li.map(i=>numeric(row[i]!)) as Triple : xyzToLab(xyz);
  const patch = {id:name,xyz,lab}; validateReference(patch);
  if (hasXYZ && hasLab && deltaE76(xyzToLab(xyz),lab)>3) throw Error('Reference Lab and XYZ fields disagree for D50');
  return patch;
 });
}
interface Pair { sample: CalibrationSample; reference: ReferencePatch; index: number }
export function predictXYZ(model: ScannerColorModel, rgb: Triple): Triple {
 const linear = rgb.map((v,i)=>Math.pow(v,model.gamma[i]!));
 return model.matrix.map(row=>dot(row,linear)) as Triple;
}
/** Reorthogonalized weighted QR avoids unstable inversion of normal equations. */
function leastSquares(rows: Triple[], values: Triple[], weights: number[]): [Triple,Triple,Triple] {
 const columns = [0,1,2].map(c=>rows.map((row,i)=>row[c]! * Math.sqrt(weights[i]!)));
 const q: number[][] = [], r: number[][] = [[0,0,0],[0,0,0],[0,0,0]];
 const largest = Math.max(...columns.map(norm));
 for (let j=0;j<3;j++) {
  const v = [...columns[j]!];
  for (let pass=0;pass<2;pass++) for(let k=0;k<j;k++) { const projection = dot(q[k]!,v); r[k]![j]! += projection; for(let i=0;i<v.length;i++) v[i]! -= projection*q[k]![i]!; }
  const length = norm(v); if (!Number.isFinite(length) || length < largest*1e-4) throw Error('Patch colors form a singular or poorly conditioned design');
  r[j]![j] = length; q.push(v.map(n=>n/length));
 }
 return [0,1,2].map(c=>{
  const rhs = q.map(col=>dot(col,values.map((v,i)=>v[c]! * Math.sqrt(weights[i]!)))); const x: Triple = [0,0,0];
  for(let j=2;j>=0;j--) { let value = rhs[j]!; for(let k=j+1;k<3;k++) value-=r[j]![k]!*x[k]!; x[j]=value/r[j]![j]!; }
  return x;
 }) as [Triple,Triple,Triple];
}
/** XYZType colorant tristimuli must be nonnegative. Enumerate active constraints
 * for the three-variable NNLS problem; never clamp a matrix after fitting. */
function nonnegativeLeastSquares(rows: Triple[], values: Triple[], weights: number[]): [Triple,Triple,Triple] {
 const unconstrained=leastSquares(rows,values,weights);
 return unconstrained.map((row,c)=>{
  if(row.every(v=>v>=0))return row;
  let best: Triple=[0,0,0], loss=values.reduce((sum,v,i)=>sum+weights[i]!*v[c]!**2,0);
  for(let mask=1;mask<8;mask++) {
   const active=[0,1,2].filter(i=>mask&(1<<i)), q: number[][]=[], r=active.map(()=>active.map(()=>0));
   for(let j=0;j<active.length;j++) {
    const v=rows.map((p,i)=>p[active[j]!]!*Math.sqrt(weights[i]!));
    for(let pass=0;pass<2;pass++)for(let k=0;k<j;k++){const d=dot(q[k]!,v);r[k]![j]!+=d;for(let i=0;i<v.length;i++)v[i]!-=d*q[k]![i]!;}
    const length=norm(v);r[j]![j]=length;q.push(v.map(n=>n/length));
   }
   const rhs=q.map(col=>dot(col,values.map((v,i)=>v[c]!*Math.sqrt(weights[i]!)))), x=active.map(()=>0);
   for(let j=active.length-1;j>=0;j--){let v=rhs[j]!;for(let k=j+1;k<active.length;k++)v-=r[j]![k]!*x[k]!;x[j]=v/r[j]![j]!;}
   if(x.some(v=>!Number.isFinite(v)||v<0))continue;
   const proposed: Triple=[0,0,0];active.forEach((a,i)=>{proposed[a]=x[i]!;});
   const error=rows.reduce((sum,p,i)=>sum+weights[i]!*(dot(proposed,p)-values[i]![c]!)**2,0);
   if(error<loss){best=proposed;loss=error;}
  }
  return best;
 }) as [Triple,Triple,Triple];
}
function candidate(pairs: Pair[], gamma: Triple): { model: ScannerColorModel; loss: number } {
 const rows = pairs.map(p=>p.sample.rgb.map((v,i)=>v**gamma[i]!) as Triple), values = pairs.map(p=>p.reference.xyz);
 let weights = pairs.map(()=>1), matrix = nonnegativeLeastSquares(rows,values,weights);
 for (let iteration=0;iteration<3;iteration++) {
  const errors = rows.map((row,i)=>norm(matrix.map((m,c)=>dot(m,row)-values[i]![c]!)));
  const scale = Math.max(0.002,median(errors)*1.5);
  weights = errors.map(e=>Math.min(1,scale/Math.max(e,1e-12))); matrix = nonnegativeLeastSquares(rows,values,weights);
 }
 const residuals = rows.map((row,i)=>norm(matrix.map((m,c)=>dot(m,row)-values[i]![c]!)));
 const loss = residuals.reduce((sum,e)=>sum+(e<=0.02 ? e*e : 0.04*e-0.0004),0)/pairs.length;
 return {model:{matrix,gamma:[...gamma]},loss};
}
function optimize(pairs: Pair[]): ScannerColorModel {
 let best: ReturnType<typeof candidate> | undefined;
 for(const initial of [0.6,1,1.6,2.2,3]) {
  let current = candidate(pairs,[initial,initial,initial]);
  for(const step of [0.5,0.2,0.07,0.025,0.008,0.0025]) {
   for(let round=0;round<12;round++) {
    let improved = false;
    for(let c=0;c<3;c++) for(const direction of [-1,1]) {
     const gamma: Triple = [...current.model.gamma]; gamma[c]! += step*direction; if(gamma[c]!<0.2||gamma[c]!>5) continue;
     const proposal = candidate(pairs,gamma); if(proposal.loss+1e-12<current.loss) { current=proposal; improved=true; }
    }
    if(!improved) break;
   }
  }
  if(!best||current.loss<best.loss) best=current;
 }
 return best!.model;
}
function hash(id: string): number { let h=2166136261; for(let i=0;i<id.length;i++)h=Math.imul(h^id.charCodeAt(i),16777619); return h>>>0; }
function summarize(errors: number[]): ErrorSummary { const sorted=[...errors].sort((a,b)=>a-b); return {count:errors.length,mean:errors.reduce((a,b)=>a+b,0)/errors.length,median:median(errors),p95:sorted[Math.ceil(errors.length*0.95)-1]!,max:sorted.at(-1)!}; }
function determinant(m: [Triple,Triple,Triple]): number {return m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);}
export function fitScannerProfile(samples: readonly CalibrationSample[], references: readonly ReferencePatch[], options: FitOptions = {}): {iccBytes: Uint8Array; report: CalibrationReport; model: ScannerColorModel} {
 if(!Array.isArray(samples)||!Array.isArray(references)||samples.length>MAX_PATCHES||references.length>MAX_PATCHES) throw Error('Calibration is limited to 4096 patches');
 const referenceMap = new Map<string,ReferencePatch>();
 for(const p of references) { validateReference(p); if(referenceMap.has(p.id))throw Error('Duplicate reference patch ID'); referenceMap.set(p.id,p); }
 const seen = new Set<string>(), excludedIds: string[] = [], pairs: Pair[] = [];
 samples.forEach((sample: CalibrationSample,index: number)=>{
  if(!sample || typeof sample.id!=='string' || seen.has(sample.id) || !Array.isArray(sample.rgb) || !finiteTriple(sample.rgb) || sample.rgb.some((v: number)=>v<0||v>1))throw Error('Patch samples require unique IDs and finite RGB in 0..1');
  seen.add(sample.id); const reference = referenceMap.get(sample.id); if(!reference)throw Error('Sample patch ID is missing from the reference');
  if((sample.spread!==undefined&&(!Number.isFinite(sample.spread)||sample.spread<0||sample.spread>1))||(sample.clippedFraction!==undefined&&(!Number.isFinite(sample.clippedFraction)||sample.clippedFraction<0||sample.clippedFraction>1)))throw Error('Invalid patch sampling quality');
  if(sample.rgb.some((v: number)=>v<=1/255||v>=254/255)||(sample.clippedFraction??0)>0.01||(sample.spread??0)>0.12) {excludedIds.push(sample.id); return;}
  pairs.push({sample,reference,index});
 });
 if(pairs.length<24)throw Error('At least 24 usable, unclipped measured patches are required (including independent validation patches)');
 let validationIds: string[];
 if(options.validationIds) {
  validationIds = [...options.validationIds]; if(new Set(validationIds).size!==validationIds.length || validationIds.some(id=>!pairs.some(p=>p.sample.id===id)))throw Error('Validation IDs must uniquely identify usable sampled patches');
 } else validationIds = [...pairs].sort((a,b)=>hash(a.sample.id)-hash(b.sample.id)||(a.sample.id<b.sample.id?-1:a.sample.id>b.sample.id?1:0)).slice(0,Math.max(6,Math.floor(pairs.length/4))).map(p=>p.sample.id);
 const holdout = new Set(validationIds), training = pairs.filter(p=>!holdout.has(p.sample.id)), validation = pairs.filter(p=>holdout.has(p.sample.id));
 if(training.length<18||validation.length<6)throw Error('Use at least 18 training and 6 independent validation patches');
 for(let c=0;c<3;c++) { const v=training.map(p=>p.sample.rgb[c]!); if(Math.max(...v)-Math.min(...v)<0.3)throw Error('Training patches need a broad tone range in every RGB channel'); }
 const labs=training.map(p=>p.reference.lab);
 if(Math.max(...labs.map(v=>v[0]))-Math.min(...labs.map(v=>v[0]))<35 || [1,2].some(c=>Math.max(...labs.map(v=>v[c]!))-Math.min(...labs.map(v=>v[c]!))<20))throw Error('Training patches need diverse measured colors and lightness');
 const model = optimize(training);
 if(model.matrix.some(row=>row.some(v=>!Number.isFinite(v)||v<0||v>8))||determinant(model.matrix)<1e-5)throw Error('Measured model has an invalid or singular RGB color matrix');
 const white = predictXYZ(model,[1,1,1]); if(white.some(v=>v<0.3||v>1.8))throw Error('Measured model has an implausible extrapolated white point');
 const patches = pairs.map(p=>({id:p.sample.id,index:p.index,set:holdout.has(p.sample.id)?'validation' as const:'training' as const,deltaE:deltaE76(xyzToLab(predictXYZ(model,p.sample.rgb)),p.reference.lab)}));
 const trainingReport=summarize(patches.filter(p=>p.set==='training').map(p=>p.deltaE)), validationReport=summarize(patches.filter(p=>p.set==='validation').map(p=>p.deltaE));
 const reachedLimit=model.gamma.some(g=>g<=0.205||g>=4.995);
 const accepted=!reachedLimit&&validationReport.mean<=thresholds.mean&&validationReport.p95<=thresholds.p95&&validationReport.max<=thresholds.max;
 const warnings: string[] = [];
 if(excludedIds.length)warnings.push(`${excludedIds.length} clipped or nonuniform patches were excluded`);
 if(trainingReport.max>15)warnings.push('Some training patches have large residuals; check their reference mapping and sampling regions');
 if(pairs.length<100)warnings.push('Small targets provide limited characterization; a larger measured target is preferable');
 if(!accepted)warnings.push('Withheld-patch error exceeds the application acceptance limits; check the target reference, grid alignment and repeatable capture settings');
 if(reachedLimit)warnings.push('A tone exponent reached its fitting limit; this model may not describe the scanner response');
 const report: CalibrationReport={version:1,metric:'DeltaE76',model:'matrix-per-channel-gamma',accepted,training:trainingReport,validation:validationReport,validationIds:validation.map(p=>p.sample.id),validationIndices:validation.map(p=>p.index),trainingIds:training.map(p=>p.sample.id),excludedIds,warnings,thresholds:{...thresholds},patches};
 return {iccBytes: encodeInputICC(model,options.name??'Measured scanner input profile',options.createdAt), report, model};
}

/** ICC.1:2010 v4.3 RGB Input matrix/TRC profile, D50 XYZ PCS. */
export function encodeInputICC(model: ScannerColorModel, name: string, createdAt = new Date()): Uint8Array {
 if(!model || !Array.isArray(model.matrix) || model.matrix.length!==3 || model.matrix.some(r=>!finiteTriple(r)||r.some(v=>v<0||v>8))||!finiteTriple(model.gamma)||model.gamma.some(g=>g<0.2||g>5)||determinant(model.matrix)<1e-5)throw Error('Invalid matrix/TRC profile model');
 if(typeof name!=='string'||!name.trim()||name.length>160||/[\x00-\x1f]/.test(name)||!Number.isFinite(createdAt.getTime())||createdAt.getUTCFullYear()<1900||createdAt.getUTCFullYear()>9999)throw Error('Invalid ICC profile metadata');
 const signature=(bytes:Uint8Array,offset:number,s:string)=>{for(let i=0;i<4;i++)bytes[offset+i]=s.charCodeAt(i);};
 const xyzTag=(v:Triple)=>{const b=new Uint8Array(20),d=new DataView(b.buffer);signature(b,0,'XYZ ');v.forEach((n,i)=>d.setInt32(8+4*i,Math.round(n*65536)));return b;};
 const localized=(text:string)=>{const b=new Uint8Array(28+text.length*2),d=new DataView(b.buffer);signature(b,0,'mluc');d.setUint32(8,1);d.setUint32(12,12);d.setUint16(16,0x656e);d.setUint16(18,0x5553);d.setUint32(20,text.length*2);d.setUint32(24,28);for(let i=0;i<text.length;i++)d.setUint16(28+2*i,text.charCodeAt(i));return b;};
 const curve=(gamma:number)=>{const n=4096,b=new Uint8Array(12+2*n),d=new DataView(b.buffer);signature(b,0,'curv');d.setUint32(8,n);for(let i=0;i<n;i++)d.setUint16(12+2*i,Math.round((i/(n-1))**gamma*65535));return b;};
 const tags: [string,Uint8Array][]=[['desc',localized(name.trim())],['cprt',localized('Measured target characterization generated locally by Scan Studio')],['wtpt',xyzTag(D50)],...([0,1,2].map((c)=>[['rXYZ','gXYZ','bXYZ'][c]!,xyzTag(model.matrix.map(row=>row[c]!) as Triple)] as [string,Uint8Array])),...model.gamma.map((g,c)=>[['rTRC','gTRC','bTRC'][c]!,curve(g)] as [string,Uint8Array])];
 const align=(n:number)=>(n+3)&~3; let length=128+4+12*tags.length; const offsets=tags.map(([,b])=>{const offset=length;length+=align(b.length);return offset;});
 const bytes=new Uint8Array(length),view=new DataView(bytes.buffer);view.setUint32(0,length);view.setUint32(8,0x04300000);signature(bytes,12,'scnr');signature(bytes,16,'RGB ');signature(bytes,20,'XYZ ');signature(bytes,36,'acsp');view.setUint32(64,1);D50.forEach((v,i)=>view.setInt32(68+i*4,Math.round(v*65536)));
 const date=[createdAt.getUTCFullYear(),createdAt.getUTCMonth()+1,createdAt.getUTCDate(),createdAt.getUTCHours(),createdAt.getUTCMinutes(),createdAt.getUTCSeconds()];date.forEach((v,i)=>view.setUint16(24+2*i,v));view.setUint32(128,tags.length);
 tags.forEach(([sig,b],i)=>{signature(bytes,132+12*i,sig);view.setUint32(136+12*i,offsets[i]!);view.setUint32(140+12*i,b.length);bytes.set(b,offsets[i]!);});return bytes;
}
