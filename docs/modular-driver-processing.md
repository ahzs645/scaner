# Modular browser drivers and image processing

The standalone app in `web-app/` acquires USB scans, processes pages and stores results in the browser. The development server serves static assets only: no scanner access, upload endpoint, job API or processing backend. Build with `npm run build` in `web-app/`; deploy its `dist/` with the headers below. `npm test` rebuilds and runs the source's regression tests. Hardware behavior is documented separately; unit tests do not establish support for an additional scanner.

## Driver boundary and registration

[driver.ts](../web-app/src/driver.ts) defines the application-facing ScannerDriver: connect/settings/reset/disconnect, option validation, reported capabilities, and scan with an async per-image callback plus AbortSignal. A registration combines a profile with a driver factory. The factory boundary does not require an ESC/I-2 implementation; another protocol can implement the same lifecycle contract. Device identity, settings and side/page output belong to drivers; rotation/cropping belong to processors.

[registry.ts](../web-app/src/registry.ts) validates nonempty profile identity, factory presence, 16-bit USB IDs and duplicate registrations before discovery. It freezes copied match keys, filters both paired devices and the chooser, and rejects unregistered devices before invoking a factory or opening USB. An exact vendor/product match is checked again by the concrete driver before open. The interface does not accept arbitrary device IDs or probe unknown devices using an Epson command.

[profiles/index.ts](../web-app/src/profiles/index.ts) currently registers **only Epson FF-680W, USB 04b8:016b**. Its FF-680W profile supplies ESC/I-2 defaults, scan planning, capability decoding and LUT/matrix data. A registry entry is architecture, not evidence that another Epson or unrelated scanner works. To add a model, create its profile and factory, establish actual transport/capability/scan evidence, and test option validation plus unknown-device rejection. Keep model-specific acquisition behavior—including unadvertised LOAD omission, FIN completion and physical image-count limits—inside the appropriate driver/profile.

## Immutable captures and transforms

[storage.ts](../web-app/src/storage.ts) upgrades IndexedDB to version 2, preserving jobs/images and adding a separate edits store. Original JPEGs are immutable; native image decoding validates their actual dimensions. Each saved edit contains a recipe, derived bytes, dimensions, notices and up to 20 earlier recipe revisions. Undo regenerates the earlier recipe from the original; it does not repeatedly crop/re-encode a prior edit. Restore original clears the effective transform. Browser storage is origin-specific and subject to quota/eviction, so explicit original/processed downloads remain important.

The deterministic rendering order in [processing/render.ts](../web-app/src/processing/render.ts) is:

1. Decode immutable original JPEG.
2. Crop a rectangle expressed in **original-image pixel coordinates**.
3. Apply a clockwise quarter turn, swapping output dimensions for 90/270 degrees.
4. Encode a distinct lossless PNG when edited; a no-op returns the original JPEG.

The recipe records version, crop and rotation. Crop bounds are validated inside the original and mapped outward from downsampled analysis to avoid inward rounding. Lossless PNG prevents additional encoding loss after decoding; it cannot recover detail already lost in the scanner's JPEG. Preview/export can select original or processed versions, while the export manifest records original names, side/sheet identity, dimensions and processing metadata.

Manual quarter turns, conservative automatic paper-boundary crop and optional automatic upright text detection share selected-page/all-pages scope. After-capture processing runs after acquisition completes, preserving the completed scan if processing is stopped or fails. Hardware auto-crop remains a separate acquisition option; software cropping does not change reported device capabilities. This implementation does not claim camera perspective correction, book dewarping or perfect content preservation by a detector.

## Processing limits and workers

| Resource | Enforced boundary |
|---|---|
| Captured JPEG accumulation | 24 MiB per side image in ImageBatch. |
| Derived output/storage | 64 MiB per processed page. |
| Job byte budgets | 512 MiB original captures, and separately 512 MiB aggregate processed edits. These are separate budgets, not a combined 512 MiB ceiling. |
| Source geometry | At most 40 million pixels. |
| Crop analysis | At most 1000 px per side / one million pixels. |
| Orientation analysis | A separate copy downscaled to a maximum 2200 px long edge. |
| Edit undo | At most 20 prior recipes per page. |

[WorkerImageProcessor](../web-app/src/processing/client.ts) serializes work, validates input recipes, and terminates its worker on abort/timeout/error. [detect.ts](../web-app/src/processing/detect.ts) reports uncertainty rather than forcing a crop. All analysis and full-resolution rendering are local; disposing owned ImageBitmaps/canvases limits retained memory. Boundary scores are heuristic evidence, not probabilities or a guarantee that faint edge content is safe.

## Local upright-text orientation

[orientation.ts](../web-app/src/processing/orientation.ts) lazy-loads pinned Tesseract.js 7.0.0/core 7.0.0 and legacy OSD data 1.0.0 from the app's own `vendor/ocr/` directory. No CDN fallback is configured. The build copies runtime/model/license assets and writes a version/hash manifest. An OSD-only worker uses legacyCore/legacyLang and OEM.TESSERACT_ONLY; images are passed as local Blobs, never remote image URLs.

Tesseract.js orientation_degrees already means the **clockwise corrective rotation**: apply it directly, without another sign inversion. Only 0/90/180/270 with finite confidence at least 15 are accepted. Confidence is an engine margin score, not a percentage. Null/low-confidence results, sparse text, photos, failure or cancellation leave orientation unchanged. User edits remain separate from the orientation decision. The adapter reuses a ready worker but discards failed/canceled/timed-out engines. See [processing research](browser-processing-research.md) for exact API, assets, sign evidence and traineddata provenance.

## Static hosting and worker headers

Use a secure context and a supported desktop Chromium browser (Chrome/Edge) for direct USB. Pairing requires a user gesture and explicit permission; HTTPS hosting does not let a remote server access USB on its own. Loopback development at `http://127.0.0.1:8765` is suitable; arbitrary plain HTTP hosting is not. Close other scanner applications when they own the device. These restrictions follow [WebUSB pairing requirements](https://developer.mozilla.org/en-US/docs/Web/API/USB/requestDevice).

The document and ordinary processing-worker responses keep network connections disabled. The **OCR worker response** receives its own narrow exception for local model assets; an external worker's CSP cannot be assumed from the document's policy. [serve.mjs](../web-app/scripts/serve.mjs) applies the correct distinction locally and accepts GET/HEAD only.

For a public static deployment at exactly `https://scanner.example/`, configure HTTP response headers along these lines (replace the example origin and adapt the asset prefix if hosting under a subpath):

```http
# index.html and ordinary app/processing-worker assets
Content-Security-Policy: default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
Permissions-Policy: usb=(self)
X-Content-Type-Options: nosniff

# /vendor/ocr/worker.min.js response only
Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src https://scanner.example/vendor/ocr/; object-src 'none'
X-Content-Type-Options: nosniff
```

Serve `.js` as JavaScript and `.wasm` as `application/wasm`. No wildcard origins, CDN scripts, broad connect-src self, or JavaScript unsafe-eval are necessary. The OCR worker can fetch the pinned runtime/model subtree, while page scans stay in memory/IndexedDB. Choose a static host that supports worker-response headers; HTML meta CSP alone does not replace that deployment requirement. This OSD runtime does not require the shared-memory COOP/COEP configuration of the separate sane-wasm research option.
