# FF-680W settings and prior implementations

Research checked October 11, 2026. This is a source-backed comparison checklist,
not a claim that every setting below is implemented in the custom driver.

## Existing implementations

- [SANE's supported-device table](https://sane-project.gitlab.io/website/sane-backends.html)
  lists the FF-680W USB ID `04b8:016b` as Complete under `epsonds`.
  The [epsonds manual](https://www.sane-project.org/man/sane-epsonds.5.html)
  documents color/grayscale/lineart, geometry, ADF simplex/duplex and eject.
  Its manual is older than the current code, so use live `scanimage --help`
  against the detected device for the actual option inventory.
- [SANE merge request !919](https://gitlab.com/sane-project/backends/-/merge_requests/919)
  contains a May 2026 FF-680W USB test on Raspberry Pi/Debian. It reports
  that automatic cropping needed both preserving `adf-crp` during geometry
  negotiation and adding `PEDT` when `ADFPEDT` is advertised. The tested
  parameter prefix was `#ADFDPLXSKEWCRP PEDT`. This is implementation evidence,
  not confirmation that the patch is in a particular installed SANE release.
- [Utsushi](https://gitlab.com/utsushi/utsushi) provides an Epson-native driver,
  SANE compatibility and command-line acquisition. Its indexed README lists
  FF-680W support; no local test was performed. Its network route historically
  requires the separate non-free `networkscan` plugin.
- [VueScan's model page](https://www.hamrick.com/vuescan/epson_ff_680w.html)
  explicitly describes its reverse-engineered FF-680W driver, macOS/Linux/
  Windows support and USB/network connections. It says macOS/Linux do not
  require another scanner package. This is a commercial alternative; it has
  not been tested on this Mac in this research task.
- [epson2paperless](https://github.com/mtheuma/epson2paperless) is an independent
  MIT Node.js implementation. Its FF-680W entry is experimental, with 200/300
  dpi verified and button-triggered scanning requiring host pairing. Its
  generic HTTP/host trigger is **expected to fail on FF-680W**, because it
  omits preparation normally initiated by the button. Do not treat its HTTP
  endpoint as proven browser control for this model.

## Protocol details useful for extending this driver

[epson2paperless's protocol reference](https://github.com/mtheuma/epson2paperless/blob/main/docs/PROTOCOL-REFERENCE.md)
has FF-680W plain-TCP port 1865 captures, startup/polling sequences, automatic
crop parameter layouts, gamma/CMX data and duplex stream handling. Its FF-680W
color PARA sizes are 996 bytes simplex and 1000 bytes duplex. It distinguishes
front/back using `typIMGA`/`typIMGB`. Its resolution analysis warns that
`ADFRSMSLIST` values 300/600 do not exclude every other DPI: an Epson FF-680W
200-dpi capture exists. Source-specific lists need interpretation alongside
global resolution lists, and output DPI can involve host resampling.

The [button-only scanner pairing note](https://github.com/mtheuma/epson2paperless/blob/main/docs/BUTTON-ONLY-SCANNERS.md)
explains the scanner's stored paired host name and SNMP OID
`1.3.6.1.4.1.1248.1.1.3.1.10.2.5.0`. Read the existing value before any future
pairing change. No pairing change was made for this research.

## Settings to compare

### Document capture

The [FF-680W international manual](https://download4.epson.biz/sec_pubs/epson_ff-680w/useg/en/manual.pdf)
documents ScanSmart opening Epson Scan 2 scan settings. Main settings include
ADF, automatic feeding, scan side, document size/auto detect, image type,
resolution, image stitching, rotation, skew correction, skipping blank pages,
and double-feed detection. Automatic Feeding Mode starts when an original is
inserted and lets the user add originals until Finish or the scanner stop
button ends the waiting mode. This does not imply a loaded stack is limited
to one sheet. A PDF page grouping setting also should not be confused with
a hardware feeder limit.

[Epson's generic Scan 2 manual](https://download.ebz.epson.net/man/linux/epsonscan2_e.html)
documents advanced controls such as brightness, contrast, gamma, threshold,
text enhancement, dropout/color enhancement, descreening, unsharp mask and
edge fill. Availability depends on model and other settings; this Linux
manual is a comparison checklist, not proof of every control on this Mac.
It also distinguishes PDF page grouping, compression/quality and file naming
from acquisition. Linux's `epsonscan2 --scan` and SF2 setting files are another
automation reference, not a confirmed macOS command-line interface.

### Photo workflow

[Epson's FF-680W FastFoto preferences](https://files.support.epson.com/docid/cpd5/cpd55191/source/scanners/source/scanning_software/reference/available_settings_fastfoto2_ff680w.html)
cover photo type, 300/600/1200-dpi output, save format, detecting writing on
backs with sensitivity, auto rotation, curled-photo correction, line/streak
reduction, auto brightness/contrast/saturation enhancement, red-eye reduction,
faded-color restoration, and keeping original plus enhanced copies. Organization
settings include folder, subject/date batch names, subfolders and Mac Photos
integration. Device settings open Scan 2 Utility. These are partly application
processing/workflow features; a CAPA query alone cannot establish parity.

### Device/maintenance settings

[Epson's Scan 2 Utility overview](https://www.epson.ie/en_IE/faq/KA-01833)
uses FF-680W screenshots but explicitly warns that options vary by model.
Its inventory includes serial/firmware, scan/error/roller counters and alerts,
sleep/power-off settings, image/feed-position adjustments, glass dirt detection,
paper protection and double-feed stop timing. Treat these as items to verify
in the installed utility before advertising support. Reading counters and
setting job parameters are different operations from resetting maintenance
counters or changing persistent device configuration.

## Sheet limits and feeder behavior

[Epson's FF-680W specifications](https://files.support.epson.com/docid/cpd5/cpd55191/source/scanners/source/specifications/references/ff680w/spex_general_scanner_ff680w.html)
confirm a one-pass duplex color sheet-feed scanner, 600-dpi
optical resolution, 24-bit external color, 8-bit gray and 1-bit monochrome.
1200-dpi output should not be presented as 1200-dpi optical capture.

[The FastFoto scan workflow](https://files.support.epson.com/docid/cpd5/cpd55191/source/scanners/source/scanning_software/tasks/scanning_fastfoto.html)
describes scanning the loaded photos and prompting for more: a normal batch
workflow consumes the loaded stack. A custom single-sheet stop requires an
explicit device job limit or a separately validated stop sequence; this
research did not verify it mechanically.

[The photo capacity table](https://files.support.epson.com/docid/cpd5/cpd55191/source/scanners/source/placing_originals/reference/ff680w/photo_spex_input_ff680w.html)
allows up to 36 small photos depending on thickness, ten 8×10 photos, and one
carrier-sheet or Polaroid photo. [The document capacity table](https://files.support.epson.com/docid/cpd5/cpd55191/source/scanners/source/placing_originals/reference/ff680w/document_spex_input_ff680w.html)
varies by paper weight (80 sheets at 80 g/m² in that table), while the general
specification page says 100 at 80 g/m². Two ordinary sheets are comfortably
within either source; avoid making one unconditional stack-capacity promise.

## Practical next work

Prioritize a visible capability/settings inventory, a device-side sheet count,
full-feeder capture, page/side accounting, and cancellation that preserves
already saved images. Next add auto size/crop and quality/DPI choices, then
host-side PDF assembly, blank-side detection, orientation and OCR. Photo
restoration, conditional back saving, maintenance controls, button integration
and network scanning require their own comparisons and validation.
