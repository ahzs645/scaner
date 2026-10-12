# Research Notes

## Device

- Model: `FF-680W`
- USB vendor ID: `0x04B8`
- USB product ID: `0x016B`
- Epson Scan 2 model alias: `ES0170`

## What is known

- SANE `epsonds` explicitly maps `0x016B` to `FF-680W`.
- SANE labels the backend as Epson `ESC/I-2`.
- USB support is marked `complete` in the SANE device description.
- Epson's FF-680W-specific macOS package installs:
  - `EPSON ES0170.app` under `Library/Image Capture/Devices`
  - `Epson Scan 2 ES0170.ds` under `TWAIN Data Sources`
  - shared `Epson Scan 2` frameworks under `Library/Image Capture/Support/EPSON/Epson Scan 2`
- The FF-680W-specific macOS ICA metadata matches:
  - USB `idVendor=0x04B8`
  - USB `idProduct=0x016B`
  - Bonjour `_scanner._tcp`
  - Bonjour TXT `mdl=FF-680W`

## SANE behavior to mirror

The `epsonds` backend uses 12-byte ESC/I-2 request headers:

- `INFOx0000000`
- `CAPAx0000000`
- `STATx0000000`
- `RESAx0000000`
- `TRDTx0000000`
- `PARAx0000000`
- `MECHx0000000`
- `IMG x0000000`
- `FIN x0000000`
- `CAN x0000000`

Control/lock commands over USB:

- `FS X` lock (`0x1c 0x58`)
- `FS Y` unlock (`0x1c 0x59`)

The backend reads a 64-byte immediate response block for simple commands and
parses `#ABC...` tokens until `#---`.

## Live USB notes (2026-04-03)

Observed against a real USB-connected `FF-680W`:

- `INFO` works with the current 12-byte header framing.
- `STAT` works and currently reports `ERR=ADF PE  ` when the feeder is empty.
- With paper inserted, `STAT` can return an empty success block.
- `INFO` without a prior `FS X` step is rejected with `0x15` (`NAK`).
- After a fresh USB reset, the first `FS X` reply is a one-byte `0x06` (`ACK`).
- Later `FS X` and `FS Y` exchanges can return a 64-byte
  `UNKNx0000000#---...` frame while subsequent `INFO` requests still succeed.
- The FF-680W-specific mono LUT from SANE profile/LUT id `2` is required to get
  `PARA` accepted for a grayscale JPEG scan payload. Shorter approximation
  payloads were rejected with `#parFAIL`.
- A valid grayscale payload now returns `#parOK` and `TRDT` succeeds, but `IMG `
  still returns empty `IMG x0000000` blocks on the tested unit, so the final
  feed/start trigger remains unresolved.
- A libusb device reset has been enough to recover the scanner after bad
  low-level sessions during testing.

## Local Epson package data now vendored into the scaffold

- The FF-680W model plist and selected shared tables have been copied into code
  form under `src/ff680w_re/vendor_data.py`.
- Imported sources:
  - `ES0170.plist`
  - `ConvertTable.plist`
  - `ESProfile0082.plist`
  - `ESProfile1047.plist`
  - `ESLUT0016.plist`
  - `ESResolution0162.plist`
- The vendored summary exposes:
  - model identity `EPSON FF-680W` / `0170` / `016B`
  - default table ids for profile, gray-balance, LUT, and resolution
  - filter-sequence mappings from `ConvertTable.plist`
  - FF-680W-supported input/output resolution lists
- `XIOP` discovery strings are also captured for later network work:
  - Bonjour `_scanner._tcp`
  - Epson URI formats like `epsontcpip://...`
- The grayscale scan probe now uses a vendor-driven plan object that keeps the
  imported table ids, default filter-sequence selection, and the default ADF
  `#ADFLOAD` action together instead of scattering them across hand-written
  constants.

## Upstream sanity check

- Homebrew `sane-backends` 1.4.0_2 was installed locally to cross-check the
  same device.
- `scanimage -L` still failed to identify the scanner on this machine.
- With `SANE_DEBUG_EPSONDS=11`, `epsonds` attempted `FS X` and failed during
  `eds_lock` with `Error during device I/O`, so the upstream backend is not
  currently a ready-made escape hatch on this setup.

## Network clues

- SANE's `sane-epsonds` manpage still says network is "not yet supported".
- SANE source already contains:
  - Avahi discovery on `_scanner._tcp`
  - TCP port `1865`
  - Epson wrapper packets starting with `IS`
  - job-control commands `0x2100` / `0x2101`
