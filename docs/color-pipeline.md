# Local scanner color workflow

Scan Studio now separates acquisition, color characterization and creative edits.
USB and Electron TCP capture use the same optional `neutral-v1` serializer: 24-bit
RGB JPEG, explicitly specified `GMMUG18`, identity RGB channel tables and `CMXUNIT`.
The new UI uses it for color captures. Legacy captures retain their exact bytes and
are marked as having an unspecified prior color matrix, not retroactively neutral.
On this FF-680W, parameter-only validation accepted quality100/200dpi/duplex and
RESA confirmed UG18 and UNIT. The probe sent no TRDT/IMG and fed no paper.
Evidence: `rea-evidence/color-neutral-parameters-live.json`.

In **Edit → Color correction**, import an RGB scanner INPUT ICC profile or choose
**Create measured profile**. Profile structure is checked before a bounded worker
asks LittleCMS to build the transform. Monitor/printer/device-link profiles are
not accepted into the scanner library. Imported profiles are explicitly unverified
for these acquisition settings; the user must supply a matching scanner profile.
The app never assigns an arbitrary sRGB profile to unknown device samples.

## Creating a measured profile

1. Use a physical reflective color target and its manufacturer/batch reference
   file, with D50 / CIE 1931 2° Lab or XYZ values. A home-printed chart does not
   supply known colors. Scan the target with the current app, preferably JPEG
   quality100; record and repeat all capture settings.
2. Select the original target page and choose **Create measured profile**. Load
   the CGATS reference file. Confirm that it matches the physical target and
   reference illuminant/observer. Metadata absent from a file is not verified
   automatically.
3. Set original-pixel grid bounds, rows, columns, first reference patch and inset.
   Each overlay box must cover the matching patch in row-major reference order.
   This is manual regular-grid alignment, not automatic IT8 recognition. For IT8
   charts with separate gray strips, choose a regular color-patch block. A skewed
   or uneven layout needs an aligned scan or a suitable regular subset.
4. **Measure and validate profile** samples inset regions, excludes clipped or
   highly uneven patches, then fits a nonnegative 3×3 XYZ matrix with independent
   channel tone exponents. At least24 usable patches,18 training and6 withheld
   patches are needed. Ill-conditioned and inadequate coverage cannot pass.
5. Review the report. The model is fitted using training patches only; withheld
   patches measure DeltaE76. Save is enabled only when mean≤4,p95≤8,max≤15 and
   other quality guards pass. These are application acceptance guards, not an
   ICC certification. Withheld patches come from the same capture: repeat-target
   measurements are still needed to establish scanner repeatability.
6. Save/export the INPUT ICC and the measurement report. The stored measured
   profile is tied to scanner serial/firmware, model, serializer revision, scan
   side, DPI, JPEG quality, paper geometry and capture crop/deskew. USB and network
   addresses are not part of that identity. An old capture without consistent
   acquisition and identity cannot create a reusable measured profile.

Front and back are separate calibration scopes. Use Selected page for a measured
side-specific profile; applying it to the opposite side or different settings is
rejected before any page is changed. A matrix/tone model cannot represent every
scanner response. Poor fits remain unsaved; import an externally measured LUT ICC
when necessary. The model uses D50 target values without automatic paper-white
normalization. See `color-calibration-research.md` for technical limits.

## Rendering, comparison and export

Original JPEGs remain immutable. Device JPEG samples are decoded without browser
ICC conversion, transformed once through locally bundled LittleCMS WASM to sRGB,
then cropped/rotated. The derived PNG embeds the OUTPUT sRGB ICC, never the scanner
INPUT profile. Color is part of the saved recipe and undo history. Removing color
retains geometric edits; Restore original clears every edit. Preview selector
compares original and edited versions. **Compare with another scan** opens a local
JPEG/PNG, such as an Epson export of the same target, beside the current preview.
The visual comparison does not claim numerical calibration or Epson parity.

Edited ZIP exports include source ICC files, profile provenance/validation JSON
and per-page recipes; corrected PNGs carry their output ICC. Original exports
remain byte-exact JPEGs. Profiles and edits survive app reload in separate local
IndexedDB stores. Export backups: browser storage can be cleared or evicted.

All engines, profiles and licenses are local static assets. No image upload,
scanner server, CDN fallback or backend is used for color processing. The page
keeps `connect-src 'none'`; isolated color workers can fetch only bundled color
assets. ICC files are bounded to4MiB, original JPEGs64MiB/40M pixels, processed
PNGs64MiB/page and stored edits512MiB/job. Worker cancellation/timeout preserves
originals and earlier durable edits.

## Epson investigation and actual validation boundary

`epson-color-investigation.md` documents that ESProfile0082 is an RGB correction
matrix, ESProfile1047 gray-balance gains, and ESLUT0016 a tone recipe. Embedded ICCs
in the searched Epson resources belong to UI images, not scanner characterization.
None is bundled or relabeled as a scanner INPUT profile. These observations do
not establish the complete Epson host processing sequence or an Epson-equivalent
color response. Source-derived SANE tables also differ from our current acquisition.

The implementation is testable with numerical synthetic targets and known ICCs.
There is no measured physical target and matching reference available in this
workspace, so the scanner has not been assigned a claimed calibrated profile.

## Implementation validation — October11,2026

235 automated browser/native tests passed, including ICC structure/LUT validation,
profile persistence, crop/rotation/color recipes, measured-fit holdouts, strict JPEG
framing and four real scanner captures. The JPEG decoder needed a documented
upstream patch for legal FF fill bytes before restart markers; it remains strict.
Matched native libjpeg-turbo decode comparisons differed by at most4 byte values
with mean differences below1; chroma sampling is nearest-neighbor in this decoder.

Real Chrome workers completed seven synthetic color pipeline checks. The GUI was
also tested in an isolated synthetic workspace: fitting, saving a passing INPUT
ICC, matching-profile activation and rejection after changing the simulated scanner
unit all worked. These checks are numerical software validation, not physical
scanner calibration. Evidence: `rea-evidence/browser-color-validation.json` and
`rea-evidence/color-calibration-ui-validation.json`.

The Electron UI imported a clearly marked synthetic INPUT ICC, corrected an actual
FF-680W network capture, saved an sRGB-tagged PNG and exported source-profile
provenance. Independent native LittleCMS matched exported pixels within1 byte value
(mean0.0000119711), using the same independently validated decoded device samples.
The untouched back JPEG remained byte-exact. Evidence:
`rea-evidence/color-export-validation.json`; artifact `scans/color-validation/`.
The temporary correction was undone and the profile selection cleared. Both
actual scan originals remain untouched; prior Chrome crop/rotation edits remain.

The isolated GUI/test pages and synthetic assets are removed from deploy builds.
The packaged Mac app includes color runtime assets, licenses and rebuild sources.
Its existing standalone network EHOSTUNREACH limitation is separate from color
processing; the development Electron launch is the verified network capture path.
