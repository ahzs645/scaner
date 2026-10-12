# Epson FF-680W color investigation — 2026-10-11

The installed model's three referenced color tables are **not ICC profiles**.
They contain an RGB correction matrix, a gray-balance matrix, and a tone-curve
recipe. An optional SANE acquisition preset can be reproduced from open source;
it must not be advertised as Epson color parity or scanner ICC characterization.
No hardware, Epson application, or UI was operated in this investigation.

Machine-readable fingerprints, search boundaries, and recommendations are in
`../web-app/third-party/epson-color-evidence.json`. That file contains research
metadata, not proprietary resource payloads or a runtime profile. No Epson
resources or extracted ICC files were added to the application.

## Actual referenced resources

The source model is
`/Library/Image Capture/Support/EPSON/Epson Scan 2/Models/ES0170/ES0170.bundle/Contents/Resources/ALL/ES0170.plist`.
SHA-256: `11b120c02066274a1d52a52692db30d2800f3cd85040b4548b64e7c34df5a403`.
It names product FF-680W, model 0170, default gamma 2.2, FIT and DTR2 processing
plugins, and Image Filter 5. Its sibling `ConvertTable.plist` independently maps
the table IDs into named parameters. These are binary property lists decoded
with Python `plistlib`; the observations are ordinary resource parsing, not
decompilation or observed application execution.

The resources resolve under `Models/Common/Tables/`:

| Reference | Actual relative path | Decoded content |
| --- | --- | --- |
| ESProfile0082 | `Profile.bundle/Contents/Resources/Profile/ESProfile0082.plist` | Reflective, Negative, Positive RGB 3×3 integer matrices |
| ESProfile1047 | `Profile.bundle/Contents/Resources/Profile/ESProfile1047.plist` | Same matrix container; Reflective is a diagonal gray-balance adjustment |
| ESLUT0016 | `LUT.bundle/Contents/Resources/LUT/ESLUT0016.plist` | Per-channel shadow/highlight/gamma controls plus curve-selection IDs |

`ESProfile0082` Reflective rows, interpreted with the scale 10000, are:

```text
R  [ 1.0229,  0.0009, -0.0238 ]
G  [ 0.0031,  1.0287, -0.0318 ]
B  [ 0.0044, -0.1150,  1.1106 ]
```

This normalization is an inference corroborated by an exact numeric match to
the open SANE `lut_id == 2` matrix branch, `backend/epsonds.c:3160`. Negative
and Positive are identity matrices in the plist. `ESProfile1047` Reflective
has diagonal integers 10120, 9940, 9940; under the same inferred scale these are
gains 1.012, 0.994, 0.994. It is selected by `ESGrayBalanceGammaTable`.

`ESLUT0016` gives all three channels shadowIn 50, shadowOut 10, highlightIn 210,
highlightOut 255, gamma 1.0. Photo shadow/highlight curve IDs are 2 and 1. It is
selected by `ESDefaultLUTTable` only under the resource condition
`ESCurrentMode == 1`. The meaning of that mode and the full nonlinear curves
are unresolved here. Endpoints and curve IDs do not establish the exact
256-byte scanner GMT tables; generating those tables by assuming linear
interpolation would be guesswork. The model's gamma 2.2 value also does not
establish a corresponding ESC/I-2 gamma token.

## Acquisition versus host processing

Retained canonical REA dispatch evidence
`ev_d99b72d67c82f16b052e37d5c32bff143334ec8c5bc92cecf150ed6a8dd1962f`
identifies `ESCI2Scanner` color/gamma methods in the Scanner binary, SHA-256
`cae0ae95bc6794ffd613d893f6f3146557c1673c92b1dcd9ceea2773370e069f`.
Its metadata coverage is partial; no native decompiler is configured. Existing
`rea-evidence/scanner-disassembly-arm64.txt` supplies additional ordinary
`otool` instruction observations, not new REA Evidence:

- `_setColorMatrix:` at 0x175a0 builds the acquisition parameter key `#CMX`.
  Mode 1 rounds nine coefficients with multiplier 32 and creates nine bytes with
  a sign bit; mode2 uses multiplier 8192 and 18 bytes. Mode 0 selects `UNIT`.
  The mode1 four-character value is `UM08`. This establishes a hardware
  acquisition-matrix encoding path; it does not prove the active model resource
  was passed to that path during a scan.
- `setGammaTable:forChannel:` at 0x1a564 builds `#GMT`, selecting `MONO`, `RED `,
  `GRN `, or `BLU `, and stores the supplied table in acquisition parameters.
- Ordinary `nm -arch arm64` inspection of the model's FIT plugin finds
  `MakeFIT3LUT`, `ColorMatrixConv`, and functions for contrast, brightness,
  tone curves, and gray balance. DTR2 and Image Filter 5 expose additional image
  processing operations. Symbol names establish available entry points, not
  their settings, ordering, or use in the current scan.

The distinction is therefore precise: `GMT` and `CMX` are acquisition controls;
Epson also has host color/appearance processing. The property-list IDs alone
do not show which stage consumes each table, whether a particular transform is
applied twice, or the final saved-image appearance. A complete Epson parity
claim would require controlled wire and processed-image evidence. Nothing in
this review proves that an arbitrary host RGB look should be sent as CMX.

## ICC search and reconstruction boundary

