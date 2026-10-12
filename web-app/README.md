# Scan Studio — FF-680W browser application

The driver, parameter builder, JPEG validation, saved jobs and ZIP export run
entirely in the browser. The scanner uses WebUSB bulk transfers, not Web Serial.
No Python, scanner service or upload API is needed.

## Workspace

The new interface is inspired by Storytold's PhotoCraft/PdfCraft editor layouts:
compact toolbars, a central document canvas, a saved-job browser, an inspector and
a page strip. It is independently implemented in HTML/CSS/TypeScript; no Craft
Rust code or branding assets are bundled. Automatic text orientation uses a
locally bundled Tesseract.js/WASM runtime, loaded only when requested.

Saved scans appear under **My scans** and can be searched. The latest job restores
on reload. Click a page thumbnail or use the arrow buttons/keys to move between
pages. Page overview shows the whole job; zoom operates on the preview. Rotation is now a durable pixel edit. The **Edit**
tab applies crop/rotation to one page or the whole job, with undo and restoration.
**Edited pages** exports use PNG for edited pages; **Original JPEGs** retains
capture bytes unchanged.
The inspector's **Capture**, **Edit**, **Page info** and **Activity** tabs expose job
settings, selected-page metadata, live capabilities and session events. Device
read/reset actions are under **Device controls**. New scan workspace clears the
current view while retaining saved jobs. A fresh install defaults to one sheet.

The theme button switches dark/light and remembers the choice locally. On narrow
screens, the toolbar buttons open the job browser and inspector as drawers.
Use the help button for scanner ownership, storage and feature limitations.
[Interface validation](../docs/scan-studio-interface.md) records browser checks.

## Add pages to a saved scan

Choose a document in **My scans** and click **Add pages**. Load more sheets,
connect the scanner, then choose **Add pages to this scan**. The new pages join
that document and its export; existing pages and edits are kept. Use
Command/Ctrl+Shift+Enter to add, or **Scan as new document** to create a separate
item. See [continuing scans](../docs/continue-scans.md) for mixed settings and
interrupted capture behavior.

## Keyboard shortcuts

Use the keyboard button in the header or press `?` for the complete guide.
`R` / `Shift+R` rotate, Command/Ctrl+Z undoes, Command/Ctrl+Shift+Z redoes,
and Command/Ctrl+S exports. Undo/redo persist after reload. Letter shortcuts
can be disabled in the guide. See [shortcut behavior and testing](../docs/keyboard-shortcuts.md).

## Run locally

```bash
cd scaner/web-app
npm ci --ignore-scripts
npm run dev
```

Open http://127.0.0.1:8765/ in desktop Chrome or Edge. Close ScanSmart, FastFoto,
Image Capture and Epson Scanner Monitor, then click **Connect scanner**. Only
one app can own USB. Disconnect before switching scanner applications. The older
Python browser server uses the same port; stop it first or use
`SCANNER_WEB_PORT=8766 npm run dev`.