- VueScan binary contains:
  - `_scanner._tcp`
  - `_uscan._tcp`
  - `1865`
  - `eSCL`
  - generic Epson plugin bridge strings
- Epson's local `XIOP` bundle contains:
  - `_scanner._tcp`
  - `epsontcpip://...` URI templates
  - Bonjour helper strings
  - no `eSCL` strings in the inspected local XIOP binary
- FastFoto and ScanSmart do not appear to implement scanner networking
  themselves. Both main binaries weak-link:
  - `/Library/Image Capture/Support/EPSON/Epson Scan 2/Core/EpsonScan2.framework`
  - local `XIOP.plugin`
  - `~/Library/Preferences/EPSON/Event Manager/Settings/NetWorkScanSetting.plist`
- Event Manager contains a dedicated network split:
  - `EEventManager` loads `NetScanBundle.bundle`
  - `NetScanBundle` is separate from `USBScanBundle`
  - bundled launch agent `com.epson.eventmanager.agent` auto-runs
    `EEventManager`
- Scanner Monitor weak-links:
  - `EpsonScan2.framework`
  - `ICAWrapper.framework`
- Epson's bundled ICA helper `Epson ICA Scanner` uses Apple Image Capture
  discovery and contains:
  - `_uscan._tcp`
  - `_ippusb._tcp`
  - `ICDeviceBrowser`
  - `NSNetService`

## Live Wi-Fi notes (2026-04-03)

Observed against a real FF-680W advertising on the local LAN:

- `dns-sd -B _scanner._tcp local.` finds `EPSON FF-680W`.
- `dns-sd -L "EPSON FF-680W" _scanner._tcp local.` resolves:
  - host `EPSONFB2F50.local`
  - port `1865`
  - TXT:
    - `ty=EPSON FF-680W`
    - `mdl=FF-680W`
    - `mfg=EPSON`
    - `adminurl=http://EPSONFB2F50.local.:80/`
    - `scannerAvailable=0`
    - `UUID=cfe92100-67c4-11d4-a45f-dccd2ffb2f50`
- The same test window did not expose `_uscan._tcp`, so the proprietary Epson
  `_scanner._tcp` path is the one currently confirmed live on this device.
- A plain TCP connect to `EPSONFB2F50.local:1865` succeeds.
- A ScanSmart-driven scan attempt can now be reproduced locally:
  - direct click on the single-sided scan tile opens a `Select scanner` dialog
  - that dialog exposes one live row:
    - `EPSON FF-680W`
    - `Network connection`
    - `192.168.1.73`
- `ff680w net endpoint --name "EPSON FF-680W"` builds the local Epson URI:
  - `network epsontcpip://EPSONFB2F50.local/1865 "EPSON FF-680W" "EPSON FF-680W"`
- A fresh TCP connection returns this 36-byte `IS` frame immediately:
  - `49538000380c0000001800000104810001010110fe8000000000000008230bc82b1438fe`
- Sending `LOCK`, `INFO`, or `STAT` as the first frame on a new connection
  currently returns that same 36-byte block.
- After confirming the network row in ScanSmart, unified logs show the app does
  this on `192.168.1.73:1865`:
  - open TCP
  - start SSL negotiation immediately
  - receive `Connection reset by peer` during the handshake
  - open a second TCP connection to the same endpoint
- `ff680w net tls-probe` now mirrors that first app-side step directly from the
  scaffold.
- `ff680w net greeting` currently parses that payload as:
  - prefix `01 04 81 00 01 01 01 10`
  - inferred IPv6 tail `fe80::823:bc8:2b14:38fe`
- The same IPv6 value appears in three places on the tested machine:
  - the greeting tail on port `1865`
  - SNMP `session_address`
  - the Mac's local `en0` link-local address
- Inference: the greeting tail is very likely the scanner's current session
  owner, and in the current blocked state that owner is this Mac.
- SANE `epsonds_tcp_open()` expects a connect-time welcome message and only
  reads 5 bytes from it before moving on.
- SANE `epsonds_net_lock()` sends `0x2100` with payload:
  - `01 a0 04 00 00 01 2c`
- On the real FF-680W, after we consume the greeting, that SANE-derived lock
  payload still gets EOF. The socket closes before a post-greeting session is
  established.
- ScanSmart surfaces the failed session as a modal error:
  - `Scanner is in use. (User's IP address shown below.) Please wait until the current scanning session is finished, then try again.`
  - `User: fe80::823:bc8:2b14:38fe`
- That `User:` value matches both the greeting tail and the SNMP
  `session_address`, which is the strongest live evidence so far that the
  greeting address block is session ownership state, not just a transport hint.
