# SANE epsonds lifecycle comparison

Compared the downloaded SANE backend at commit `36c87fc33d91ebd60f70a0934f2e44ffd9a818d2` with the current custom driver on 2026-10-11. This is source inspection; SANE was **not built or run against the scanner**. Paths/line numbers below refer to this checkout. Device options and color curves are covered separately.

## What already agrees

| Area | SANE evidence | Custom driver and practical meaning |
|---|---|---|
| USB transport | [epsonds-io.c:53](../references/sane-backends/backend/epsonds-io.c:53) uses USB bulk writes; [line 79](../references/sane-backends/backend/epsonds-io.c:79) bulk reads, rejecting short reads at line 90. | [usb.py:145](../src/ff680w_re/transports/usb.py:145) and [session.py:79](../src/ff680w_re/session.py:79) use equivalent bulk transfers and check the 64-byte reply and advertised body length. This supports WebUSB, rather than a serial-port API. |
| Scan lifecycle | [epsonds.c:2929](../references/sane-backends/backend/epsonds.c:2929) checks feeder status; [line 3331](../references/sane-backends/backend/epsonds.c:3331) sends PARA then TRDT. | [scan.py:79](../src/ff680w_re/scan.py:79) and [app.js:29](../src/ff680w_re/web/app.js:29) follow this sequence. The custom LOAD-before-PARA behavior was an unsupported inference; see the correction below. |
| Duplex | [epsonds.c:3412](../references/sane-backends/backend/epsonds.c:3412) keeps separate front/back JPEG buffers and waits for both page endings at line 3463. | [scan.py:91](../src/ff680w_re/scan.py:91) and [protocol.js:68](../src/ff680w_re/web/protocol.js:68) route IMGA/IMGB into separate side buffers, number each side independently, and reject incomplete pairs. |
| Batch continuation | [epsonds.c:2885](../references/sane-backends/backend/epsonds.c:2885) reuses an existing acquisition for subsequent sides/pages; [epsonds-cmd.c:1042](../references/sane-backends/backend/epsonds-cmd.c:1042) interprets lftd000 as job end. | Our IMG loop continues until lftd000. SANE's `pages` counter advances **delivered images**, including duplex backs; it is not proof of a physical one-sheet stop. No PAG command appears in this epsonds source. Our explicit PAG count and later controlled one-sheet trial are separate from SANE's delivered-image counter. |

## Useful differences and remaining fixes

1. **Python cleanup gap found and corrected during this review.** The compared
version sent CAN even if STAT failed before TRDT and suppressed FIN errors.
`run_jpeg_scan` now tracks a TRDT attempt, only cancels an unfinished acquisition,
still attempts FIN after cancel failure, preserves the primary error and reports
cleanup context. FIN exceptions or ERR tokens prevent an otherwise complete job
from being reported as success. Completed JPEGs remain saved. Regression tests
cover these paths; the browser already used an acquisition guard.

2. **Bound Python's advertised image-block size.** [epsonds-cmd.c:1110](../references/sane-backends/backend/epsonds-cmd.c:1110) rejects bodies above the allocated transfer buffer (4 MiB at [epsonds.c:2914](../references/sane-backends/backend/epsonds.c:2914)). [session.py:88](../src/ff680w_re/session.py:88) trusts the header's length before reading. The browser has a 16 MiB sanity bound at [protocol.js:17](../src/ff680w_re/web/protocol.js:17). A bound tied to the requested BSZ would catch corrupted framing earlier. Per-image accumulation also needs a size ceiling if pen never arrives.

3. **Late Python sheet-limit checking was corrected.** The compared version
checked the limit after the entire job ended. It now checks each completed side
immediately, saves the received image, stops further IMG reads on excess and
cancels the unfinished acquisition. The browser also rejects an excess side
immediately. Neither host check proves the mechanism has not advanced another
sheet. That guarantee still requires the accepted PAG parameter and a physical
test with spare originals loaded.

4. **JPEG passthrough is a smaller feature set than SANE's raster output.** [epsonds-jpeg.c:129](../references/sane-backends/backend/epsonds-jpeg.c:129) actually decodes JPEG, writes raster scanlines, supports host grayscale-to-1-bit conversion at line 154, uses reported page height at line 185, and pads a fixed acquisition area white when cropping is off at line 213. Its [ring reader:337](../references/sane-backends/backend/epsonds-ops.c:337) serves complete raster lines, removes dummy bytes, and handles line-art bit polarity. Ours saves compressed JPEG and checks SOI/EOI only ([scan.py:101](../src/ff680w_re/scan.py:101), [protocol.js:89](../src/ff680w_re/web/protocol.js:89)). A successful decode/dimension check and explicit host transforms would improve validation and settings parity. Copying SANE's ring is unnecessary for JPEG passthrough. SANE also allocates full compressed and decoded page-pair buffers; it is not a zero-memory streaming design. Our completed Python images are saved immediately and buffers cleared at [scan.py:107](../src/ff680w_re/scan.py:107).

5. **Retain our terminal-block ordering.** SANE drains advertised bytes even when header parsing reports EOF/error ([epsonds-cmd.c:1113](../references/sane-backends/backend/epsonds-cmd.c:1113)), but returns before assigning `*length` when parsing returns EOF at line 1127. Our session also drains data; then the batch appends terminal bytes before handling pen/lft. A terminal block containing both JPEG bytes and pen would therefore behave differently. This is a source-derived edge case, not an observed SANE failure on this FF-680W.

6. **A reused native session may need reset after cancel.** Current SANE [sane_cancel:3694](../references/sane-backends/backend/epsonds.c:3694) explicitly FIN/relocks/RESA to avoid false NO_DOCS on a later ADF job (comment names ES-60W). Our browser releases and reacquires a lock between jobs; CLI closes the transport. Use this as a diagnostic lead if a later job reports false empty-feeder, not as proof FF-680W needs the same workaround.

