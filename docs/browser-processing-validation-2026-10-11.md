# Browser driver and processing validation — 2026-10-11

The standalone static app at `http://127.0.0.1:8765/` was validated in desktop
Chrome 154. No new physical scan was requested during this processing work;
the existing real 200 dpi RGB duplex capture was used. The new registry selected
the FF-680W profile and successfully reconnected/read live device settings through
WebUSB. Hardware scan coverage remains documented in the earlier scan reports.

## Automated and native browser checks

- `npm test`: strict TypeScript build and **135 passing tests**. Coverage includes
  exact protocol payloads, model registry isolation, capability/option validation,
  session ownership and failures, bounded image processing, conservative detection,
  OSD sign/composition/confidence/lifecycle, storage migration/undo and ZIP decoding.
- Native browser crop/quarter-turn pixel harness: all four rotations produced
  **zero mismatched pixels** against a separate coordinate-based expected image.
  Evidence: [pixel checks](rea-evidence/browser-processing-pixel-checks.json).
- Real Tesseract WASM OSD on synthetic local text: physical clockwise
  0/90/180/270 returned corrective 0/270/180/90. All scores exceeded 15
  (30.2, 31.7, 23.8, 34.2). A blank white page returned null confidence/rotation
  and was declined. Evidence: [orientation checks](rea-evidence/browser-orientation-checks.json).
- Main document HTTP CSP retains `connect-src 'none'`. OCR worker response allows
  only its local OCR asset subtree, with WASM execution. POST returned 405.
  The real OSD tests succeeded under these policies without a CDN fallback.

## Existing captured pages, edits and exports

The IndexedDB v1 job and both original JPEGs survived the v2 schema upgrade.
Native browser auto-crop accepted a bright document aligned to one capture edge,
with conservative margin and the touching coordinate preserved. Front crop:
`{x:279,y:0,width:1143,height:1818}`; back:
`{x:274,y:0,width:1148,height:1818}`. Edits, original comparison and dimensions
survived reload. Selected-page manual rotation, all-pages crop/orientation and undo
were exercised through the interface.

Both actual mixed-layout pages produced OSD scores below 15. The app displayed
its reason and retained the existing rotation. Initial scores were 6.0 and 14.5;
the manually corrected back was still uncertain at 13.0. This is useful abstention,
not evidence of successful automatic orientation on this document. The front
remained at its manual 270° rotation; the back was manually corrected to 90°.
Final derived PNG dimensions were 1818×1143 and 1818×1148. Original dimensions
remained 1696×2200.

Both final exports passed independent Python `zipfile` CRC validation and Pillow
image decoding/dimension checks. `scan-job.json` accurately records crop,
rotation, output dimensions and OSD decisions. Original-export JPEG bytes exactly
match the previously saved capture files:

- Front SHA-256: `5899da35dc171c422ecbb6c925d0ae8d55df2b9f127c06a36db3e46271fe8c12`
- Back SHA-256: `65afb1f591bb9052d1ae48803db609fb0615122589782fb3709f3000249806c6`

Detailed local export evidence is saved beside the capture in
`scans/browser-only/<job-id>/pipeline/validation-final.json`; processed-final.zip
and original-final.zip are preserved there. The interface screenshot is
[scan-studio-processing.png](scan-studio-processing.png).

## Limits of this validation

Only the FF-680W is registered and hardware checked. Another model needs a real
profile/factory and transport evidence. Auto-crop is conservative for bright paper
against a contrasting bed and declines ambiguous geometry; it does not establish
perfect cropping for photos, dark paper, low contrast or camera perspective.
OSD needs enough reliable text and is explicitly optional. The new after-capture
processing toggles are wired to run after successful scanner finalization; no
new physical capture with those toggles was issued in this validation.

See [framework and hosting instructions](modular-driver-processing.md) and
[source comparisons](browser-processing-research.md).
