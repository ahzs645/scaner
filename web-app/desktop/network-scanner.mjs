import {ImageBatch, compact, errorTokens} from '../dist/protocol.js';
import {FF680W_PROFILE} from '../dist/profiles/ff680w.js';
import {NodeFramedSession, requireFF680W} from './network-settings.mjs';

const MAX_JOB_BYTES = 512 * 1024 * 1024;
const message = error => error instanceof Error ? error.message : String(error);

function checkCapabilities(caps, options) {
  if(!caps.resolutions.includes(options.dpi)) throw Error('Network scanner does not advertise requested DPI');
  if(options.duplex && !caps.duplex) throw Error('Network scanner does not advertise duplex');
  if(!caps[options.mode]) throw Error('Network scanner does not advertise requested color mode');
  if(options.deskew && !caps.deskew) throw Error('Network scanner does not advertise deskew');
  if(options.double_feed && !caps.doubleFeed) throw Error('Network scanner does not advertise double-feed detection');
  if(options.auto_crop && (!caps.crop || !caps.cropResolutions.includes(options.dpi))) throw Error('Network scanner does not advertise requested automatic crop');
  if(options.quality < caps.quality.min || options.quality > caps.quality.max) throw Error('Network scanner does not advertise requested JPEG quality');
}

function bounded(promise, deadline, signal) {
  if(signal?.aborted) return Promise.reject(Error('Network scan stopped'));
  const remaining = deadline - Date.now();
  if(remaining <= 0) return Promise.reject(Error('Network scan deadline exceeded'));
  return new Promise((resolve,reject) => {
    const cleanup = () => {clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    const abort = () => {cleanup();reject(Error('Network scan stopped'));};
    const timer = setTimeout(()=>{cleanup();reject(Error('Network scan deadline exceeded'));},remaining);
    signal?.addEventListener('abort',abort,{once:true});
    Promise.resolve(promise).then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
  });
}

/** Native Epson TCP acquisition. Every completed image is handed off before
 * another IMG request, preserving backpressure and earlier durable pages. */
export async function scanNetwork(connectionOptions, requestedOptions, onImage, signal = connectionOptions?.signal) {
  // Pure model planning and callback validation precede ALL socket/media effects.
  const options = structuredClone(requestedOptions);
  const plan = FF680W_PROFILE.buildScanPlan(options);
  if(typeof onImage !== 'function') throw Error('Network scan requires an image callback');
  if(signal?.aborted) throw Error('Network scan stopped');
  const connection = {...connectionOptions,deadlineMs:connectionOptions?.deadlineMs??300000,signal,allowAcquisition:true};
  const session = new NodeFramedSession(connection), deadline = Date.now()+connection.deadlineMs;
  const batch = new ImageBatch(options,24*1024*1024);
  let acquisitionAttempted = false, saved = 0, jobBytes = 0, primary, warnings = [];
  const checkStop = () => {if(signal?.aborted)throw Error('Network scan stopped');if(Date.now()>=deadline)throw Error('Network scan deadline exceeded');};
  try {
    await session.open();checkStop();
    const info = await session.query('INFO');errorTokens(info.items,'INFO');requireFF680W(info);
    const capa = await session.query('CAPA');errorTokens(capa.items,'CAPA');
    const settings = {CAPA:capa.items.map(compact)};
    checkCapabilities(FF680W_PROFILE.decodeCapabilities(settings.CAPA),options);
    errorTokens((await session.query('STAT')).items,'Scanner status');checkStop();
    for(const action of FF680W_PROFILE.mechanicalActions(settings)) {
      errorTokens((await session.acquire('MECH',new TextEncoder().encode(action))).items,'Feeder load');checkStop();
    }
    const para = await session.acquire('PARA',plan.payload);errorTokens(para.items,'Parameters');
    if(!para.items.some(item=>item.name==='par'&&item.value==='OK  '))throw Error('Network scanner did not accept parameters');
    checkStop();acquisitionAttempted = true;
    errorTokens((await session.acquire('TRDT')).items,'Scan start');
    while(!batch.done) {
      checkStop();const block=await session.acquire('IMG ');
      jobBytes += block.data.length;
      if(jobBytes>MAX_JOB_BYTES)throw Error('Network scan exceeds the 512 MiB job limit');
      const image=batch.accept(block);
      if(image) {checkStop();await bounded(onImage(image),deadline,signal);saved++;}
      if(!batch.done && !block.data.length) await bounded(new Promise(resolve=>setTimeout(resolve,100)),deadline,signal);
    }
    batch.validate();
  } catch(error) {primary = error;}
  finally {warnings = await session.close({cancel:acquisitionAttempted&&!batch.done});}
  if(primary) {
    const error = Error(message(primary)+(saved?` · ${saved} completed images preserved`:'')+(warnings.length?' · Cleanup warning':''),{cause:primary});
    error.warnings = warnings;error.images = saved;throw error;
  }
  return {sheets:batch.counts.front,images:saved,warnings};
}