Node only serves static files from `dist/`; it cannot access USB or save jobs.
Node is a development/build tool. Deploy `dist/` to HTTPS static hosting to use
the app without a local Node or Python installation. WebUSB requires a secure
context and user permission ([Chrome documentation](https://developer.chrome.com/docs/capabilities/usb)).
Opening source HTML as a local file is not the supported deployment path.
All runtime assets are bundled under `dist/vendor/ocr`; there are no CDN
fallbacks. Preserve the two CSP policies from `scripts/serve.mjs` when hosting.
The main document uses `connect-src 'none'`; the OCR worker response permits
WASM execution and fetching only its local OCR asset subtree. See the hosting
example in [framework details](../docs/modular-driver-processing.md). Distribute the corresponding source/build inputs and
`COPYING`/`NOTICE` with the GPL-2.0-only app.

## Settings and saved results

Choose color/grayscale, sides, resolution, acquisition area, quality, sheet
limit, crop, deskew and double-feed detection. Live CAPA constrains optional
controls; this unit advertises crop at 300/600 dpi. **1** requests one physical
sheet (two images in duplex); **0** requests the loaded batch. Stop preserves
completed images but cannot promise an immediate mechanical stop; the feeder
may prefeed another sheet. Every settings combination still needs validation.

Completed JPEGs pass native browser decoding and are saved individually in
IndexedDB. Jobs survive reload, including completed pages from failed jobs.
Storage belongs to this browser profile/origin; changing host/port/domain does
not transfer it. Browser storage can be cleared or evicted: download individual
JPEGs or **Export ZIP** for permanent copies. Choose original JPEGs or edited
pages. ZIP includes `scan-job.json` with capture settings, export dimensions, byte
counts and processing recipes. Originals remain unchanged even after edits.
Restored images appear front/back by sheet. Transfer/image/job bounds and browser
quota can limit large batches.

## Validation and further work

`npm test` builds strict TypeScript and runs 135 tests: exact Python payload parity,
live CAPA constraints, mocked USB batches/failures, IndexedDB transactions and
independent ZIP decoding. [Live validation](../docs/browser-only-validation-2026-10-11.md)
records a real color duplex one-sheet scan, reload and ZIP export. Multi-sheet and
cancel fault coverage for this new app uses mocks; earlier drivers also have
hardware batch results.

The app is experimental. PDF/TIFF, text extraction/searchable OCR, blank-page removal, calibrated
color/photo restoration, image enhancement, maintenance and Wi-Fi scanning remain
unfinished. [SANE/WASM comparison](../docs/backend-free-sane-options.md) explains
the TypeScript direction and selective future WASM use.

`planner.ts` builds parameters; `capabilities.ts` constrains settings;
`driver.ts`/`registry.ts` define model-independent discovery/contracts;
`profiles/` owns model IDs and behavior; `protocol.ts`/`scanner.ts` handles ESC/I-2;
`processing/` handles detection, crop/rotation, worker execution and edit recipes;
`storage.ts`/`zip.ts` persist and export; `main.ts` connects the UI.
The SANE grayscale LUT is attributed in `NOTICE`; GPL text is in `COPYING`.
RGB tables remain identity values. SANE's C/WASM backend and RGB correction
tables have not been incorporated or tested against this scanner.

## Driver profiles and image processing

[Framework and pipeline details](../docs/modular-driver-processing.md) describe
adding a model/protocol implementation and current image-processing limits.
Only the FF-680W is registered as supported. Other models require their own
profile/factory, protocol tests and hardware validation.

**Hardware crop** in Capture changes acquisition and is limited to advertised
DPI. **Auto-crop paper boundary** in Edit processes an already captured page at
any scan resolution. The detector is conservative for bright paper on a darker
scanner bed; ambiguous/unsupported boundaries leave the page unchanged. The
optional **Auto-crop after scanning** checkbox queues processing after capture
and session finalization, so a processing error never removes captured pages.
**Auto-orient text** detects the clockwise correction using Tesseract OSD;
**Auto-crop & orient** runs both stages. Either can apply to one page or all
pages. Capture also offers automatic orientation after scanning. Scores below
15, blank/sparse pages or unsupported detection results leave rotation unchanged
with an explanation. Manual rotation remains available; confidence is an engine
score, not a percentage. Local OCR analyzes a copy at most 2200 pixels on its
longest edge; it never sends scanned images to a server.

Rotation/crop recipes, derived PNGs and 20 undo recipes per page survive reload.
Every revision is rendered from the original JPEG, avoiding repeated re-encoding.
PNG preserves decoded pixels but can be larger than JPEG. Processing is bounded
at 40 million source pixels, one-million-pixel analysis, 64 MiB per edited page,
and 512 MiB of edited pages per job; original capture budgets remain separate.
Workers require modern browser OffscreenCanvas support, verified here in Chrome.

For real browser pixel checks, while the static host is running:

```bash
npm run prepare-browser-tests
```

Open http://127.0.0.1:8765/pipeline-check.html and click **Run pixel checks** or **Run orientation checks**.
The generated validation page is removed by a normal build before deployment.

[Processing validation](../docs/browser-processing-validation-2026-10-11.md) records
real browser OSD, pixel checks, existing capture edits and original-byte exports.


## Electron network prototype

The ordinary website has no raw TCP/mDNS APIs; Chrome Local Network Access does
not add them or bypass device CORS. An optional Electron shell supplies native
Bonjour discovery, FF-680W settings and network scanning over TCP 1865, with a
narrow preload bridge and the same interface. `npm run desktop` launches it;
`npm run package:desktop` builds a local Mac app. See
[desktop instructions](desktop/README.md) and
[network research/design](../docs/network-driver-design.md). A real network job completed: one duplex sheet, two RGB JPEGs at 200 dpi, saved
and exported locally. The Scan button uses the selected USB or network driver.
The development launch works; the independently launched Mac bundle still
reports EHOSTUNREACH on this computer, so standalone network capture is not
validated. See the desktop instructions for the current limitation.

## Local color profiles and calibration

The Edit tab provides scanner INPUT ICC import/export, local LittleCMS WASM
correction to sRGB, reversible color recipes, reference-scan comparison and
measured-target profile creation with withheld-patch validation. Corrected PNGs
embed sRGB; ZIP exports include source profiles and provenance. Original JPEGs
remain byte-exact. New color scans explicitly set the acquisition color matrix.
See [workflow and validation limits](../docs/color-pipeline.md). A real physical
reference target is still required to characterize this scanner; the app does
not claim Epson color parity or turn a synthetic test into a measured profile.
