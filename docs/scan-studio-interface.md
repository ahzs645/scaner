# Scan Studio interface — October 11, 2026

**Update:** the [modular driver and image pipeline](modular-driver-processing.md)
now adds durable pixel rotation, conservative auto-crop, local Tesseract upright
text orientation, batch edits, undo and processed exports. References to
preview-only rotation below describe the earlier interface validation.

Built a complete new browser interface around the existing FF-680W driver.
Design references: Storytold [PhotoCraft](https://github.com/storytold/photocraft)
and [PdfCraft](https://github.com/storytold/pdfcraft). Inspected PhotoCraft's
published editor screenshot and both apps' `crates/ui-egui/src/theme.rs` sources
on this date: docked panels, compact toolbars, document canvas, property tabs,
dark/light surfaces and selection accents. The implementation is original HTML,
CSS and TypeScript, with locally defined SVG icons and system fonts. Craft Rust
code/assets are not copied or executed. Existing GPL notices remain intact.

New functionality:

- Saved-job sidebar with search, complete/interrupted status and selection.
- Central original-image preview with page navigation, fit/percentage zoom and
  independent per-page preview rotation.
- Page strip and overview, with selected-page dimensions and byte counts.
- Capture/Page info/Activity inspector, live capabilities and device controls.
- Original JPEG download and ZIP export; no image re-encoding.
- Dark/light theme persisted in localStorage, keyboard tab/page navigation,
  labeled controls, focus indicators and narrow-screen drawers.
- New workspace/empty state/help; saved scans retained and newest restored on load.

The IndexedDB database and file schema are unchanged. `scanner.ts`, `planner.ts`,
`protocol.ts`, `storage.ts` and `zip.ts` were not changed for the redesign.
`main.ts` integrates the new UI with existing acquisition callbacks. Scan options
are validated before job creation; optional settings use live CAPA. The default
sheet limit is one for a fresh interface; loading a saved job restores its options.
Rotation is preview-only and is stated in Page info/help/status. No permanent
page deletion, fake editing controls, PDF or OCR buttons were introduced.

## Verified

- Strict TypeScript compilation and all 65 existing tests pass after the UI
  rewrite; the final accessibility/drawer refinements also compile.
- Actual Chrome UI loaded existing job
  `597516cf-1689-4b53-8fc1-e2dd7238210d` and displayed both 1696 × 2200 color sides.
- Next/previous selection, preview rotation, zoom/fit, page overview, job search,
  tab keyboard navigation, help dialog and new workspace were exercised.
- Theme survived reload; saved job survived and restored first-page selection.
- Narrow viewport checks confirmed both drawers and no horizontal document
  overflow; the temporary viewport override was reset afterward.
- Connected to the real FF-680W and read INFO/CAPA/RESA/STAT through the redesigned
  controls. Crop was disabled at 200 dpi, enabled at 300, and disabled again at 200.
  No new physical scan or USB reset was issued during interface validation.
- ZIP export after preview rotation passed independent Python `zipfile` CRC and
  byte-for-byte original-image comparison. JPEG hashes:
  front `5899da35dc171c422ecbb6c925d0ae8d55df2b9f127c06a36db3e46271fe8c12`;
  back `65afb1f591bb9052d1ae48803db609fb0615122589782fb3709f3000249806c6`.
  Archive remains 1,304,600 bytes with two JPEGs plus the correct settings manifest.
  Copy: `scans/browser-only/597516cf-1689-4b53-8fc1-e2dd7238210d/scan-studio-export.zip`.

Screenshots: `scan-studio-dark.png`, `scan-studio-light.png`, `scan-studio-empty.png`.
The app remains at http://127.0.0.1:8765/ with a static-only host and same-origin
assets. It retains the previously validated scan driver; hardware acquisition
evidence and remaining feature gaps are in the existing browser-only validation.
The new UI itself does not add PDF/OCR, calibrated color, restoration or Wi-Fi.
