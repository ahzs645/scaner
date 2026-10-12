# SANE source comparison — October 11, 2026

Downloaded a shallow checkout of the official SANE backends project to
`references/sane-backends`. This contains the project source, not the full Git
history. Checkout: `36c87fc33d91ebd60f70a0934f2e44ffd9a818d2`, dated October 10,
2026. The FF-680W crop merge-request head was fetched separately as `origin/mr919`,
`4f2255e3b73e8afe2a0f8e6d7426f3a56789276c`, dated May 6, 2026. The working
checkout remains upstream master. SANE has not been built or run against this Mac's
scanner; this is a source comparison with our already tested implementation.

Earlier work had saved selected SANE `epsonds.c` and `epsonds-cmd.c` sources and
used SANE's command behavior and grayscale LUT. This continuation adds the full
source checkout and a more systematic comparison.

## What matches and differs

| Area | Current SANE epsonds / scanimage | Our project |
| --- | --- | --- |
| Device | Explicit FF-680W USB ID 04b8:016b; complete status | The same real scanner, USB tested on this Mac |
| Protocol | Epson ESC/I-2 commands and USB bulk transfers | Same command family; PyUSB or direct Chrome WebUSB |
| Capture | Color, gray and lineart; model-dependent modes | Color and gray implemented; lineart absent |
| Geometry | Arbitrary top/left/width/height in mm | Letter/A4/Legal centered presets |
| Output | Backend JPEG decode to standard SANE image frames; scanimage can encode several formats, including PDF, with build dependencies | Preserves device JPEGs; no PDF/OCR pipeline yet |
| Color | Model LUT selection and RGB tone tables plus UM08 matrix command | Matching SANE grayscale LUT; identity RGB LUTs; no explicit matrix |
| Batch | SANE page/frame API and scanimage batch loop | Explicit physical-sheet count translated to PAG side count; numbered front/back JPEGs |
| Settings | Capability-gated standard acquisition controls | Live raw identity/capabilities/current parameters plus explicit quality, DFL1 and count controls |
| Browser | Native SANE API; separate projects such as sane-wasm adapt it to WebUSB | Direct WebUSB; new TypeScript app builds parameters and stores/exports entirely in-browser |
| Epson extras | This backend's option set does not provide complete ScanSmart/FastFoto processing or maintenance parity | Also unfinished: restoration, rotation, blank-page processing, OCR and maintenance |

Source anchors in the downloaded checkout:

- Device LUT/model mapping: `backend/epsonds.c:1250`.
- Complete USB support listing: `doc/descriptions/epsonds.desc:267`.
- Actual backend option enum: `backend/epsonds.h:80`; source/geometry/skew/crop
  initialization: `backend/epsonds.c:1927` onward. Its option set does not include
  a full Epson-style brightness/restoration/OCR/maintenance panel.
- Source/color/JPEG/gamma payload: `backend/epsonds.c:2937` onward.
- RGB tone tables: `backend/epsonds.c:3094`; grayscale table: `:3058`.
- JPEG decode and software lineart conversion: `backend/epsonds-jpeg.c:100`, `:154`.
- PDF and batch output belong to the frontend, e.g. `frontend/scanimage.c:1519`,
  `:2415`, not to an Epson device setting.

## Color is the largest image-appearance difference

The FF-680W maps to LUT family 2 with software-supplied hardware tone tables.
Our 256-byte grayscale LUT exactly matches SANE family 2. The family 2 red,
green and blue LUTs differ from our identity curves in 252, 253 and 253 entries
respectively. Fingerprints and counts are saved in
`rea-evidence/sane-color-comparison.json`.

SANE also sends `CMXUM08h009` with an encoded color-correction matrix. The code
contains family-specific matrix branches, but a later unconditional assignment
overwrites their coefficients before serialization (`epsonds.c:3239` onward).
Thus the emitted matrix uses those final coefficients; the earlier DS-530/family
2 coefficients alone do not describe what it actually sends.

Our color output therefore should not be described as matching SANE or Epson's
processed color. A sensible next comparison is an explicit optional SANE-style
color profile, paired scans of a known color target, and side-by-side evaluation.
No color parameters were changed during this source review.

## The FF-680W crop fix is absent from this upstream checkout

Master still clears the auto-crop flag when geometry is set
(`backend/epsonds.c:2398`). Its CAPA handler only logs PEDT
(`backend/epsonds-cmd.c:662`), and its source payload appends CRP without PEDT
(`backend/epsonds.c:2937`). These are exactly the two behaviors addressed by
[merge request 919](https://gitlab.com/sane-project/backends/-/merge_requests/919).

The separately fetched MR head adds `adf_has_pedt`, records the capability, keeps
crop enabled during geometry negotiation and sends PEDT when crop is requested.
Our custom payload pairs `CRP PEDT`; a later 300 dpi color duplex browser batch
produced four images with document-sized boundaries on this Mac. The new TS app
retains those payload bytes, but its live scan used no crop at 200 dpi.
The MR's published hardware evidence is for a
FF-680W over USB on Debian/Raspberry Pi, not this Mac.

## Practical direction

SANE is a strong reference and a useful candidate for standard scanner-application
integration. It would provide image decoding, flexible geometry and an existing
frontend ecosystem. Our narrower path already has live Mac USB/batch validation,
explicit count controls and direct browser settings access. A complete choice
between them needs a real SANE build/scan comparison, including the crop patch;
source support status is not proof of behavior on this particular Mac.

See `sane-lifecycle-comparison.md` for the separate protocol/lifecycle audit.

The lifecycle review also led to Python cleanup/count corrections: no CAN before
a TRDT attempt, explicit finalization failures, and immediate excess-side limit
checks. The later Python suite passes 104 tests. The new TypeScript app adds
bounded transfers/images, native browser JPEG decoding, IndexedDB and local ZIP
export. Its 65 tests and one-sheet hardware result are recorded in
`browser-only-validation-2026-10-11.md`.
