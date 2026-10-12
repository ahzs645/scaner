# FF-680W settings inventory — 2026-10-11

This is an offline inventory of the installed Epson model resources and the
already captured real FF-680W INFO/CAPA replies. It distinguishes device options,
Epson application processing, and custom-driver implementation. It is not a claim
of complete Epson feature parity. No USB/network access or Epson app launch was
performed by this inventory worker.

## Evidence and coverage

- Real device replies: `rea-evidence/usb-info.txt`, `usb-capabilities.txt`.
- Installed model: `/Library/Image Capture/Support/EPSON/Epson Scan 2/Models/ES0170/ES0170.bundle/Contents/Resources/ALL/ES0170.plist`.
- Installed shared UI: `.../Models/Common/Common.bundle/Contents/Resources/UIInfo.plist`.
- Complete format-aware snapshots with source paths and SHA-256:
  `rea-evidence/settings-resource-inventory.json` (256 shared UI keys).
- Native target: Scanner.framework universal binary SHA-256
  `cae0ae95bc6794ffd613d893f6f3146557c1673c92b1dcd9ceea2773370e069f`;
  selected arm64 instructions in `rea-evidence/settings-count-disassembly-arm64.txt`.
- Prior REA metadata Evidence IDs and bounded coverage are documented in
  `rea-investigation.md`. The new instruction subset is ordinary static otool
  evidence, not a new REA Evidence record or observed native execution.

The shared UI includes many Epson models, film and flatbed options, and options
that constraints remove. Its 256 keys are an exhaustive resource-key inventory
of that one file, **not 256 supported FF-680W settings**. Model hardware keys,
CAPA, and runtime UI filtering have different meanings.

## Epson UI observed in this continuation

The coordinating agent inspected Epson's real UI and reported these selected
settings: color, 200 dpi, duplex, automatic size detection, automatic rotation,
paper-skew correction, blank-page skip enabled, and double-feed detection
enabled. Advanced controls visible included image option None, remove background,
text enhancement, color dropout (disabled for the selected RGB mode), brightness
0, contrast 0, gamma 2.2, sharpening off, descreening off, edge fill None, and
punch-hole removal off. This is runtime UI evidence reported by the coordinating
agent, separate from this worker's offline resource analysis. Matching these
settings requires both acquisition choices and host image processing. Hardware
crop is restricted to CAPA's 300/600 dpi; the successful browser 200-dpi job below
used fixed Letter geometry rather than hardware crop.

## Real device settings

| Setting | Device evidence / choices | Custom implementation / validation checkpoint |
| --- | --- | --- |
| Source | INFO `TYPEFEED`, center alignment `ALGNCNTR`, order `FORDPF1N` | ADF only |
| Sides | INFO `DPLX1SCN`, CAPA `DPLX`: both sides in one pass | Simplex/duplex already live-tested |
| Color format | CAPA `C024`, `M008`, `R008`, `G008`, `B008` | 24-bit RGB and 8-bit gray live-tested; single-channel modes unimplemented |
| Resolution X/Y | CAPA 50, 75, 100, 150, 200, 240, 300, 360, 400, 600 dpi | 200/300 dpi live-tested; other values advertised, not hardware-validated |
| Image transport | CAPA JPEG only (`JPG `) | JPEG transport; no claim of raw transport |
| JPEG quality | CAPA range 1–100 (`JPG`) | Explicit quality exposed; 90 used in the direct browser scan, other values not hardware-tested |
| Gamma mode | CAPA `UG10`, `UG18` | `UG18` used |
| Channel LUT | CAPA `GMT RED /GRN /BLU /MONO` | identity RGB tables; copied grayscale tone table |
| Color matrix | CAPA `CMX UNIT/UM08` | Generic support absent; calibrated parity unproved |
| Crop | CAPA `ADF CRP `, `CRP` range −20 to +20; cropping resolutions 300/600 (`RSMS`) | CRP+PEDT at 300 dpi returned varying page dimensions and removed fixed Letter borders; 600 dpi and nonzero margin not tested |
| Deskew | CAPA `ADF SKEW` | Enabled and accepted in the 300-dpi crop batch; correction angle/accuracy not independently validated |
| Paper-end detection | CAPA `ADF PEDT` | Enabled and accepted together with CRP in the 300-dpi crop batch |
| Overscan | CAPA `ADF OVSN`; INFO overscan zero defaults | Not enabled/tested |
| Ultrasonic double feed | CAPA `DFL1/DFL3`; native enums 1/3 are mutually exclusive | `DFL1` used for duplex; exact physical enum meanings unresolved |
| Length double feed | CAPA `ADF LDF ` | Not implemented; **LDF is length double-feed detection, not long-paper mode** |
| Lamination | CAPA `LAM ON/OFF` | Not implemented/tested |
| Mechanical actions | CAPA `ADF EJCT`, no `LOAD` | Ordinary jobs use PARA/TRDT and finalize; no automatic LOAD |
| Automatic scan / prefed sheets | INFO `ASCN`, `PREF`, `RCVR` | Whole loaded batch captured as four images; physical remaining-sheet behavior under finite limit is still under controlled test |
| Continuous insertion mode | INFO `AFM` empty token; native legacy-AFM path checks its presence/value | Not implemented; do not equate with ordinary batch feeder scan |
| Count limit | Native `pagesToBeScanned` / `#PAG`, absent from CAPA | Explicit 2N duplex/N simplex mapping exposed; controlled one-sheet browser job produced two images and left the second sheet available for another job |

