# Existing app foundations — October 11, 2026

Goal: incorporate the validated FF-680W TypeScript/WebUSB driver into an existing
app while retaining fully browser-side acquisition and local document handling.
Source inspection only; none of these apps was installed or hardware-tested in
this comparison. The existing scanner app/driver was not changed.

## Closest browser app: WebScan

[goncalomb/webscan](https://github.com/goncalomb/webscan) is a React/TypeScript
WebUSB/SANE-WASM app. Its current source was downloaded read-only into ignored
`references/webscan/`, commit `e1d1ef33cf73d9a7e1d1d79a78f14e37b6857156`
(2026-10-08). The UI code is MIT licensed; that does not change the licenses of
SANE/WASM or our incorporated GPL-2.0-only grayscale table.

Useful existing pieces:

- `OptionsSelector.tsx`: generic SANE option descriptors and constraints.
- `PaperSizeSelector.tsx`: acquisition geometry and paper presets.
- `Canvas.tsx` / `CanvasContext.tsx`: preview and individual image export.
- `ImageList.tsx`: thumbnails, page movement/deletion, multi-image PDF using
  jsPDF, and ZIP export.

It is a demo app rather than an established drop-in custom-driver framework.
`SANEContext.tsx` and `ScanController.tsx` depend directly on sane-wasm handles,
options and ScanImageReader. There is no existing FF-680W TS plugin slot.

Integration proposal (not implemented): replace that coupling with a common
ScannerAdapter exposing connect, capabilities, scan(options,onPage,signal),
reset and disconnect. Implement it around our existing Scanner; retain our
on-device PAG counts, FIN completion, crop payloads and completed-page handling.
Later a separate patched SANE/WASM adapter could support other scanner families.

Retain our IndexedDB JPEG blobs/metadata as document storage. WebScan currently
keeps full RGBA ImageData pages in React memory and re-encodes them for export;
this adds memory and can alter JPEG output. Generate reduced thumbnails and
decode full pages only for editing. Keep original captures and edited versions
distinct. Use our validated original-JPEG export unless an edit requires
re-encoding. A small browser page editor/PDF layer can also be added to our
current app without adopting the whole WebScan UI.

## Other candidates

| Foundation | Existing functionality | Fit for our browser-only driver |
| --- | --- | --- |
| [scanservjs](https://github.com/sbs20/scanservjs) | SANE web UI, batches, PDF/TIFF, Tesseract OCR, image filters and localization | Requires Linux/VM, Node, sane-utils, ImageMagick and Tesseract. A custom native SANE backend could integrate through scanimage; our WebUSB driver would require replacing the browser/server acquisition and processing architecture. Useful workflow reference, substantial migration for no backend. |
| [NAPS2 SDK](https://www.naps2.com/sdk) | .NET scanning, PDF/TIFF/JPEG/PNG, OCR, WIA/TWAIN/SANE/eSCL | Strong desktop foundation. The documented API uses native drivers and does not accept our TypeScript/WebUSB Scanner directly. Integration would need a native driver/backend or a separate scanned-image handoff. |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | Browser PDF creation, JPEG embedding and page manipulation | Library rather than scanner app; useful for PDF export around our driver. |
| [Tesseract.js](https://github.com/naptha/tesseract.js) | Browser OCR using a WASM engine and workers | Library rather than scanner app; useful for local OCR. Vendor worker/core/language assets and configure local URLs; searchable PDF assembly remains separate work. |

Recommendation: use WebScan as the first app-fork candidate, or borrow its page
management patterns into our current app. Keep the driver independent of React
and document export. Preserve our working USB/batch logic and durable JPEG store;
use established PDF/OCR libraries above them. A source-reviewed adapter prototype
should be tested with one-sheet duplex, two-sheet batches, reset/repeat jobs and
failed-job preservation before replacing the current app.

Primary references for WebScan features:
[ImageList.tsx](https://github.com/goncalomb/webscan/blob/e1d1ef33cf73d9a7e1d1d79a78f14e37b6857156/src/components/ImageList.tsx),
[CanvasContext.tsx](https://github.com/goncalomb/webscan/blob/e1d1ef33cf73d9a7e1d1d79a78f14e37b6857156/src/components/CanvasContext.tsx),
[ScanController.tsx](https://github.com/goncalomb/webscan/blob/e1d1ef33cf73d9a7e1d1d79a78f14e37b6857156/src/components/ScanController.tsx).
