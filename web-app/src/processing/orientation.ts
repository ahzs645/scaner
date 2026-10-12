export type OrientationRotation = 0 | 90 | 180 | 270;
export interface OrientationDecision {
  rotation: OrientationRotation | null;
  confidence: number | null;
  accepted: boolean;
  reason: string;
  script?: string | null;
  method: string;
}
export interface OrientationSource { blob: Blob; width: number; height: number }
export interface OsdWorker {
  detect(image: Blob): Promise<{data: unknown}>;
  terminate(): Promise<unknown> | void;
}
export interface LocalWorkerOptions {
  legacyCore: true; legacyLang: true; workerBlobURL: false;
  workerPath: string; corePath: string; langPath: string;
  gzip: true; cacheMethod: 'write'; errorHandler: (error: unknown) => void;
}
export interface TesseractModule {
  OEM: {TESSERACT_ONLY: number};
  createWorker(language: string, mode: number, options: LocalWorkerOptions): Promise<OsdWorker>;
}
export interface OrientationDetectorOptions {
  confidenceThreshold?: number;
  timeoutMs?: number;
  loader?: () => Promise<TesseractModule>;
  prepareInput?: (source: OrientationSource, signal?: AbortSignal) => Promise<Blob>;
}
const METHOD = 'tesseract-osd';
function validateThreshold(threshold: number): void {
  if(!Number.isFinite(threshold) || threshold < 0) throw Error('Orientation confidence threshold must be a nonnegative finite number');
}
function validateSource(source: OrientationSource): void {
  if(!source || !(source.blob instanceof Blob) || !source.blob.size) throw Error('Orientation detection requires a nonempty image Blob');
  if(!Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height)
    || source.width <= 0 || source.height <= 0 || source.width * source.height > 40_000_000) {
    throw Error('Orientation detection is limited to 40 million source pixels');
  }
}

/** Tesseract.js detect() already reports the CLOCKWISE CORRECTION angle
 * ([0,270,180,90] mapped from Tesseract's orientation ID). Do not invert it.
 * Confidence is the engine's OSD score, not a probability or a percentage. */
export function decideOrientation(data: unknown, threshold = 15): OrientationDecision {
  validateThreshold(threshold);
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const rawConfidence = record.orientation_confidence, degrees = record.orientation_degrees;
  const confidence = typeof rawConfidence === 'number' && Number.isFinite(rawConfidence) && rawConfidence >= 0 ? rawConfidence : null;
  const script = typeof record.script === 'string' && record.script.trim() ? record.script : null;
  const result = {rotation: null, confidence, accepted: false, script, method: METHOD} as OrientationDecision;
  if(degrees === null || degrees === undefined) return {...result, reason: 'Not enough text for reliable orientation detection.'};
  if(typeof degrees !== 'number' || ![0,90,180,270].includes(degrees)) return {...result, reason: 'Orientation engine returned an unsupported angle.'};
  if(confidence === null) return {...result, reason: 'Orientation confidence is unavailable.'};
  if(confidence < threshold) return {...result, reason: `Orientation confidence ${confidence.toFixed(1)} is below ${threshold}.`};
  return {...result, rotation: degrees as OrientationRotation, accepted: true,
    reason: degrees === 0 ? 'Page is already upright.' : `Clockwise correction of ${degrees} degrees accepted.`};
}

/** Decode locally, check the actual dimensions, and downsample only the
 * analysis copy. Originals and the user's current render remain unchanged. */
export async function prepareOrientationInput(source: OrientationSource, signal?: AbortSignal): Promise<Blob> {
  validateSource(source);
  if(signal?.aborted) throw Error('Upright detection stopped');
  const bitmap = await createImageBitmap(source.blob);
  try {
    if(signal?.aborted) throw Error('Upright detection stopped');
    if(bitmap.width !== source.width || bitmap.height !== source.height) throw Error('Orientation image dimensions do not match its recorded size');
    const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
    if(scale === 1) return source.blob;
    const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    try {
      const context = canvas.getContext('2d');
      if(!context) throw Error('Orientation analysis canvas is unavailable');
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await canvas.convertToBlob({type: 'image/png'});
      if(signal?.aborted) throw Error('Upright detection stopped');
      if(!blob.size || blob.type !== 'image/png') throw Error('Orientation analysis image could not be prepared');
      return blob;
    } finally {canvas.width = 1; canvas.height = 1;}
  } finally {bitmap.close();}
}

/** No bare module imports or CDN fallbacks: the library, worker, core and OSD
 * data are served from this app's bundled vendor directory. Images are passed
 * as Blobs; the library never receives an image URL to fetch or upload. */
