# FF-680W live validation — October 11, 2026

The scanner was connected by USB to this Apple Silicon Mac. No firmware,
scanner administrator-password, or persistent network settings were changed.

## Setup repaired

The workspace had moved from Downloads to Desktop. Its virtual environment
launcher and editable package import still pointed to the old location. The old
`.venv` was preserved as `.venv-before-desktop-repair`; a new local environment
was installed with the project's USB and network dependencies.

The first custom USB query failed with access denied. IORegistry identified
Epson Scanner Monitor as the exclusive owner of scanner interface 0. Quitting
that process allowed INFO, STAT, CAPA, and RESA to work.

REA 6.4.0 was registered for Codex with its bundled skill. Setup preserved unrelated
configuration and created `~/.codex/config.toml.rea.backup`.
CLI native metadata inspection worked. A Codex restart is needed to load the new
MCP registration. No Hopper/Ghidra installation was needed for this task; native
assembly findings in the investigation are labeled as ordinary shell-tool
observations, separately from REA metadata Evidence.

## Hardware outcomes

1. The existing grayscale probe, run with a 100 ms delay, captured one readable
   JPEG: `scans/custom-driver/first-probe.jpg`, 941,021 bytes, 2544 × 3300 pixels.
2. Epson ScanSmart initially displayed E581-A2017 after switching from the custom
   driver. Quitting ScanSmart, resetting USB, and relaunching Epson Scanner Monitor
   restored connectivity. ScanSmart captured both sides in Color at 200 dpi,
   with Skip Blank Pages Off and Include Back Sides On. The saved two-page PDF is
   `local-scans/epson-software/epson-color-duplex-2026-10-11.pdf`.
   Both pages were verified as 8-bit RGB and rendered/read visually.
3. The new custom command `ff680w usb scan --mode color --duplex` captured:
   - `scans/custom-color-duplex/001-front.jpg`: 1,497,047 bytes.
   - `scans/custom-color-duplex/001-back.jpg`: 1,533,591 bytes.
   Both decode as 2544 × 3300, three-channel RGB JPEGs. Visual inspection confirmed
   distinct front/back content and color. Raw custom outputs retain the original
   orientation and fixed letter-size acquisition area.

Those first tests used the same single sheet, reloaded by the user. The continuation
below adds two-sheet batching and browser connection tests. Calibrated color
accuracy and Wi-Fi image acquisition remain unvalidated.

## Implementation and verification

The new color/gray scan command selects duplex DFL1, uses RGB identity LUTs for
color, routes IMGA/IMGB independently, drains image bytes before processing page
end, and waits for lftd000 before job success. It checks parameter acceptance,
matching duplex image counts, JPEG boundary markers, deadline and destination
writability. Failed jobs cancel; all jobs finalize. Files use a new directory and
numbered sheet/side names.

All 65 unit tests passed after the final source changes. Added cases cover
interleaved duplex data, data attached to a page-end header, nonzero remaining
page count, missing backs, rejected parameters, timeout/cancel/finalize,
incomplete JPEG boundaries, preserving existing output, invalid destinations,
and binary RGB LUT values. JPEG boundary checks alone do not decode or certify
an arbitrary stream; the live files were decoded separately with macOS sips and
viewed.

At completion, the custom USB session was closed, the device reset successfully,
and Epson Scanner Monitor relaunched for normal Epson-software use. ScanSmart
is closed. Quit the monitor again before using the custom USB driver.


## Continuation: settings, batch and browser work

The user loaded two ordinary sheets. A USB reset after closing Epson applications
allowed this job:

```sh
.venv/bin/ff680w usb scan --mode color --duplex --sheets 0 --output-dir scans/two-sheet-batch
```

It consumed both sheets and produced four RGB JPEGs, decoded with macOS sips:

| File | Bytes | Pixels |
| --- | ---: | --- |
| 001-front.jpg | 1,577,047 | 2544 × 3300 |
| 001-back.jpg | 1,440,087 | 2544 × 3300 |
| 002-front.jpg | 657,143 | 2544 × 3300 |
| 002-back.jpg | 925,943 | 2544 × 3300 |

A subsequent STAT reported `ERR=ADF PE` (empty feeder). Thus explicit `#PAGd000`
was observed to scan all sheets in this loaded two-sheet batch. The user was asked
to reload both sheets for a limited job; the later browser test below validated the limited image count. Controlled
physical prefeed behavior is tested separately from the earlier user reloads. Native serializer evidence supports counting
image sides: one duplex sheet requests `#PAGd002`.

New CLI options expose the actual CAPA acquisition-resolution list, sheet limits,
Letter/A4/Legal geometry, JPEG quality, paper deskew, crop/PEDT and double-feed
selection. CAPA's cropping-resolution list is 300/600, so lower-DPI hardware crop
requests are rejected before USB/feeding. This does not establish full Epson
processing parity. The observed ScanSmart settings are recorded in
`settings-inventory.md`.

A local WebUSB UI was implemented. Chrome successfully selected the real FF-680W,
claimed interface 0 (bulk IN 2, OUT 1), and read INFO/CAPA/RESA/STAT directly from
JavaScript. Python only builds scan parameter payloads and saves completed image
files through a loopback HTTP service; it performs no USB transfer for this UI.
Browser image acquisition was later validated with loaded media, as detailed below. The empty-feeder preflight
correctly detected uppercase ERR before feeding; its unnecessary pre-job CAN
cleanup was corrected and retested live: the UI reports `Scanner status: ERR=ADF PE`
without a cleanup warning. A subsequent settings read also succeeds.