## FF-680W crop patch status in this checkout

The downloaded master still resets crop when geometry changes ([epsonds.c:2397](../references/sane-backends/backend/epsonds.c:2397)), only logs ADFPEDT capability ([epsonds-cmd.c:662](../references/sane-backends/backend/epsonds-cmd.c:662)), and sends CRP without PEDT ([epsonds.c:2937](../references/sane-backends/backend/epsonds.c:2937)). The model-tested changes proposed in [SANE MR !919](https://gitlab.com/sane-project/backends/-/merge_requests/919) are consequently **absent from this master commit**. The MR reference was fetched separately as `origin/mr919` at `4f2255e3b73e8afe2a0f8e6d7426f3a56789276c`; the working checkout remains master. Our [profiles.py:167](../src/ff680w_re/profiles.py:167) already combines CRP and PEDT. This establishes patch absence in the inspected code, not an independent claim about GitLab's current merge status.


## Follow-up verification

The cleanup and immediate-limit corrections passed regression tests after source
review, with a subsequent no-automatic-LOAD regression passing as well. These
tests do not substitute for a real SANE scan or the controlled physical stop test.
No scanner session or color profile was changed by this comparison worker.

Direct browser imaging is now verified independently of the SANE source review.
On 2026-10-11 at 12:24:06 America/Vancouver, the coordinating agent's color,
duplex, 200-dpi fixed-Letter job with quality 90 and one-sheet setting returned
two RGB JPEGs, each 1696 × 2200, in
`scans/browser-webusb/20261011-122406-817589-de1e5220a5be5a8c/`.
The later status was ready. At 12:29:06, a 300-dpi color/duplex whole-batch job
using crop+PEDT, paper deskew and DFL1 returned four RGB images in
`scans/browser-webusb/20261011-122906-137931-ac98d95a585a1760/`: front/back
dimensions were 1202 × 2088 / 1198 × 2088 for sheet 1 and 1686 × 2712 /
1678 × 2712 for sheet 2. This worker read the saved files with `sips` to confirm
dimensions and RGB color space. The varying sizes and coordinating agent's
inspection establish crop border removal for that combination; deskew was
accepted, but its correction angle was not independently validated. Crop at
600 dpi and other acquisition DPIs remain untested.

These jobs establish browser acquisition and the returned image counts. The
user clarified that paper was reloaded during earlier tests, so those tests do
not establish that the spare physical sheet remained untouched. The later controlled
two-sheet trial passed: one limited job with the feeder left alone,
then a browser session reset and a second job for the remaining original.
The first job left the second sheet available; roller prefeed is not excluded.


## Correction from subsequent LOAD investigation

The earlier custom mechanical sequence inferred `#ADFLOAD` merely because `ESDocumentMode` is truthy ([vendor_data.py:320](../src/ff680w_re/vendor_data.py:320)), and the gray diagnostic plan inherited it ([profiles.py:227](../src/ff680w_re/profiles.py:227)). The vendored model data at [vendor_data.py:67](../src/ff680w_re/vendor_data.py:67) identifies document mode; it does not identify LOAD support. The original extracted plist is absent from its recorded `/tmp` source path, but the installed model plist was parsed separately and its complete resource snapshot and digest are retained in `rea-evidence/settings-resource-inventory.json`.

SANE has **no MECH call in sane_start**. Its only LOAD invocation is an explicit option button ([epsonds.c:2442](../references/sane-backends/backend/epsonds.c:2442)). The option is inactive unless `adf_has_load` is set ([epsonds.c:2062](../references/sane-backends/backend/epsonds.c:2062)); that flag comes specifically from `#ADFLOAD` in CAPA ([epsonds-cmd.c:666](../references/sane-backends/backend/epsonds-cmd.c:666)). Inactive options are rejected by the setter at [epsonds.c:2353](../references/sane-backends/backend/epsonds.c:2353).

Our captured device CAPA lists DPLX, PEDT, DFL1/DFL3, LDF, EJCT, CRP, SKEW, OVSN and RSMS but **no LOAD** ([usb-capabilities.txt:4](../docs/rea-evidence/usb-capabilities.txt:4)). Thus automatically issuing LOAD on this FF-680W is not supported by the reported capability set. The coordinating agent's live observation of MECH returning UNKN on a later job agrees with this source/capture diagnosis. Earlier success in a particular scanner state does not establish general LOAD support.

The current ordinary JPEG plan explicitly clears `mechanical_actions` at
[profiles.py:170](../src/ff680w_re/profiles.py:170),
and `run_jpeg_scan` omits LOAD at
[scan.py:83](../src/ff680w_re/scan.py:83).
The browser reads CAPA and gates its optional LOAD on the advertised ADF token at
[app.js:72](../src/ff680w_re/web/app.js:72).
The explicit older grayscale diagnostic retains its optional mechanical sequence;
it is separate from ordinary acquisition. Browser imaging success described above
must not be attributed to SANE, which was not run on this scanner during review.


## Live browser lifecycle correction and controlled stop

The browser's settings query originally ended with FS Y, and scan cleanup sent
FS Y after FIN. SANE has no FS Y callsite and FIN itself releases its session
lock. Switching settings-read and scan cleanup to FIN-only allowed PARA and a
one-sheet duplex job to succeed at12:37:13 without a native reset since12:29.
A second one-sheet job at12:37:53 captured the remaining sheet after an idle
WebUSB reset, with no user reload between these controlled jobs. See
[repeat-job diagnosis](webusb-reset-diagnosis.md) and
[live validation](live-validation-2026-10-11.md). This is browser acquisition
evidence; the legacy diagnostic probe was not rewritten to match this lifecycle.