INFO reports normal area 8.5 × 15.5 inches, minimum 2 × 2 inches, and long area
maximum 8.5 × 240 inches, all encoded at 100 dpi. Native long-area accessor divides
AMAX by 100. These are protocol-reported bounds, not proof that all widths,
lengths, media, and DPI combinations can be safely scanned. The model resource
also records minimum width/height 508 and max height 60960 in its own model units.
Do not run exotic-media tests from these numbers alone.

The installed model resolution conversion table maps requested values above
400 (final sentinel 9600) to acquisition at 600. Its ESResolution hardware entry
also advertises max 4800 and reflection 600. That is **not native 4800-dpi optical
acquisition**: true CAPA acquisition tops out at 600. Higher output resolution
in Epson UI can be application processing/interpolation.

## One sheet versus a stack: count semantics

`setPagesToBeScanned:` at `0x204b4` stores an NSNumber under key `#PAG` when the
feeder is enabled. Its getter at `0x2044c` returns that same integer. The setter
alone does not reveal sheet versus side counting.

The serializer resolves this ambiguity. In `parameterDataWithDict`:

1. `0x37828` saves selector `unsignedShortValue` at stack + `0x1b8`.
2. `0x37834` saves `appendDecimal:` at + `0x1b0`.
3. `0x37840` saves `duplexEnabled` at + `0x190`; self is at + `0x188`.
4. The `#PAG` branch at `0x37ca0–0x37ce8` reads the unsigned count, calls
   `duplexEnabled`, and adds `(count & 1)` when duplex is true.
5. It appends `#PAG` then the adjusted decimal.

Thus Epson rounds odd page-image counts up to an even number for duplex. This
strongly supports **image-side count**, not physical-sheet count. To request
one physical duplex sheet, use `#PAGd002`; one simplex sheet uses `#PAGd001`.
For N duplex sheets, use 2N images. Do not double again after serializing.
Zero remains zero in the native serializer. A later live two-sheet duplex test
with `#PAGd000` captured four images and left an empty feeder, confirming loaded
batch scanning for that test. Reject out-of-range public CLI counts rather than
silently wrapping: native code masks to 16 bits and this is not a useful API.

The side-count mapping now has a live browser result: the one-sheet setting
produced two duplex images. The user clarified that paper was reloaded during
earlier trials; their earlier feeder-status observations do not establish that
a spare sheet was physically left untouched. Some ADF models prefeed the next
sheet (`PREF`); even an accepted image limit does not prove an unscanned sheet
never advances through rollers. The later controlled two-sheet trial, with the user leaving the feeder alone
between the first limited job and a second job, passed: the second sheet
remained available. See the follow-up below.

Do not emulate one-sheet control by canceling at the first front-side `pen`:
that can lose the reverse side or race the next sheet. Capture both surfaces and
end on `#lftd000`. Separate front/back stream state must reset for each subsequent
page/sheet; any open incomplete surface at termination is failure. The saved
SANE sources support `pen` = image-end and `lftd000` = job-end.

## Epson software processing and output parity gaps

Installed ES0170 flags/table references establish Epson's model-specific paths
for dropout, color enhancement, dust removal, punch-hole removal, OCR module,
PDF module, encrypted PDF, LUT/profile/gamma, clipping, descreening, and unsharp
masking. The shared UI offers the following families, with model/setting
constraints; their visibility/enabled state must be verified in the live Epson
UI before claiming each one is usable on this scanner:

