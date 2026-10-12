# scaner · Scan Studio

[Open the web app](https://projects.ahmadjalil.com/scaner/) ·
[Web deployment workflow](https://github.com/ahzs645/scaner/actions/workflows/pages.yml)

Scan Studio captures scans directly in desktop Chrome or Edge through WebUSB.
The website is static: the driver, page processing, local saved jobs, exports,
OCR orientation and ICC color processing run on your computer. There is no
scanner backend or document upload service.

The current device profile supports the Epson FF-680W. Color and grayscale,
front/back scanning, batch and one-sheet limits, advertised acquisition DPI,
manual rotation, automatic crop/deskew and optional upright text detection are
implemented. Calibration tools support imported ICC profiles and target-based
profiles; matching Epson's color output still needs measured physical validation.

Use **Connect scanner**, grant USB access, and load the feeder. Quit other Epson
scanner applications and Epson Scanner Monitor first: only one application can
own the USB interface. WebUSB requires a compatible desktop browser and a user
device permission. Network discovery and TCP scanning are available through the
optional Electron app, because an ordinary website cannot use raw scanner TCP or
Bonjour discovery. The separately packaged macOS app still needs its local
network permission/connectivity issue resolved; development Electron scanning
has been verified.

Saved scans belong to the current browser and website origin. Jobs from the
localhost development app do not automatically move to GitHub Pages. Export
anything you need to retain before clearing browser storage.

## Develop

Requires Node.js 26 and npm.

```sh
git clone https://github.com/ahzs645/scaner.git
cd scaner/web-app
npm ci --ignore-scripts
npm run dev
```

Open `http://127.0.0.1:8765/`. Run `npm test` for browser driver and processing
checks. See [browser documentation](web-app/README.md) for settings and limitations.

The [Electron source and local build instructions](web-app/desktop/README.md)
and [Python driver](pyproject.toml) are retained in this repository. To install
the Python CLI from the repo root:

```sh
python3 -m venv .venv
.venv/bin/pip install -e '.[network]'
.venv/bin/ff680w --help
```

## GitHub Pages

Pushes to `main` run [`.github/workflows/pages.yml`](.github/workflows/pages.yml).
The workflow installs pinned npm dependencies with lifecycle scripts disabled,
checks TypeScript and browser tests, builds local OCR/color WASM assets, and
publishes only `web-app/dist`. It never launches Electron, builds a desktop
package, or publishes desktop binaries. You can also run it manually in Actions.

The website and its assets use relative URLs, including under `/scaner/`.
Pages must use **GitHub Actions** as its deployment source. See
[deployment details](docs/github-pages.md).

## Repository contents

| Path | Contents |
| --- | --- |
| `web-app/src` | Browser UI, modular drivers, local storage and image pipeline |
| `web-app/desktop` | Optional Electron runtime, network transport and native launcher source |
| `web-app/scripts`, `web-app/tests` | Build tools and browser/desktop validation inputs |
| `src/ff680w_re`, `tests` | Python driver, CLI and tests |
| `docs` | Research and dated hardware validation notes |
| `references/sources.json` | Upstream research sources and inspected commits |

Private scans, document screenshots, raw device dumps, vendor installers,
downloaded reference checkouts, dependencies and generated desktop packages
remain local and are excluded by `.gitignore`.

The browser app is GPL-2.0-only; see [COPYING](web-app/COPYING) and
[NOTICE](web-app/NOTICE) for the SANE table attribution and bundled dependencies.

## Earlier workspace notes

The notes below preserve the original USB investigation. They describe successive
versions; consult the app and documents above for current functionality.

### FF-680W reverse engineering workspace

This project provides a custom USB scanning path for the Epson `FF-680W`.

## Verified on this Mac, October 11, 2026

- USB identity, status, capabilities, and settings queries work.
- Grayscale, single-sided JPEG capture works at 300 dpi.
- Color, double-sided capture works at 300 dpi, with separate front/back JPEGs.
- A two-sheet color duplex batch produced four readable 2544 × 3300 RGB images.
- Chrome read INFO, CAPA, RESA and STAT and scanned directly through WebUSB.
  A limited color duplex job at 200 dpi saved one front/back pair; a cropped
  300 dpi batch saved four images with document-sized boundaries.
- Epson ScanSmart also produced a two-page color PDF at 200 dpi. See
  [the Epson workflow](docs/epson-software.md).
- [REA investigation](docs/rea-investigation.md) records the static driver
  evidence for lifecycle, idle polling, and front/back image routing.

The custom path now exposes color/gray, duplex, the advertised 50–600 dpi
acquisition choices, sheet limit, Letter/A4/Legal acquisition area, JPEG quality,
paper deskew, automatic crop/paper-end detection, and double-feed detection.
Hardware crop is limited to the device's advertised 300/600 dpi choices. Exposing
a control does not validate every combination; see [live results](docs/live-validation-2026-10-11.md).

[Settings inventory](docs/settings-inventory.md) covers device capabilities,
installed Epson resources and visible ScanSmart settings. [Research](docs/research-settings-links.md)
and [browser research](docs/browser-usb-research.md) record existing independent
implementations. The [downloaded SANE comparison](docs/sane-comparison.md) covers
current source, color tables, settings, crop-patch status and scan lifecycle. Full Epson image processing, calibrated color, OCR, PDF/TIFF
export, maintenance controls, and Wi-Fi acquisition remain unfinished.

## Scan with the custom driver

Use one scanner application at a time. Quit ScanSmart, FastFoto, and Image
Capture. In Activity Monitor, quit **Epson Scanner Monitor** before using the
custom driver: it holds the USB interface even when Epson's main apps are closed.
Load your document, then run:

```bash
cd scaner
.venv/bin/ff680w usb scan --mode color --duplex
```

Output goes into a new timestamped directory under `scans/`, with names such as
`001-front.jpg` and `001-back.jpg`. Omit `--duplex` for one side; use `--mode gray`
for grayscale. `--sheets 0` scans the loaded batch (default); `--sheets 1`
requests one physical sheet, encoded as two images for duplex. A controlled two-sheet browser test scanned one sheet, then scanned the
remaining sheet in a second job. This establishes the limit for that stack;
it does not prove the rollers never prefeed another sheet. Additional examples:

```bash
.venv/bin/ff680w usb scan --mode color --duplex --dpi 200 --sheets 1
.venv/bin/ff680w usb scan --duplex --dpi 300 --auto-crop --deskew
.venv/bin/ff680w usb settings > scanner-settings.json
```

Use `--paper a4` or `--paper legal`, `--quality 1` through `100`, and
`--no-double-feed` when deliberately disabling detection for suitable media.
Automatic Feeding Mode (waiting for later insertions) is a separate Epson
feature, not implemented by these batch options.

For an explicit location, supply `--output-dir /path/to/new-folder`.
The destination must be new. The driver checks output writability before feeding
paper and reports failed, incomplete, or timed-out jobs instead of empty success.

To return to Epson's software after the custom command has finished:

```bash
.venv/bin/ff680w usb reset
open "/Library/Application Support/EPSON/Scanner/ScannerMonitor/Epson Scanner Monitor.app"
open "/Applications/Epson Software/Epson ScanSmart.app"
```

The reset and monitor restart resolved ScanSmart's `E581-A2017` connection error
during the live test. A reset interrupts device sessions, so run it only after
the current scan and application are closed.

## Browser-only app (preferred browser path)

```bash
cd scaner/web-app
npm ci --ignore-scripts
npm run dev
```

Open **http://127.0.0.1:8765/** in Chrome or Edge. Node serves static files only;
USB, parameters, saved jobs and ZIP export run in the browser. Deploy
`web-app/dist/` on HTTPS static hosting to use it without a local Node/Python
installation. Close other scanner apps and stop the older Python browser server
if it uses this port. Disconnect before changing scanner applications.

A real 200 dpi color duplex one-sheet job saved two RGB JPEGs, survived reload
and exported a verified ZIP. The modular driver framework and local crop/rotation/automatic text orientation
pipeline are implemented. The strict build and 135 tests pass. See
[framework and processing details](docs/modular-driver-processing.md). See
[app instructions](web-app/README.md), [live validation](docs/browser-only-validation-2026-10-11.md)
and [SANE/WASM options](docs/backend-free-sane-options.md). Browser storage is
profile/origin specific and can be cleared; download permanent copies.

## Electron and LAN discovery

The optional [desktop app](web-app/desktop/README.md) reuses the browser interface
and provides bounded Bonjour discovery plus FF-680W network settings reads.
Live INFO/CAPA/RESA/STAT over TCP 1865 now succeed, with correct session
initialization and cleanup. The ordinary browser website remains USB-only;
Chrome Local Network Access does not provide raw TCP or Bonjour browsing.
Actual network image acquisition remains a separate validation step.
See [network driver design](docs/network-driver-design.md) and
[browser network feasibility](docs/network-browser-feasibility.md).

## Earlier Python-assisted browser UI

```bash
cd scaner
.venv/bin/python -m ff680w_re.browser
```

Open **http://127.0.0.1:8765/** in Chrome or Edge. Quit Epson Scanner Monitor and
other scanner applications first. Click **Connect scanner** and select FF-680W.
**Read device settings** shows identity, capabilities, current parameters, and
feeder status. Set capture controls, then click **Scan loaded sheets**.

The browser itself performs USB bulk transfers using WebUSB; this is not a USB
serial device. The loopback-only Python service builds parameter payloads and
saves JPEGs under `scans/browser-webusb/`. It does not perform USB I/O or send
scans to an external service. Complete images get previews and download links.
**Stop after current transfer** preserves complete images; it is not a guaranteed
mechanical one-sheet stop because the feeder can prefeed another original.
Settings reads and scans now end their ESC/I-2 sessions with FIN, following SANE.
This corrected repeat-job parameter rejection in live testing. **Reset USB session**
is available while idle and was tested between two successful jobs. It does not
automatically retry a scan. If Chrome reset cannot restore acquisition on macOS,
disconnect and use the native reset command above. Completed files remain saved. Disconnect before switching to the CLI or Epson software.

The development server must stay running while the UI is used. Restarting it
requires reloading the browser page because its per-launch file-service token
changes. This is an experimental local tool, not a production scanner product.

## Earlier scaffold and research notes

Current scope:

- USB transport using `pyusb`
- ESC/I-2 protocol helpers based on public SANE behavior
- Session layer for `INFO`, `CAPA`, `STAT`, `RESA`, `TRDT`, `FIN`, `CAN`
- Network mode scaffold for later work
- Research notes capturing what is currently known

Not implemented yet:

- A general image-processing/decode pipeline beyond JPEG byte capture
- Production-grade network transport
- Epson-equivalent host image processing and output formats

## Why this structure

The goal is to keep three layers separate:

1. `transports/`
   USB and later network I/O
2. `protocol.py`
   ESC/I-2 command headers, token parsing, network frame helpers
3. `session.py`
   Scanner-oriented workflows built on top of transport + protocol

That lets you iterate on USB protocol work first without baking transport
assumptions into the rest of the app.

## Quick Start

```bash
cd scaner
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[network]'
```

If `pyusb` cannot access devices on macOS, install libusb:

```bash
brew install libusb
```

If this folder is moved again, recreate its virtual environment at the new path.
Python environments and editable installs contain absolute paths. The original
moved environment was preserved as `.venv-before-desktop-repair` during repair.

## CLI

List candidate USB devices:

```bash
ff680w probe-usb
```

Send simple ESC/I-2 queries over USB:

```bash
ff680w usb reset
ff680w usb info
ff680w usb status
ff680w usb capabilities
ff680w usb resolutions
ff680w usb load
ff680w usb plan-gray
ff680w usb vendor-summary
ff680w usb scan-gray --output /tmp/ff680w-scan-gray.jpg
ff680w usb scan-gray --skip-mechanical --output /tmp/ff680w-scan-gray.jpg
ff680w usb trace --command INFO
```

Notes from live hardware:

- If the device gets into a bad state after low-level probing, `ff680w usb reset`
  has been enough to recover it during testing.
- `ff680w usb info` and `ff680w usb status` have both been validated against a
  real `FF-680W`.
- `ff680w usb vendor-summary` prints the FF-680W model defaults and table ids
  imported from the local `Epson Scan 2` package, so preset work no longer
  depends on `/tmp/ff680w-es2` being present.
- `ff680w usb plan-gray` prints the current vendor-driven FF-680W grayscale
  scan plan, including imported table ids and the default `#ADFLOAD` action.
- The real `FF-680W` rejects short grayscale scan payloads; it accepted the
  exact SANE-derived mono LUT block for profile/LUT id `2`.
- In the earlier April 2026 tests, `ff680w usb scan-gray` reached
  `PARA OK` and `TRDT`, but `IMG ` still returns empty blocks, so the final
  feed/start transition is still being mapped. It now runs the vendor-driven
  default ADF `MECH` action sequence first. October testing succeeded with
  100 ms polling delays. Prefer `usb scan` for normal capture; `scan-gray`
  remains the older low-level probe and lacks the new job validation/cleanup.
- `INFO` without a prior `FS X` lock/init step is rejected by the scanner.

Network scaffolding:

```bash
ff680w net status
ff680w net hints
ff680w net discover
ff680w net resolve --name "EPSON FF-680W"
ff680w net greeting --name "EPSON FF-680W"
ff680w net endpoint --name "EPSON FF-680W"
ff680w net uri --host 192.168.1.50
ff680w net tcp-probe --host EPSONFB2F50.local
ff680w net tls-probe --name "EPSON FF-680W"
ff680w net wrap --command INFO
ff680w net send-probe --host EPSONFB2F50.local --command INFO
ff680w net startup --host EPSONFB2F50.local
ff680w net startup --name "EPSON FF-680W" --skip-lock --no-default-commands
ff680w net snmp --name "EPSON FF-680W"
ff680w net event-manager-state
ff680w net webconfig-state --name "EPSON FF-680W"
ff680w net pair-state --name "EPSON FF-680W"
```

This now reports the XIOP-derived local Wi-Fi hints, can build raw Epson
network probe frames, and can query the Epson-enterprise SNMP leaves that the
local apps appear to use for pairing and session state.

Live LAN notes from the tested FF-680W:

- `dns-sd` browsing on `_scanner._tcp` finds `EPSON FF-680W`.
- Resolving that service returns `EPSONFB2F50.local:1865` plus TXT data such as
  `mdl=FF-680W`, `mfg=EPSON`, `adminurl=http://...:80/`, and
  `scannerAvailable=0`.
- `ff680w net greeting` captures the first frame sent by the scanner on connect
  and parses the payload tail as an inferred IPv6 link-local address.
- `ff680w net endpoint` mirrors Epson's `epsontcpip://` URI shape for the
  resolved service.
- `ff680w net snmp` queries the Epson-enterprise OIDs that ScanSmart and
  ButtonManager appear to use for pairing and network-session state. On the
  tested unit it returns:
  - `pairing_host=Mac.localdomain`
  - `app_mib_30_1_1=1`
  - `app_mib_30_1_3=2`
  - `app_mib_30_2_5=80e0`
- `ff680w net event-manager-state` reads Epson Event Manager's local network
  scan settings and log files. On the tested machine it reports:
  - `event_manager_enabled=true`
  - `event_manager_pc_name=Mac.localdomain`
  - `event_manager_log=Service restart.`
- `ff680w net webconfig-state` checks the scanner's HTTPS admin UI without
  changing device state. The scaffold now distinguishes between the first-run
  forced-password gate and a reachable admin UI. On the tested unit after the
  initial WebConfig setup it resolves to:
  - `webconfig_force_password_required=False`
  - `webconfig_admin_page_accessible=True`
- `ff680w net pair-state` combines the Bonjour TXT record, Event Manager
  settings, WebConfig gate, and Epson-enterprise SNMP leaves in one probe so
  the current Wi-Fi blocker can be reproduced in one command.
- `ff680w net pair-state` now also highlights when the scanner's current
  `session_address` matches one of the Mac's local interfaces. On the tested
  unit it reports:
  - `session_address_matches_local_interface=True`
  - `session_address_interface=en0`
- Before launching `ScanSmart`, the live scanner reported:
  - `session_address_family=2`
  - `session_address=fe80::823:bc8:2b14:38fe`
- Launching `Event Manager` by itself did not change those values.
- Launching `ScanSmart` changed the same SNMP block to:
  - `session_address_family=1`
  - `session_address=""`
- That SNMP session-state change persisted after `ScanSmart` quit, but:
  - Bonjour still advertised `scannerAvailable=0`
  - the TCP greeting on port `1865` was unchanged
  - the `0x2100` lock frame still got EOF during `ff680w net startup`
- Unplugging USB restored the original SNMP network state:
  - `session_address_family=2`
  - `session_address=fe80::823:bc8:2b14:38fe`
- With USB unplugged, launching `ScanSmart` and `Event Manager` again did not
  change that SNMP state, did not flip `scannerAvailable`, and did not improve
  the TCP handshake. The Wi-Fi path still returned only the 36-byte greeting
  followed by EOF on `0x2100` lock.
- Event Manager's `Network Scan Settings` dialog opens successfully and can
  write `~/Library/Preferences/EPSON/Event Manager/Settings/NetWorkScanSetting.plist`
  with:
  - `EnableNetWorkScan=true`
  - `PCName=Mac.localdomain`
- Even after Event Manager writes that local network-scan state, the scanner
  still reports:
  - `scannerAvailable=0` in Bonjour TXT
  - the same SNMP pairing/session values
  - the same 36-byte TCP greeting followed by EOF on `0x2100` lock
- The tested unit required a first-run WebConfig administrator-password setup
  before the advanced UI became available. Clearing that gate did not make the
  Wi-Fi scan session usable by itself.
- WebConfig now reports `Scanner Status: Busy.` and rejects both enable and
  disable attempts on `Services > Network Scan` with `Setup failed.`
- `_uscan._tcp` did not advertise during the same test window even though the
  Epson ICA helper binary contains that service type.
- A plain TCP connect to the resolved `:1865` endpoint succeeds.
- `ff680w net tls-probe` mirrors what ScanSmart actually does after selecting
  the network FF-680W from its `Select scanner` window: it opens TCP on
  `:1865`, starts TLS, and currently gets reset by the device before the
  handshake completes.
- A fresh TCP connection immediately returns a 36-byte Epson `IS` frame before
  any command bytes are required:

```text
49538000380c0000001800000104810001010110fe8000000000000008230bc82b1438fe
```

- Sending `LOCK`, `INFO`, or `STAT` as the first frame on a new connection
  currently produces that same 36-byte reply.
- A real `ScanSmart` single-sided scan attempt now reaches the network picker.
  The picker exposes one row:
  - `EPSON FF-680W`
  - `Network connection`
  - `192.168.1.73`
- Confirming that row with `OK` opens a live error dialog:
  - `Scanner is in use. (User's IP address shown below.) Please wait until the current scanning session is finished, then try again.`
  - `User: fe80::823:bc8:2b14:38fe`
- That `User:` IPv6 string matches both:
  - the tail of the 36-byte Epson greeting on port `1865`
  - the SNMP `session_address` value
- It also matches the local Mac's `en0` link-local address, which means the
  scanner believes this machine already owns the current network scan session.
- `ff680w net startup` models the likely Epson job-control path
  (`0x2100` lock, ESC/I-2 probe frames, `0x2101` unlock) and currently shows
  that the device closes the socket immediately after the greeting. Even the
  SANE-derived `0x2100` lock payload
  (`01 a0 04 00 00 01 2c`) gets EOF instead of a follow-on session.
- `ff680w net startup --skip-lock --no-default-commands` now gives a clean
  unlock-only probe. On the tested unit the scanner accepts the TCP connect,
  sends the same greeting, and then cleanly drops the socket after `0x2101`
  without changing the session owner or `scannerAvailable`.
- Changing Event Manager's local `PCName` and relaunching it did not change the
  scanner's SNMP `pairing_host`, which suggests the scanner-side pairing state
  is persistent and not simply mirrored from the current plist contents.

That is enough to confirm the FF-680W is reachable over Epson's network path
without Epson's UI apps running, even though the exact greeting semantics and
full session flow still need mapping.

## Tests

```bash
python3 -m unittest discover -s tests
```

## Layout

```text
ff680w-re/
  docs/
  src/ff680w_re/
    transports/
    cli.py
    constants.py
    protocol.py
    session.py
  tests/
```