Completed Python and browser images are saved as each image ends, preserving
prior pages if a later sheet jams or times out. Failed jobs still report failure.
A matching `pen` ends an image, while `lftd000` ends the full job. Tests exercise
multi-sheet duplex interleaving, side-count limits, partial failures and cleanup.
The local file service checks Host/Origin/per-launch token, input types and size,
rejects traversal/symlinks, and atomically publishes files without overwriting
existing images. These tests are separate from actual scanner validation.

At this checkpoint, 98 Python tests and 13 Node protocol/app integration tests pass. The browser
server is running on 127.0.0.1:8765; Epson Scanner Monitor is stopped. Browser
access must be disconnected before CLI or Epson software can own the USB device.


The open browser UI is prepared for color/duplex200dpi, Letter, quality90,
DFL1on, crop/deskewoff and max_sheets1. This matches the basic Epson color,
sides and200dpi settings, while explicitly retaining fixed area and bypassing
Epson's rotation/blank-page/image-processing steps. The later loaded-media results below supersede this prepared-job checkpoint.


## Direct WebUSB image acquisition

At 12:24:06 the browser requested color, duplex, 200 dpi, Letter, quality 90,
one physical sheet, crop/deskew off and DFL1 on. It reached lftd000 and saved
exactly one front/back pair under
`scans/browser-webusb/20261011-122406-817589-de1e5220a5be5a8c`:

| File | Bytes | Pixels |
| --- | ---: | --- |
| 001-front.jpg | 699,762 | 1696 × 2200 |
| 001-back.jpg | 611,090 | 1696 × 2200 |

The files decode as RGB JPEGs using macOS sips. The device's subsequent RESA
reported PAGd002 and 200 dpi; STAT reported no ERR. This validates the finite
image-side request, without establishing the physical position of another sheet.

At 12:29:06, color duplex 300 dpi, Letter, quality 90, unlimited sheets, crop/PEDT,
paper deskew and DFL1 enabled completed with two front/back pairs under
`scans/browser-webusb/20261011-122906-137931-ac98d95a585a1760`:

| File | Bytes | Pixels |
| --- | ---: | --- |
| 001-front.jpg | 320,445 | 1202 × 2088 |
| 001-back.jpg | 580,608 | 1198 × 2088 |
| 002-front.jpg | 1,298,424 | 1686 × 2712 |
| 002-back.jpg | 1,151,454 | 1678 × 2712 |

All four decode as RGB JPEGs. Visual inspection confirmed that cropping removed
large fixed-area borders. Paper deskew was enabled and accepted; this is not a
quantitative skew-correction accuracy test. Orientation remains as inserted.
The user confirmed reloading paper during these earlier jobs, explaining why
one document appears in both jobs. They are not a controlled physical stop test.
Screenshot: `webusb-cropped-batch.png`.

Later jobs sometimes returned MECH/UNKN, then PARA/UNKN after unsupported LOAD
was omitted. A native USB reset restored acquisition. SANE's startup does not
send LOAD, and this FF-680W CAPA does not advertise it. Normal Python jobs now
omit LOAD; the browser gates it on CAPA. The legacy explicit diagnostic probe
retains its earlier sequence. The browser now offers an idle-only Reset USB
session control that releases, resets, reopens and rereads the scanner, without
retrying a capture automatically.


## Controlled two-sheet limit and repeat job

After the earlier user reloads, two sheets were loaded specifically for this
trial and the user was instructed to leave the feeder alone. Browser reset plus
settings reads still left a PARA/UNKN rejection at 12:35:35, before TRDT/feeding.
SANE source then revealed that FIN ends the session and releases the lock; the
backend does not send FS Y. The browser was corrected to use FIN after settings
reads and after jobs, removing its extra FS Y commands.

No native reset occurred between the earlier 12:29 scan and these results:

| Job directory under scans/browser-webusb | Outcome | Front/back bytes |
| --- | --- | --- |
| 20261011-123713-898756-b8ab5c68cc8c13be | One sheet, two images, lftd000 | 704,690 / 608,914 |
| 20261011-123753-567727-cddf41eafc388baa | Remaining sheet, two images, lftd000 | 247,282 / 372,914 |

Both jobs used color, duplex, 200 dpi, Letter, quality 90, one-sheet limit, DFL1,
no crop or deskew. All four JPEGs decode as RGB 1696 × 2200. An idle WebUSB reset
was performed between the jobs and successfully reopened/read the device. The
second document was captured without another user reload. Thus the first job
stopped after one sheet and left the other available for another job in this
stack. This does not establish that another sheet was never touched by prefeed
rollers. Screenshots are `webusb-controlled-one-sheet.png` and
`webusb-controlled-second-sheet.png`.

A subsequent direct settings read succeeded; STAT was an empty token list, so
no empty-feeder error is inferred from that response. The FIN-only correction
has direct acquisition evidence. Chrome's weaker macOS reset implementation is
a separate source-derived finding, described in `webusb-reset-diagnosis.md`.
The browser remains connected with Epson Scanner Monitor stopped. Disconnect
before using another scanner application.

Final validation: 104 Python tests and 25 JavaScript tests pass. Coverage includes protocol,
image routing, pairing reuse, CAPA-gated LOAD, FIN-only session finalization,
reset/reopen failure cleanup, and reset exclusion during capture.