async function loadLocalTesseract(): Promise<TesseractModule> {
  const url = new URL('../vendor/ocr/tesseract.esm.min.js', import.meta.url);
  // v7's browser ESM artifact exports its native API as the default object.
  const module = await import(url.href) as {default: TesseractModule};
  return module.default;
}
interface Operation { stopped: boolean; worker?: OsdWorker; cancel: () => void; fail: (error: unknown) => void }

/** One detection at a time; ready workers are reused. Abort, timeout, failure
 * or disposal discards the engine so the next request starts fresh. */
export class OrientationDetector {
  private worker?: OsdWorker;
  private operation?: Operation;
  private readonly terminated = new WeakSet<OsdWorker>();
  private readonly threshold: number;
  private readonly timeoutMs: number;
  private readonly loader: () => Promise<TesseractModule>;
  private readonly prepareInput: (source: OrientationSource, signal?: AbortSignal) => Promise<Blob>;
  constructor(options: OrientationDetectorOptions = {}) {
    this.threshold = options.confidenceThreshold ?? 15; validateThreshold(this.threshold);
    this.timeoutMs = options.timeoutMs ?? 90_000;
    if(!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 2_147_483_647) throw Error('Orientation timeout must be a positive bounded number of milliseconds');
    this.loader = options.loader ?? loadLocalTesseract;
    this.prepareInput = options.prepareInput ?? prepareOrientationInput;
  }
  private terminate(worker?: OsdWorker): void {
    if(!worker || this.terminated.has(worker)) return;
    this.terminated.add(worker);
    try {void Promise.resolve(worker.terminate()).catch(() => {});} catch {}
    if(this.worker === worker) this.worker = undefined;
  }
  async detect(source: OrientationSource, signal?: AbortSignal): Promise<OrientationDecision> {
    validateSource(source);
    if(signal?.aborted) throw Error('Upright detection stopped');
    if(this.operation) throw Error('Orientation detector is busy');
    return new Promise((resolve, reject) => {
      const preparation = new AbortController();
      const operation: Operation = {stopped: false, worker: this.worker,
        cancel: () => fail(Error('Upright detection stopped')), fail: error => fail(error)};
      this.operation = operation;
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timer); signal?.removeEventListener('abort', operation.cancel);
        if(this.operation === operation) this.operation = undefined;
      };
      const fail = (error: unknown) => {
        if(operation.stopped) return;
        operation.stopped = true; cleanup(); preparation.abort(); this.terminate(operation.worker);
        reject(error instanceof Error ? error : Error(String(error)));
      };
      timer = setTimeout(() => fail(Error('Upright detection timed out; original capture is preserved')), this.timeoutMs);
      signal?.addEventListener('abort', operation.cancel, {once: true});
      void (async () => {
        const input = await this.prepareInput(source, preparation.signal);
        if(operation.stopped) return;
        let worker = this.worker;
        if(!worker) {
          const library = await this.loader();
          if(operation.stopped) return;
          if(typeof library.createWorker !== 'function' || library.OEM?.TESSERACT_ONLY !== 0) throw Error('Local orientation engine is unavailable');
          let initializedWorker: OsdWorker | undefined;
          worker = await library.createWorker('osd', library.OEM.TESSERACT_ONLY, {
            legacyCore: true, legacyLang: true, workerBlobURL: false,
            workerPath: new URL('../vendor/ocr/worker.min.js', import.meta.url).href,
            corePath: new URL('../vendor/ocr/core/', import.meta.url).href,
            langPath: new URL('../vendor/ocr/lang/', import.meta.url).href,
            gzip: true, cacheMethod: 'write',
            // Prevent the library's default asynchronous global throw; the
            // caller receives the primary error, with no image modification.
            errorHandler: error => {
              const active = this.operation;
              // Reused workers must reject the CURRENT request. An abandoned
              // old initializer/worker must never cancel a newer engine.
              if(initializedWorker ? active?.worker === initializedWorker : active === operation) {
                active?.fail(Error('Orientation engine failed: ' + String(error)));
              }
            },
          });
          initializedWorker = worker;
          // Native createWorker exposes its handle only after initialization.
          // A late result from a canceled initialization must never be reused.
          if(operation.stopped) {this.terminate(worker); return;}
          if(!worker || typeof worker.detect !== 'function' || typeof worker.terminate !== 'function') throw Error('Local orientation worker is unavailable');
          this.worker = worker;
        }
        operation.worker = worker;
        const result = await worker.detect(input);
        if(operation.stopped) return;
        const decision = decideOrientation(result.data, this.threshold);
        operation.stopped = true; cleanup(); resolve(decision);
      })().catch(fail);
    });
  }
  dispose(): void {
    if(this.operation) this.operation.cancel();
    else this.terminate(this.worker);
  }
}
