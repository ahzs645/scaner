# Network discovery/settings validation — 2026-10-11

## Scope and current observations

These checks targeted the attached Epson FF-680W on the same LAN. No paper feed,
scan acquisition, scanner reset, pairing changes, SNMP writes, administrator
settings or network configuration changes were requested.

- Bounded Bonjour browsing finds `EPSON FF-680W` at
  `EPSONFB2F50.local:1865`, `_scanner._tcp`, model FF-680W. The current
  advertisement has `scannerAvailable=1`; the older busy-state capture is no
  longer the current observation. `_uscan._tcp` was not seen during this browse.
- A TCP connection receives an idle 17-byte frame:
  `49538000380c0000000500000104000000`. This differs from the historical
  36-byte busy-owner greeting.
- A GET to `http://EPSONFB2F50.local/eSCL/ScannerCapabilities` returned HTTP 404
  with no Access-Control-Allow-Origin header. This single check does not prove
  every possible HTTPS/eSCL path or firmware lacks eSCL; it supplies no working
  browser-compatible eSCL endpoint.
- An isolated Python probe successfully completes outer LOCK, tunneled FS X,
  INFO/CAPA/RESA/STAT, FIN and outer unlock. Raw local evidence:
  [network-settings-live.json](rea-evidence/network-settings-live.json).
- The native Node reader independently succeeds with the same settings commands
  and no cleanup warnings. It confirms color/grayscale, duplex, deskew,
  double-feed detection, hardware crop at 300/600 and input resolutions
  50/75/100/150/200/240/300/360/400/600.

## Electron interface

The sandboxed renderer loads bundled files under `scan-studio://app/` and exposes
only named discovery/settings operations through preload. Actual IPC sender
origin validation succeeds in Electron 44.7.0; Node URL.origin is not used as an
origin authorization check. The renderer retains no external HTTP connections.

Find network scanners and Read network settings were exercised through the
native interface. Discovery succeeds with a five-second budget; the original
shorter cold-start attempt did not find the scanner. Electron's initial
getaddrinfo lookup failed, so the selected advertised hostname is now resolved
with a bounded native Bonjour A-record query. The resulting private IPv4 address
is pinned for the TCP operation. The corrected interface displays the real color,
duplex and resolution capability result.

Electron WebUSB was also checked without acquisition: Connect scanner succeeded,
read live settings, enforced CAPA constraints and enabled the USB scan control.
Disconnect released it normally. No actual scan or image-processing job was
issued in the new Electron profile. Chrome's existing saved images remain in
Chrome's separate origin/profile.

A macOS arm64 local app is generated with `npm run package:desktop`. It bundles
Electron 44.7.0, source/runtime assets and license notices, declares
NSLocalNetworkUsageDescription and `_scanner._tcp` in NSBonjourServices, and uses
a local ad-hoc signature. It is not Developer ID signed or notarized for public
distribution. The local app launches normally and discovers the scanner. When launched
independently through macOS, its TCP settings read returned EHOSTUNREACH, while
the command-line reader and `npm run desktop` development app succeeded. Local
Network settings were inspected read-only; no ScanStudio permission entry was
available and no settings were changed. This is a standalone-app release blocker,
not evidence that the scanner is offline. Its exact signing/privacy attribution
needs further diagnosis; the current packaged bundle must not be advertised as
fully working LAN access. The screenshot records the working development app.

## Automated validation and remaining work

- Browser strict build and **135 tests pass**.
- Desktop **33 tests pass**: discovery/IPv4 resolution/lifecycle, private target
  and IPC authorization, framed TCP fragmentation/bounds, identity checks,
  settings allowlists, errors and session cleanup.
- Python probe **6 tests pass**.

The desktop controls currently provide discovery and settings inspection.
**Network image acquisition is not implemented or hardware validated.** The
main Scan loaded sheets control still uses the existing WebUSB driver. The next
step is a transport/profile implementation with verified PARA/TRDT/image framing,
FF job preparation if needed, cancellation/finalization, duplex side ordering
and real multi-sheet limits. Useful capture references and source pins are in
[network research](ff680w-network-research.md); extension and release gates are in
[network driver design](network-driver-design.md).

[Working Electron development interface](scan-studio-network-electron.png).


## Real network capture follow-up

The development Electron app completed native Epson TCP acquisition through the
common NetworkScannerDriver and existing capture UI. Job
`07218250-75ee-4c1e-8b6c-ad012ec9f0e5` requested one sheet, duplex RGB, 200 dpi,
Letter, JPEG quality 90, double-feed detection, with hardware crop/deskew and post
processing off. It returned two images and finished normally with no warnings.
Exported ZIP independently decoded with Pillow: front 246002 bytes, back 369554
bytes; both 1696×2200 RGB JPEGs. Export and manifest are retained under
`scans/network/07218250-75ee-4c1e-8b6c-ad012ec9f0e5/`.
The independently launched rebuilt app reopened this complete two-page job from
IndexedDB. The physical number of sheets remaining in the feeder has not been
observed; receiving one pair is proof of the job limit, not proof against prefeed.
Screenshot: `scan-studio-network-capture.png`.

189 browser/desktop tests passed before capture, plus two NetworkScannerDriver
validation/cancellation tests and four native executable tests afterward.

The independently launched bundle with distinct source-built main UUID
37EC3FCE-0F07-3A7C-9A47-3BE2517F6205 still discovers the scanner but its TCP
connection reports EHOSTUNREACH. Unique executable identity alone did not resolve
this Mac's standalone network access. No privacy setting, firewall protection or
renderer security was changed. Development launch remains the verified acquisition
path; standalone acquisition is not validated.