All 655 property lists in the selected Epson tree parsed successfully and
contained zero Data blobs. No standalone `.icc` or `.icm` files occurred.
An additional bounded scan covered all 1077 files, 95,767,366 bytes, with no
files above the 64 MiB per-file limit or skipped files. It searched for `acsp`
at ICC header offset 36, checked declared size and each tag range, and decoded
profile descriptions. It found 291 embedded candidates, four unique digests:

| Description | Class/space | Occurrences | Location kind |
| --- | --- | --- | --- |
| sRGB IEC61966-2.1 | mntr / RGB | 192 | UI TIFFs and two nibs |
| Generic Gray Gamma2.2 Profile | mntr / GRAY | 95 | UI nibs |
| Display | mntr / RGB | 2 | `bmp_edgefill_image.tiff` |
| Generic Gray Profile | mntr / GRAY | 2 | photo-preview nib |

These are real, bounded ICC byte sequences. Exact local extraction could
preserve their bytes and container hash/offset provenance, but **none of these
observed profiles characterizes FF-680W input**. The JSON retains descriptions,
hashes, representative locations/offsets, and counts without copying profiles.
No scanner input profile was found in this search boundary; profiles elsewhere
or generated at runtime were not examined.

An RGB-to-RGB correction matrix cannot be relabeled as an ICC device-to-PCS
transform. The referenced tables supply no established colorimetric primaries,
PCS mapping, white-point characterization, or complete tone response. A real
scanner ICC would need independent measured characterization, or a genuine
user-provided profile with matching capture provenance. The profile header and
input-profile requirements are defined in the
[ICC.1:2022 specification](https://www.color.org/specification/ICC.1-2022-05.pdf),
sections 7–8. Matrix/TRC scanner profiles are permitted; the missing issue here
is measured characterization, not a prohibition on that profile type.
[ICC FAQ](https://www.color.org/faqs/).

## Optional SANE acquisition preset

The checked source is official SANE commit
`36c87fc33d91ebd60f70a0934f2e44ffd9a818d2` under `references/sane-backends`.
FF-680W USB 016B maps to LUT family 2 without hardware LUT handling
(`backend/epsonds.c:1250`). RGB acquisition sends `GMMUG18`, then 256-byte
`GMTRED `, `GMTGRN ` and `GMTBLU ` family2 tables (`:3094` onward).
Their hashes are retained in `rea-evidence/sane-color-comparison.json` and the
new evidence JSON. These are acquisition curves rather than output ICC data.

SANE's initial family 2 matrix matches Epson0082, but an unconditional assignment
later overwrites every coefficient (`:3239` onward). Consequently an honest
SANE-source preset must encode its **final** RGB rows:

```text
[ 0.9864,  0.0248, -0.0112 ]
[ 0.0021,  1.0100, -0.0112 ]
[ 0.0139, -0.1249,  1.1110 ]
```

Its source rounding preserves row sums at 32. The rounded RGB rows are
`[31,1,0]`, `[0,32,0]`, `[0,-4,36]`. The source's nine-byte ordering and sign
encoding yield `20 01 84 00 1f 00 00 00 24` after `#CMXUM08h009`, then three
zero padding bytes. This encoding was independently recalculated from the
retained source; no hardware acceptance or color improvement is claimed.

Recommended label: **SANE family2 acquisition — experimental**. Keep the
current acquisition available; compare target scans and hold all other settings
fixed. Gate against advertised `GMM=UG18`, RGB GMT channels, and `CMX=UM08`.
Retained live CAPA evidence advertises these tokens, but this is distinct from
validating a new preset on hardware. Preserve the GPL-2.0-only source notice
and attribution when reusing SANE tables/rounding. Do not substitute Epson's
plist or call the preset an ICC, factory calibration, or Epson FastFoto match.

## Calibration acquisition signature

A user-created calibration must remain tied to the actual RGB input it was
fitted against. Save the original JPEG and derive a versioned signature from:

- Driver/model and serializer revision; device serial or explicit unknown;
  firmware; front/back surface. Do not silently share one surface calibration
  across both cameras or another scanner unit.
- Color mode, DPI, JPEG quality, geometry/paper, crop, deskew, and double-feed
  options, as conservative acquisition constraints.
- Raw gamma mode; SHA-256 of each actual GMT byte table; CMX mode and SHA-256
  of encoded matrix bytes, or **absent** if no matrix command was sent. An
  omitted CMX is not evidence of `UNIT`; avoid that unsupported assumption.
- Decoded RGB interpretation and pipeline revision. For untagged device JPEGs,
  explicitly record the working-space assumption and any browser color-space
  conversion; do not describe those RGBs as measured scanner-linear values.

PAG/job count, transfer block size, network host and session identity are not
color controls and should not force a new calibration. Whole PARA hashing is
useful for raw audit but overly strict for calibration reuse because it includes
those job fields. Hash canonical color semantics separately and retain the raw
payload digest as diagnostic evidence.

Fit against a known target with its correct reference data in a defined color
space; reject clipped/invalid/poor samples, save fit and independent validation
errors, and preserve target identity/reference digest and capture signature.
Applying that learned host transform once to matching original image data is
separate from selecting hardware SANE acquisition. A preset change invalidates
the existing capture signature and requires another fit. Keep optional artistic
looks separate from calibration and apply them only after the calibrated stage.
The exact fitting model and quality thresholds are application design decisions,
not findings about Epson's proprietary pipeline.

All requested resources were located and decoded. Their precise live
application, the complete Epson LUT generator, and Epson saved-image parity
remain unresolved; no proprietary ICC reconstruction or automatic application
is supported by this evidence.
