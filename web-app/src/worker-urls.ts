const bundledWorkers = new Set([
  './processing/worker.js',
  './color/worker.js',
  './color/validate-worker.js',
  './vendor/ocr/iwa-worker.js',
].map(path => new URL(path, import.meta.url).href));
let installed = false;

/** Tesseract passes a plain string to Worker, so use a default policy which
 * accepts only the exact worker URLs packaged with the isolated app. */
export function installWorkerUrlPolicy(): void {
  if (installed || globalThis.location?.protocol !== 'isolated-app:') return;
  const {trustedTypes} = globalThis as typeof globalThis & {
    trustedTypes?: {createPolicy(name: string, rules: {createScriptURL(value: string): string}): unknown};
  };
  if (!trustedTypes) return;
  trustedTypes.createPolicy('default', {
    createScriptURL(value) {
      if (!bundledWorkers.has(value)) throw new TypeError('Worker URL is outside the Scan Studio bundle');
      return value;
    },
  });
  installed = true;
}

export function createBundledWorker(url: URL): Worker {
  installWorkerUrlPolicy();
  return new Worker(url, {type: 'module'});
}
