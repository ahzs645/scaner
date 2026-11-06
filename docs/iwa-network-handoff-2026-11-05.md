# Scan Studio over Wi‑Fi in Chrome

November 5, 2026 · Implementation handoff for the Epson FastFoto FF‑680W

An Isolated Web App (IWA) in desktop Chrome 156 discovered the FF‑680W over
Bonjour and read its capabilities over Epson TCP. A signed test bundle of
the current Scan Studio web build repeated the settings read with no web
server running. The implementation follow-up connected this transport to the
capture UI and validated a duplex scan, cancellation, and a fresh scan after
recovery on hardware.
These tests used Chrome developer mode and temporary profiles.

| Runtime | What is available today |
| --- | --- |
| Website or regular PWA | The existing WebUSB path. Ordinary web pages lack the multicast UDP and raw TCP sockets this Epson uses. |
| Scan Studio development desktop app | Electron supplies Bonjour and TCP. A previous hardware test acquired one duplex sheet and exported two JPEGs. The independently launched macOS bundle has a separate local-network issue. |
| Chrome IWA | The signed development build uses Direct Sockets for discovery, settings, and capture. The validated path on this Mac specifies a Wi‑Fi address when the default multicast route points to a tunnel. |

[Chrome Direct Sockets](https://developer.chrome.com/docs/iwa/direct-sockets) ·
[Desktop hardware validation](network-live-validation-2026-10-11.md) ·
[Browser feasibility](network-browser-feasibility.md)

## Implementation and hardware follow-up

Scan Studio's **Find network scanners** button now runs the IWA Bonjour query.
The picker pins each supported result to the private IPv4 address that sent its
advertisement. **Connect network scanner** verifies model identity through
Epson INFO and loads the live capabilities. **Scan loaded sheets** then uses the
shared Epson session and existing page storage. In an ordinary tab the network
panel stays hidden. [Build and install instructions](../web-app/README.md#chrome-isolated-web-app)

| Check | Observed result in the signed app |
| --- | --- |
| Permissions and discovery | Denying local access produced the permission message. The default route found no scanners. The Mac's Wi‑Fi IPv4 address let the app find the Epson and connect from the picker. The separate manual scanner IPv4 option also connected. The automated runs set test-profile permissions through DevTools. The normal interactive permission grant is still unverified. |
| One-sheet duplex | At 200 dpi the app saved two 1696 × 2200 JPEGs, front then back, and finished with no cleanup warnings. |
| Stop | The test pressed Stop after the first duplex page was committed. The job became incomplete and retained its 1696 × 2200 front JPEG. The app reported the stop without a cleanup warning. |
| Reopen and scan after stop | The app read scanner settings again and reported an empty feeder before acquisition. After a fresh sheet was loaded, the same signed build rediscovered and reconnected to the Epson. A one-sheet, front-only scan saved one 1696 × 2200 JPEG at 200 dpi and finished with no cleanup warnings. |
| Bundled workers | Rotated a synthetic 720 × 900 JPEG to 900 × 720. The ICC validation worker opened the bundled sRGB profile and the local Tesseract worker detected upright Latin text. Exact bundled script URLs are allowed through Trusted Types. |
| Regression tests | 188 web tests passed and one private hardware-capture test skipped. All 61 Electron and 110 Python tests passed. The Electron fixture interrupted a fragmented image reply, completed cleanup, and then completed a second duplex scan. In a regular Chrome tab the web app initialized with WebUSB available and its network panel hidden. |

The shared [Epson session](../web-app/src/epson-network.ts) uses the same
framing, ownership, capture commands, and bounded cleanup in
[Chrome](../web-app/src/iwa-network.ts) and
[Electron](../web-app/desktop/network-settings.mjs).

## Original protocol and packaging probe

Environment was an unmanaged Apple silicon Mac, macOS 27.0.1 and Google Chrome
156.0.8078.80. The signed-bundle smoke test used Scan Studio commit `03ce4f9`.
Hardware results are for one FF‑680W on the same LAN. The temporary Chrome
profiles used the IWA developer flags and Chrome DevTools Protocol to grant the
test origin network access. The interactive permission flow remains a product
test. The runs stopped at settings and used a synthetic JPEG for the UI smoke
test. This handoff omits local IP addresses, hostnames, and device identifiers.

| Check | Observed result |
| --- | --- |
| Ordinary Chrome tab | `TCPSocket` and `UDPSocket` were unavailable. The scanner web root returned HTTP 200. The tested HTTP `/eSCL/ScannerCapabilities` path returned 404 and lacked CORS response headers. Its HTTPS counterpart returned 500 in a diagnostic request. A short Bonjour browse showed no `_uscan._tcp` or `_uscans._tcp` service. This only covers the tested endpoints and window. |
| Developer-mode IWA | Installed and opened on regular desktop Chrome with no enterprise policy configured. A TCP connection to the known scanner IP returned the Epson greeting after the test origin received local-network permission. |
| Bonjour routing controls | The Mac's route for IPv4 mDNS multicast `224.0.0.251` pointed to a tunnel. Default-interface multicast timed out both from a native socket and from Chrome. The same PTR query got a reply when bound to the Mac's Wi‑Fi IPv4 address. The native control also worked with `IP_MULTICAST_IF` set to Wi‑Fi. Direct unicast DNS to the scanner timed out. |
| IWA discovery → connect | The browser sent an mDNS PTR query for `_scanner._tcp.local` from an ephemeral UDP port. It parsed the reply's PTR, SRV, TXT, and A records and found `EPSON FF-680W`, Epson's hostname, and TCP port `1865`. Direct Sockets connected both to the discovered IP and to the discovered `.local` hostname. The test harness supplied the **Mac's Wi‑Fi address**. Chrome discovered the scanner's address. |
| IWA settings → release | An idle `IS` greeting was followed by outer lock and inner FS X acknowledgements. INFO verified `PRD=h007FF-680W`. INFO, CAPA, RESA, and STAT returned 356, 396, 1252, and 64 bytes respectively, including each command's 64-byte immediate response. CAPA advertised duplex and 50, 75, 100, 150, 200, 240, 300, 360, 400, and 600 dpi. FIN and unlock completed with no cleanup errors. |
| Bonjour availability discrepancy | During the development-proxy test the scanner advertised `scannerAvailable=0`. The TCP greeting matched the idle frame, and a read-only SNMP check reported an empty session address. The settings probe used the exact idle greeting and acknowledged lock as its gates. In the later signed-bundle test the advertisement was `1` and the same settings exchange succeeded. |
| Signed bundle without a web server | Built the existing web assets, added the IWA manifest and a test icon, then signed and installed a `.swbn` under a disposable key. Scan Studio initialized, saved and reopened a synthetic JPEG through its IndexedDB store, and decoded the blob preview. A DevTools-injected probe discovered the Epson and repeated the settings read in the signed origin. The app's network controls still require Electron. |
| Signed bundle image worker | The default `WorkerImageProcessor` failed at worker construction with `This document requires 'TrustedScriptURL' assignment`. A diagnostic worker factory used a Trusted Types policy permitting the exact bundled worker URL. The same worker then rotated a synthetic 3 × 2 JPEG to 2 × 3. The production worker entry points still need this integration. |

Direct Sockets exchanges UDP and raw TCP bytes. The CORS failure applied to the
separate HTTP test. A regular browser tab or PWA continues to use the web
networking APIs. [Fetch CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol) ·
[IWA security model](https://developer.chrome.com/docs/iwa/introduction#isolated)

Baseline checks in the temporary checkout passed the static build, 186 web
tests, and all 60 desktop tests. The web suite skipped the test that requires
private hardware JPEGs. The DevTools snippet below was also rerun from the
signed bundle. It found the Epson on Wi‑Fi and timed out on the default route.

## Design and release checklist

### 1. Ship a separate IWA build with its own permissions

- Package the same static app assets with an IWA manifest, version, and icon.
  Use `/` as the start URL with the tested `wbn` CLI. It serves `index.html` at
  `/` and generates a redirect at `/index.html`. Chrome accepted the test
  bundle at install time with the latter URL, but its launch reached an error
  page until the start URL was corrected.
- Set the tested manifest permissions `cross-origin-isolated`, `direct-sockets`,
  `direct-sockets-multicast`, `local-network`, and `loopback-network` to
  `['self']`. Current Chrome uses the latter two network permissions for bound
  UDP. The older `direct-sockets-private` token was unrecognized on Chrome 156.
  Keep the loopback grant limited to what the socket API requires for the
  bound UDP discovery operation.
- Request access when the user chooses **Find network scanners**. Verify the
  interactive allow, deny, retry, and OS permission cases in a regular app
  window. The automated probe applied per-origin permissions through DevTools.
- Feature-detect Direct Sockets in the IWA and register the transport through
  the existing capture UI. Keep the GitHub Pages build and Electron bridge on
  their respective entry points.

[Google Chrome Labs packaging template](https://github.com/GoogleChromeLabs/iwa-project-templates) ·
[Chromium Direct Sockets permission change](https://groups.google.com/a/chromium.org/g/blink-dev/c/5cSZjgnJelk) ·
[Current page build](../.github/workflows/pages.yml)

### 2. Make scanner discovery reliable across network interfaces

- Start with a short, user-initiated IPv4 PTR browse for `_scanner._tcp.local`.
  Parse DNS compression with length and loop bounds. Collect PTR, SRV, TXT,
  and A records across bounded replies, deduplicate results, and handle TTL
  expiry or goodbye records. The proof parsed a complete single reply from
  this Epson.
- Match the advertised FF‑680W and port `1865`, pin the selected private
  address for the connection, and verify model identity again with INFO.
  Require a fresh live selection before sending device commands.
- The picker tries the default route when the Wi‑Fi field is blank and accepts
  a local Wi‑Fi address when multicast needs a different interface. A known
  private scanner IPv4 address is a separate option. Test with VPN on and off,
  DHCP changes, Wi‑Fi
  reconnection, and multiple interfaces. Automatic interface selection is
  still open. The Direct Sockets explainer describes binding to an address,
  and records the absence of the older Chrome Apps interface enumeration API.
- Treat TXT availability as a display hint. Verify a fresh greeting and the
  lock ACK before any settings or acquisition exchange. Stop if the greeting
  is busy or unknown, or if the scanner refuses ownership. Preserve that result
  and offer a retry without taking over an active session.

[Direct Sockets multicast explainer](https://github.com/WICG/direct-sockets/blob/main/docs/multicast-explainer.md) ·
[Multicast DNS](https://www.rfc-editor.org/rfc/rfc6762) ·
[DNS Service Discovery](https://www.rfc-editor.org/rfc/rfc6763)

### 3. Reuse the Epson protocol and scan pipeline

- Keep the [scanner driver contract](../web-app/src/driver.ts),
  [FF‑680W profile](../web-app/src/profiles/ff680w.ts), and
  [ESC/I‑2 codec and image assembly](../web-app/src/protocol.ts). Extract the
  Epson framing and session lifecycle from the
  [Node settings transport](../web-app/desktop/network-settings.mjs) behind a
  small byte-stream interface. Use `Uint8Array` and `DataView` in the shared
  code. Adapt the existing Node socket and Chrome's `TCPSocket` streams to
  that interface, keeping Electron's exact read and write behavior covered by
  its current fixture tests.
- Reuse the [existing network scan sequence](../web-app/desktop/network-scanner.mjs)
  for capability checks, feeder control, PARA, TRDT, image reads, and cleanup.
  Preserve framing for fragmented and coalesced TCP data, deadlines and size
  limits, single-session ownership, and cancellation with bounded FIN and
  unlock. Build a scan-capable IWA only after the shared settings adapter
  passes on hardware.
- Keep [capture, page ordering, and local export](../web-app/src/main.ts) on
  the existing driver path. Await the IndexedDB transaction for each page
  before accepting another image. Preserve completed pages on stop, timeout,
  or device disconnect. The Electron IPC stream and acknowledgement token can
  stay inside Electron. The IWA can await the same page callback directly.

[Existing settings protocol and fixture notes](network-driver-design.md#exact-verified-settings-session)

### 4. Make the existing app assets work in the signed origin

- Introduce a narrow Trusted Types policy for worker URLs. Allow the exact
  bundled module paths on the app's own origin. Apply it to the processing
  and color worker entry points and audit the OCR library's nested worker
  loader. Keep the IWA's content policy enabled.
- Exercise real worker startup, color WASM and OCR assets, editing, blob
  previews, exports, IndexedDB reopen, and an app upgrade. The
  `isolated-app://` origin has its own storage. Document the existing export
  flow for people bringing documents from the website or Electron.
- Keep the signing identity stable across updates. Record the supported
  installation path, upgrade behavior, and uninstall or export process.
  Developer-mode sideloading worked on this Mac. Consumer installation without
  developer mode and enterprise installation on other platforms need separate
  validation before being offered as release paths.

[IWA content security policy](https://developer.chrome.com/docs/iwa/introduction#isolated) ·
[IWA version management](https://developer.chrome.com/docs/iwa/version-management)

## Acceptance tests

| Stage | Pass condition |
| --- | --- |
| Install and permissions | A clean profile installs and opens the intended bundle, then gives understandable results for grant, denial, and retry. The signed app reopens with the dev server stopped. |
| Discovery | With Wi‑Fi and no tunnel, **Find network scanners** lists the Epson without a supplied scanner address. With a tunnel, the UI either finds the device or explains the interface fallback. Expired, duplicate, malformed, and unsupported advertisements are covered by fixtures. |
| Settings | The selected FF‑680W returns INFO, CAPA, RESA, and STAT. Busy or unknown greetings stop before lock. A malformed frame, timeout, or failed initialization produces an actionable result and exercises bounded cleanup. |
| Capture | Start with one test sheet at 200 dpi, simplex then duplex. Verify valid JPEGs, front/back order, exact page count, feeder behavior, and a second successful job. Then exercise an empty feeder, stop mid-job, a dropped socket, and a write/storage failure. Confirm completed pages survive and the scanner can be used again. |
| App parity | Processing, OCR, color, append, IndexedDB reopen, and ZIP export work under the signed IWA policy. Existing web USB and Electron tests keep passing. |
| Release | Verify the actual installation and upgrade path for each advertised platform, with a release signing key and the intended distribution policy. |

## Reproducing the experiment

1. Use a disposable Chrome profile. In Chrome 156 on macOS the flags are
   `#enable-isolated-web-apps` and `#enable-isolated-web-app-dev-mode` under
   `chrome://flags`. Install the development origin or signed bundle from
   `chrome://web-app-internals`. Google Chrome Labs' template shows both
   paths. The signed smoke test used Node 26.7.0, `wbn@0.0.10`, and
   `wbn-sign@0.3.3` with an ephemeral Ed25519 development key.
2. Build the static app with `npm ci --ignore-scripts` and `npm run build`
   from `web-app`. In a staging copy of `dist`, add the icon and
   `/.well-known/manifest.webmanifest` with `start_url` and `id` both `/`,
   numeric `version`, and the five permissions above. The tested commands were
   `wbn --dir dist --output test.wbn` and
   `wbn-sign sign test.wbn dev-key.pem --output test.swbn`. Install the `.swbn`
   and open its `isolated-app://` origin with the development server stopped.
3. Use `dns-sd -B _scanner._tcp local.` as the system control. On macOS,
   `route -n get 224.0.0.251` reports the multicast route and
   `ipconfig getifaddr en0` reports the Wi‑Fi address on this Mac. Compare the
   IWA's default `UDPSocket({localAddress: '0.0.0.0'})` with a socket bound to
   the Wi‑Fi IPv4 address. Send a DNS PTR question for `_scanner._tcp.local`
   to `224.0.0.251:5353` from the ephemeral port and correlate the legacy
   unicast response with the query ID. Confirm the reply advertises the Epson
   instance, hostname, and port before using the numeric address.
4. Open `TCPSocket(address, 1865)` from the IWA. The idle frame was
   `49538000380c0000000500000104000000`. The settings-only order is outer LOCK,
   FS X, INFO, CAPA, RESA, STAT, FIN, and outer unlock. The exact wire examples,
   additional-data request, and bounds are in the
   [verified settings sequence](network-driver-design.md#exact-verified-settings-session).
   The [Python settings probe](../src/ff680w_re/network_settings_probe.py) is
   a native control for the same sequence.

The short DevTools probe below reproduces the DNS exchange without opening
the scanner's scan port. Run it in the IWA origin after granting network
access. Supply the Mac's Wi‑Fi IPv4 address for the bound test, then compare
with `0.0.0.0` for the default route. This probe identifies the reply by its
query ID and Epson service label. The integration should use the record
parser and endpoint validation described above.

```js
async function probeEpsonBonjour(localAddress) {
  const socket = new UDPSocket({ localAddress, multicastTimeToLive: 255 });
  const labels = ['_scanner', '_tcp', 'local'];
  const qname = labels.flatMap(label => [label.length, ...new TextEncoder().encode(label)]);
  const query = Uint8Array.of(0x6b, 0x17, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
    ...qname, 0, 0, 12, 0, 1);
  let reader, writer, timer;
  try {
    const { readable, writable } = await socket.opened;
    reader = readable.getReader();
    writer = writable.getWriter();
    await writer.write({ data: query, remoteAddress: '224.0.0.251', remotePort: 5353 });
    const timeout = new Promise(resolve => { timer = setTimeout(resolve, 4000, null); });
    for (;;) {
      const packet = await Promise.race([reader.read(), timeout]);
      if (!packet || packet.done) return null;
      const { data, remoteAddress, remotePort } = packet.value;
      if (remotePort === 5353 && data[0] === 0x6b && data[1] === 0x17
          && (data[2] & 0x80) && new TextDecoder().decode(data).includes('EPSON FF-680W')) {
        return { remoteAddress, remotePort, replyBytes: data.length };
      }
    }
  } finally {
    clearTimeout(timer);
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
    writer?.releaseLock();
    await socket.close().catch(() => {});
  }
}
```

[Google Chrome Labs test setup](https://github.com/GoogleChromeLabs/iwa-project-templates) ·
[Chrome bundle and signature instructions](https://developer.chrome.com/docs/iwa/introduction#bundle-your-app)

## Closest public implementations

| Project | What it demonstrates |
| --- | --- |
| [Google's archived mDNS Browser](https://raw.githubusercontent.com/GoogleChrome/chrome-app-samples/main/_archive/apps/samples/mdns-browser/main.js) | JavaScript DNS-SD discovery over multicast. It binds to each interface's IPv4 address using the older Chrome Apps `chrome.system.network` and `chrome.sockets.udp` APIs. |
| [Google Chrome Labs Telnet IWA](https://github.com/GoogleChromeLabs/telnet-client) | An installed TypeScript web app speaking a non-HTTP protocol directly over `TCPSocket`. It demonstrates the same transport boundary as the Epson connection. |
| [epson2paperless](https://github.com/mtheuma/epson2paperless/blob/main/docs/PROTOCOL-REFERENCE.md) | Network acquisition on the exact FF‑680W over Epson's `IS`/ESC/I‑2 framing. It runs as a local service and also documents the scanner's separate push-scan discovery and trigger channels. |
| [NAPS2.WebScan](https://github.com/cyanfish/naps2-webscan) | Browser-based scan acquisition through a local eSCL sharing service. It is a reference for a website-plus-helper deployment. |

The public search turned up pieces of the design, including code for this
exact scanner model. It did not turn up an FF‑680W scanner implementation
combining Bonjour discovery and acquisition in a Chrome IWA.