- Document side/binding, size/orientation/custom size, long-size auto detection,
  crop margin, laminated paper, resolution, rotation, stitching, paper/content
  deskew, blank-page removal and sensitivity, automatic color classification.
- Text enhancement and OCR precision, dropout/color enhancement/background
  removal, brightness/contrast/threshold/gamma, sharpening/descreening, edge
  correction/fill and four edge widths, punch-hole cleanup.
- JPEG encoding/quality/ICC, TIFF compression/ICC, PDF/PDF-A, PDF page count,
  blank-page counting, compression, password/permissions, searchable PDF and
  OCR language, naming/counter/timestamp/folder/overwrite.
- Auto-feeding mode and timeout, ultrasonic/length/image double-feed choices,
  detection area, paper protection, background color, cleaning/dirty-glass alert,
  sleep/power-off, roller count/lifetime and maintenance reset.

A static shared Scanner.framework additionally contains protocol accessors for
threshold (`THR`), contrast (`CTR`), brightness (`BRT`), gamma scale (`GMS`),
blank page (`DBP`/`DBL`), color type (`DCT`), background removal (`BGR`), sharpness
(`SFL`), edge fill (`FLC`/`FLA`), and many newer-model features. The saved FF-680W
CAPA does not advertise most of these. Their mere selector/string presence does
not establish FF-680W hardware support; Epson may process images on the host.

The custom implementation does not yet reproduce all Epson settings or image
appearance. Device crop now works in the tested 300-dpi combination; calibrated
color, host filters, OCR, automatic rotation/blank-page removal and additional
file output remain gaps. Other exposed acquisition choices need their own
validation rather than inheriting a parity claim from color/duplex success.


## Custom implementation checkpoint after continuation

The CLI and local browser now expose color/gray, sides, the live CAPA acquisition
resolution list, explicit image-side count derived from physical sheets,
Letter/A4/Legal area, quality 1–100, paper skew, crop/PEDT and DFL1 enable/disable.
Hardware crop is restricted to CAPA's 300/600 dpi. The default sends PAG0 explicitly,
so a previous finite request does not accidentally carry over into a batch job.
Two-sheet 300-dpi color duplex and direct Chrome WebUSB imaging at 200/300 dpi
are hardware-tested. Chrome also read complete INFO/CAPA/RESA/STAT replies.
The generic normal plan now has empty `mechanical_actions`; normal native scans
omit manual LOAD, and the browser only sends LOAD if explicitly advertised.
The older grayscale diagnostic retains its optional LOAD sequence for compatibility.
Host processing and maintenance controls listed above remain unfinished.

### Direct browser imaging evidence

The coordinating agent performed these real WebUSB jobs on 2026-10-11; times
are local America/Vancouver. This worker independently read saved JPEG metadata
with `sips`, confirming the dimensions and RGB color space below.

| Job | Settings / observed outcome | Saved images |
| --- | --- | --- |
| 12:24:06 | Color, duplex, 200 dpi, fixed Letter, quality 90, one sheet; two RGB images, each 1696 × 2200. A later STAT reported ready. | `scans/browser-webusb/20261011-122406-817589-de1e5220a5be5a8c/001-front.jpg`, `001-back.jpg` |
| 12:29:06 | Color, duplex, 300 dpi, crop+PEDT, paper deskew enabled, DFL1, whole batch (`sheets=0`); four RGB images with varying dimensions rather than fixed Letter borders. | `scans/browser-webusb/20261011-122906-137931-ac98d95a585a1760/001-front.jpg` 1202 × 2088; `001-back.jpg` 1198 × 2088; `002-front.jpg` 1686 × 2712; `002-back.jpg` 1678 × 2712 |

The crop result validates that tested combination and visible border removal;
it does not validate every crop setting or deskew accuracy. Crop at 600 dpi,
other acquisition DPIs, A4/Legal and other JPEG quality values remain untested.


## Controlled one-sheet follow-up

At 12:37:13, after switching browser settings/scan session finalization to FIN
without the extra legacy FS Y, one-sheet color duplex 200 dpi produced exactly
two images. The user left the two-sheet feeder stack alone. At 12:37:53, after
an idle browser USB reset, the remaining sheet produced another two images.
All four are RGB1696×2200. The first job therefore left the other sheet available
in this controlled trial; this does not guarantee zero mechanical prefeed.
See the exact directories/bytes and source diagnosis in
[live validation](live-validation-2026-10-11.md) and
[repeat-job diagnosis](webusb-reset-diagnosis.md).