- A direct unlock-only probe is now reproducible from the scaffold with:
  - `ff680w net startup --name "EPSON FF-680W" --skip-lock --no-default-commands`
- On the tested unit that unlock-only probe:
  - receives the normal 36-byte greeting
  - sends `0x2101`
  - gets no payload back
  - leaves `scannerAvailable`, `pairing_host`, and `session_address` unchanged
- That reply is not yet decoded, but it proves:
  - the Epson TCP endpoint is live
  - the device emits a structured Epson `IS` greeting before application data
  - the current blocker is the post-connect handshake, not raw reachability

## Live SNMP notes (2026-04-03)

- `ScanSmart` and `ButtonManager` both embed Epson-enterprise OIDs tied to
  network scan state:
  - `.1.3.6.1.4.1.1248.1.1.3.1.10.2.5.0`
  - `.1.3.6.1.4.1.1248.1.4.2.21.1.1.1.1`
  - `.1.3.6.1.4.1.1248.1.4.2.21.1.1.2.1`
  - `.1.3.6.1.4.1.1248.1.1.3.1.30.1.1.0`
  - `.1.3.6.1.4.1.1248.1.1.3.1.30.1.3.0`
  - `.1.3.6.1.4.1.1248.1.1.3.1.30.2.5.0`
- The scanner answers SNMPv1 `public` reads on port `161`.
- `Event Manager` exposes a dedicated `Network Scan Settings` dialog with:
  - `Enable Network Scan`
  - `Network Scan Name (Alphanumeric)`
  - a status log area
  - `OK` / `Cancel`
- `ff680w net snmp --name "EPSON FF-680W"` currently returns:
  - `sys_name=EPSONFB2F50`
  - `model_name=FF-680W`
  - `display_name=EPSON FF-680W`
  - `firmware=18.61.SP18P4`
  - `pairing_slot_state=1`
  - `pairing_host=Mac.localdomain`
  - `app_mib_30_1_1=1`
  - `app_mib_30_1_3=2`
  - `app_mib_30_2_5=80e0`
- Before launching Epson's UI apps, the session-address block was:
  - `session_address_family=2`
  - `session_address=fe80::823:bc8:2b14:38fe`
- Launching `Event Manager` plus its `EEventManager` and `EScanAssistant`
  helpers did not change the observed SNMP values.
- Launching `Epson ScanSmart` changed the session-address block to:
  - `session_address_family=1`
  - `session_address=""`
- After `Epson ScanSmart` quit, that changed session block persisted.
- Unplugging the USB cable restored the original SNMP network state:
  - `session_address_family=2`
  - `session_address=fe80::823:bc8:2b14:38fe`
- With USB unplugged, launching `Epson ScanSmart` no longer cleared the
  session-address block, but it still did not activate a usable Wi-Fi scan
  session.
- The `session_address` value from the pre-ScanSmart state matches the IPv6 tail of the 36-byte greeting
  sent on TCP port `1865`, which ties the proprietary `IS` greeting to the
  same SNMP session state Epson tracks elsewhere. The numeric family codes do
  not match directly, so only the address correlation is currently solid.
- The `pairing_host` value matches the host-binding clue from Epson's app
  strings and is the strongest local sign so far that network scan availability
  is paired/registered per machine, not just exposed as a raw open socket.
- Editing Event Manager's local `NetWorkScanSetting.plist` to change `PCName`
  and then relaunching the app did not change the scanner's SNMP
  `pairing_host`. Inference: scanner-side pairing persists independently of the
  current local plist contents.
- Even after `ScanSmart` changed the SNMP session block:
  - Bonjour still resolved `scannerAvailable=0`
  - the 36-byte TCP greeting on port `1865` stayed the same
  - the SANE-derived `0x2100` lock payload still received EOF
- With USB unplugged and `ScanSmart` open:
  - Bonjour still resolved `scannerAvailable=0`
  - the SNMP session-address block stayed in the original IPv6-populated state
  - the 36-byte TCP greeting still arrived unchanged
  - the `0x2100` lock payload still received EOF
- The scanner's WebConfig admin UI is now reachable on the tested unit after a
  one-time administrator-password setup. Clearing that gate changed
  `app_mib_30_1_1` from `2` to `1`, but it did not make Wi-Fi scanning usable.
- WebConfig `Product Status` still reports `Scanner Status: Busy.` and the
  `Services > Network Scan` page fails with `Setup failed.` even when applying
  the existing on/off state unchanged.
- Inference: `ScanSmart` is definitely mutating Epson-managed network scan
  state, but the changed SNMP leaf alone is not sufficient to make the raw
  Epson TCP session usable from our current clean-room handshake.
