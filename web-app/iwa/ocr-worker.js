// Tesseract's classic worker loads the appropriate bundled legacy core.
const ocrWorker = new URL('./worker.min.js', self.location.href).href;
const ocrScripts = new Set([ocrWorker, ...['', '-simd', '-relaxedsimd'].map(suffix =>
  new URL('./core/tesseract-core' + suffix + '.wasm.js', self.location.href).href)]);
self.trustedTypes?.createPolicy('default', {
  createScriptURL(value) {
    if (!ocrScripts.has(value)) throw new TypeError('OCR script URL is outside the Scan Studio bundle');
    return value;
  },
});
importScripts(ocrWorker);