- Event Manager wrote the local settings file
  `~/Library/Preferences/EPSON/Event Manager/Settings/NetWorkScanSetting.plist`
  with:
  - `EnableNetWorkScan=true`
  - `PCName=Mac.localdomain`
- The same Event Manager dialog reported `No Error` / `Service restart.` in its
  log area during local testing.
- Changing that local flag did not change the scanner-side network state:
  - Bonjour still advertised `scannerAvailable=0`
  - SNMP `pairing_host` remained `Mac.localdomain`
  - SNMP `session_address_family`, `session_address`, `30.1.1`, `30.1.3`, and
    `30.2.5` stayed unchanged
  - the TCP greeting on port `1865` stayed the same
  - the `0x2100` lock payload still received EOF
- `ScanSmart`'s binary also embeds these additional network OIDs and labels:
  - `.1.3.6.1.4.1.1248.1.1.3.1.2.30.0`
  - `.1.3.6.1.4.1.1248.1.8.2.3.1.1.54`
  - `PushScanDstType`
  - `PushScanDstParam`
  - `MibWriteMode`
  - `MIBAccessRevision`
  - `ScanToComputerEnable`
  - `ScanToComputerEnableOIDInstanceID`
- Direct SNMP reads on `.1.3.6.1.4.1.1248.1.8.2.3.1.1` currently expose only:
  - `.18.1 = Hex-STRING: 18`
  - `.19.1 = INTEGER: 3`
  and the app-referenced `.54` leaf does not currently answer as a scalar on
  this unit.

## WebConfig gate (2026-04-03)

- `https://<scanner>/PRESENTATION/ADVANCED/COMMON/TOP` currently redirects via
  JavaScript to:
  - `/PRESENTATION/ADVANCED/FORCE_PASSWORD/TOP?accsessmethod=0`
- The reachable forced-password page is:
  - title `FF-680W`
  - header `Change Administrator Password`
  - form action `SET`
- Because the advanced WebConfig tree is still gated behind the first-run admin
  password flow, device-side Wi-Fi scan availability may depend on setup that
  has not yet been completed on the scanner itself.
- This workspace now treats that as a probeable state, not an inferred one.

## Practical conclusion

- USB is the right first target for clean-room work.
- Network should be treated as a second phase after packet capture or device
  validation against real hardware.
- The local app bundles now narrow the network target:
  - discovery via `_scanner._tcp`
  - URI shape `epsontcpip://host/1865`
  - background settings/agent behavior in Event Manager
  - TCP framing under Epson's shared scan core, not in the consumer UIs

## Additional app findings (2026-04-03)

- `XIOP` still looks like the proprietary scan transport layer:
  - `_scanner._tcp`
  - `epsontcpip://`
  - `TCPEndpoint`
  - `UDPCheckConnection`
- `Event Manager`'s `NetScanBundle` appears to be a separate push-scan channel,
  not the same code path as the scan transport. Local strings include:
  - `/PushScan`
  - `Epson Net Scan Monitor/2.0`
  - `http://www.w3.org/2003/05/soap-envelope`
  - `http://www.epson.co.jp/EpsonNet/Scan/2004/pushscan`
  - `http://schema.epson.net/EpsonNet/Scan/2004/pushscan`
  - `PushScan`, `PushScanResponse`, `ScanEnd`, `NewScan`
- The ICA helper remains a third path:
  - `ICDeviceBrowser`
  - `NSNetService`
  - `_uscan._tcp`
  - `_ippusb._tcp`
- VueScan contains both the Epson-discovery markers and generic eSCL markers:
  - `_scanner._tcp`
  - `_uscan._tcp`
  - `1865`
  - `webservices/eSCL`
  - `eSCL`

## Additional device HTTP findings (2026-04-03)

- Plain HTTP on port `80` hosts the web UI entry page and redirects advanced
  pages to HTTPS.
- HTTPS on port `443` serves the same Epson web UI with a self-signed
  certificate:
  - `CN=EPSONFB2F50`
  - valid from `January 1, 2010` to `January 1, 2038`
- On this FF-680W:
  - `https://EPSONFB2F50.local/eSCL/ScannerCapabilities` returns `500`
  - `https://EPSONFB2F50.local/eSCL/ScannerStatus` returns `500`
  - `http://.../eSCL/...` returns `404`
  - `/webservices/eSCL/...` returns `404` on both HTTP and HTTPS
- Inference: this device likely has some scanner web-service handling on HTTPS,
  but not in the generic path VueScan advertises, or it expects extra request
  shape/authentication/context before responding successfully.
