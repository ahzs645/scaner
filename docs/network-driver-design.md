# Network driver extension — 2026-10-11

The FF-680W's native network **settings session is now verified**, using the
correct Epson outer lock followed by tunneled FS X. Network image acquisition
is still unverified. Preserve the working USB driver and expose network settings
as a separate inspection capability until the network scan lifecycle passes
real-device tests. A discovered endpoint, an open TCP socket, or a successful
CAPA response alone must not enable a Scan action.

This report combines primary-source research, existing project experiments,
and the coordinating agent's new live result. This author performed no scanner
USB/LAN operations. Loopback TCP fixture tests exercise a simulated server only.

## Evidence and its limits

| Evidence | Established | Remaining unknown |
| --- | --- | --- |
| [Historical project notes](../docs/research.md) | Bonjour `_scanner._tcp`, proprietary Epson TCP port 1865, structured `IS` replies, and Epson pairing/session state were observed in April. | Those observations do not describe today's ownership state. The old 36-byte reply's IPv6 tail meaning was an inference. |
| Coordinating agent's new Bonjour result | `scannerAvailable=1`; greeting now has the captured idle five-byte payload. | A TXT availability flag does not prove a scan job will work. |
| [New settings capture](../docs/rea-evidence/network-settings-live.json) | Outer lock ACK, FS X ACK, full INFO/CAPA/RESA/STAT, FIN and outer unlock completed without errors. INFO explicitly identifies `h007FF-680W`. | No PARA, TRDT, IMG, duplex image routing, job cancellation, or reconnect-after-scan was tested over TCP. |
| Current coordinating-agent HTTP check | `/eSCL/ScannerCapabilities` returned 404 without CORS headers. | This is a bounded negative result for that endpoint/path, not proof that every firmware/service lacks eSCL or WSD. |
| [Python network facade](../src/ff680w_re/transports/network.py) and [models](../src/ff680w_re/transports/_network_models.py) | Discovery and diagnostics exist; `NetworkTransportStatus.implemented` remains false. | This facade is not an image-acquisition transport. |

The older startup diagnostic sent outer LOCK then INFO/STAT directly. The
official source performs a separate `eds_lock` / FS X after opening and locking
the TCP session. Adding that step produced the new successful live settings
result; it does not prove why the older outer LOCK itself encountered EOF.

The source reference is the local official SANE checkout
`36c87fc33d91ebd60f70a0934f2e44ffd9a818d2` (October 10, 2026). Its TCP source
has an optional TLS fallback after a failed plain welcome; the manual still
labels network support unfinished. Do not convert the existence of this code
into a blanket compatibility claim. [Pinned TCP source](https://gitlab.com/sane-project/backends/-/blob/36c87fc33d91ebd60f70a0934f2e44ffd9a818d2/backend/epsonds-tcp.c),
[pinned network framing](https://gitlab.com/sane-project/backends/-/blob/36c87fc33d91ebd60f70a0934f2e44ffd9a818d2/backend/epsonds-net.c),
[pinned FS X control](https://gitlab.com/sane-project/backends/-/blob/36c87fc33d91ebd60f70a0934f2e44ffd9a818d2/backend/epsonds-io.c).

## Available implementations and browser transport choices

| Implementation | What can be reused or learned | Relevance to this Mac/FF-680W |
| --- | --- | --- |
| [sane-wasm](https://github.com/goncalomb/sane-wasm) / [WebScan](https://github.com/goncalomb/webscan) | SANE compiled to WASM, bridged to WebUSB; browser acquisition options. | A USB implementation. It does not establish a raw TCP scanner socket for a normal browser page. |
| [SANE epsonds](https://gitlab.com/sane-project/backends/-/tree/36c87fc33d91ebd60f70a0934f2e44ffd9a818d2/backend) | ESC/I-2 framing, outer network ownership, explicit read requests, and scan lifecycle source. | Closest protocol reference, supplemented by this unit's live capture. The complete backend has not been validated for this Mac's network acquisition. |
| [Utsushi](https://github.com/utsushi/utsushi) | Epson-origin ESC/I driver architecture with separate connection plugins. Its README requires a non-free networkscan plugin for networking. | Useful architectural precedent; its repository alone is not a complete free network transport and its listed models do not establish FF-680W support. |
| [sane-airscan](https://github.com/alexpevzner/sane-airscan/blob/master/README.md) | Native eSCL and WSD implementations, including feeder batches and duplex; some Epson models are verified. | Its compatibility table does not establish FF-680W support. Do not transfer ES-580W evidence to FF-680W. |
| [NAPS2.WebScan](https://github.com/cyanfish/naps2-webscan) | Browser JS/TS talks HTTP eSCL to a local scanner-sharing service. | A bridge; its sample service targets Windows. It demonstrates HTTP browser scanning, not this Epson's native TCP protocol. |
| [scanservjs](https://github.com/sbs20/scanservjs) | Browser UI with a Node/SANE service, multipage and processing pipeline. | Requires a Linux host/VM and a working SANE backend; it is not an ordinary browser-only native Mac transport. |

Ordinary pages cannot open arbitrary TCP/UDP sockets. Chrome exposes Direct
Sockets inside Isolated Web Apps, with special packaging, permissions, and
deployment requirements. IWA development instructions include experimental
setup on non-ChromeOS systems; production availability on this unmanaged Mac
has not been established. A PWA installation alone does not grant Direct
Sockets. [Direct Sockets](https://developer.chrome.com/docs/iwa/direct-sockets),
[IWA deployment scope](https://developer.chrome.com/docs/iwa/introduction),
[IWA developer setup](https://chromeos.dev/en/tutorials/getting-started-with-isolated-web-apps/1).

An HTTP eSCL route would be another driver, not an ESC/I-2 transport wrapper.
It needs advertised/validated capability XML, job creation, successive
documents and deletion/cancellation. Browser CORS, local-network permission,
and certificate behavior must also work. Chrome's Local Network Access
permission does not create raw sockets or remove CORS requirements.
[Chrome Local Network Access](https://developer.chrome.com/blog/local-network-access),
[sane-airscan HTTP implementation](https://github.com/alexpevzner/sane-airscan/blob/master/airscan-escl.c).

The currently authorized Electron path is therefore the practical native TCP
host: keep socket access in the main process and expose narrow typed IPC.
The browser-only app retains its current static-only runtime and USB behavior.

## Exact verified settings session

Outer `IS` frames have a 12-byte header. Passthrough `0x2000` adds an eight-byte
header containing outbound payload length and requested response length, both
big-endian. TCP fragmentation has no relationship to these frame boundaries.

| Step | Request / required response |
| --- | --- |
| Welcome | Read the complete `IS` frame. This verified idle packet is `49538000380c0000000500000104000000`. Busy/unknown greetings stop before any lock. |
| Outer lock | Send `49532100000c00000007000001a0040000012c`; require a `0xa100` response containing exactly ACK `06`. |
| Inner FS X | Send `49532000000c0000000a000000000002000000011c58`; require a `0xa000` response containing ACK `06`. The requested response is **one byte**, unlike the project's tolerant USB control read. |
| INFO | Tunnel `INFOx0000000`, asking for 64 immediate bytes: `49532000000c0000001400000000000c00000040494e464f7830303030303030`. |
| Additional data | After checking the immediate command/length, send an empty `0x2000` passthrough request whose second length is the advertised extra size; read the complete returned outer frame. |
| Identity | Before CAPA or model-specific work, verify exactly one INFO `PRD=h007FF-680W`. This validates a protocol response, not cryptographic device authentication. |
| Capabilities/settings | Repeat the immediate/extra-data exchange for CAPA, RESA and STAT. Preserve binary GMT tables during decoding. Empty-feeder STAT is readable device status, not a failed network connection. |
| Release | Tunnel `FIN x0000000`, requesting 64 bytes; then send outer unlock `49532101000c000000000000` with no expected reply; close the socket. Preserve primary failures plus cleanup warnings. |

The [isolated Python experiment](../src/ff680w_re/network_settings_probe.py)
records complete raw frames. The [Electron helper](../web-app/desktop/network-settings.mjs)
provides `readNetworkSettings({host,port,timeoutMs,deadlineMs,signal})` and
`NodeFramedSession`. The latter's public queries allow only INFO/CAPA/RESA/STAT;
FIN is an internal cleanup operation. Neither helper sends acquisition commands.

The Electron helper requires a numeric IP. The main process resolves an
explicitly selected discovery/manual endpoint once, checks its address scope,
and passes that exact literal to the helper. It does not give the renderer a
general TCP proxy. Current default bounds are 1 MiB per settings frame/data,
3 seconds per I/O and 20 seconds overall, plus bounded cleanup. Outer unlock has
a separate short budget so a stalled FIN cannot consume its opportunity.

## Incremental architecture migration

1. **Keep the common driver contract.**
   [driver.ts](../web-app/src/driver.ts)
   already supplies pure `validateOptions`, settings, reset, scan and image
   callbacks. Storage and processing need no transport-specific rewrite.
   Keep the existing USB registry API as a compatibility adapter.

2. **Separate candidate discovery from supported connections.** Introduce a
   transport-discriminated candidate descriptor: USB device/VID/PID; or network
   endpoint, service type, interface scope, claimed model and UUID. Record
   verification independently: discovered, settings-verified, acquisition-
   verified, unavailable. Discovery names/TXT are display hints, not authority
   to select a model's payload builder. Pure registry matching must not probe
   unknown devices or open sockets.

3. **Split generic model data from connection parameters.**
   [profiles/esci2.ts](../web-app/src/profiles/esci2.ts)
   currently combines a USB interface with ESC/I-2 planning. Move USB descriptor
   selection into the USB registration/transport. Keep FF-680W defaults,
   geometry/LUT/planning and capability decoding in its model profile. A
   network-only eSCL model should not require invented VID/PID entries or the
   FF-680W planner.

4. **Inject an ESC/I-2 transport at the actual boundary.** Extract send/read,
   session ownership, finalize/disconnect and optional transport reset from
   [scanner.ts](../web-app/src/scanner.ts).
   The shared protocol engine still receives inner reply headers/data/tokens;
   WebUSB handles its configuration and bulk endpoints, while Epson TCP handles
   the outer handshake and explicit receive requests. Do not copy USB's FS Y
   tolerance or USB reset operation into TCP. Network reset should mean bounded
   disconnect/reconnect unless a separately verified device reset exists.

5. **Keep settings inspection separate until acquisition is validated.** The
   Electron IPC endpoint can return the proven compact settings and model
   constraints now. It must not create a Scan-capable registry entry merely
   because those reads worked. No inactive “Connect network” action should
   silently choose USB, call an unfinished facade, or fail only after a job is
   created. Once usable, registration should specify model **and transport**
   evidence; neither an Epson brand match nor port 1865 is enough.

6. **Implement acquisition in a dedicated network driver.** On the selected
   connection, validate options before media effects; acquire outer ownership,
   obtain inner control, query state, apply parameters, start transfer, read
   image blocks with backpressure, and finalize/release. Verify network-specific
   ownership transitions after FIN before trying to reuse a connection. The
   `ImageBatch` demultiplexer can be reused only after equivalent inner reply
   boundaries and front/back tokens are demonstrated. Other protocols retain
   independent factories.

An Electron main/preload API should return capabilities, progress and bounded
image bytes/results, accept a job cancellation ID, and preserve completed images
on later failure. Endpoint configuration is main-process state; renderer input
does not select arbitrary opcodes or arbitrary fetch destinations. This is a
proposed full-acquisition contract, not an implemented scan API.

## Test and release gates

Current isolated tests are
[Python fixtures](../tests/test_network_settings_probe.py)
and [12 Node TCP fixtures](../web-app/desktop/tests/network-settings.test.mjs).
They cover fragmentation/coalescing, exact wire bytes, ACK requirements,
busy/unknown greetings, identity rejection before CAPA, bounded lengths,
binary tone data, timeout/abort cleanup and FIN failure without blocking unlock.
They do not substitute for the coordinating agent's real settings capture.

Before enabling network Scan, add these gates:

- Registry tests for transport-specific duplicates, absent native host,
  unknown model, missing acquisition verification and no accidental USB
  fallback. Existing USB pairing/validation/lifecycle tests remain passing.
- Fixture tests for every header/data segmentation boundary, unexpected
  reply opcode, malformed nested length, early EOF, oversized image block,
  not-ready/feeder state and TLS-mode mismatch. Never assume one `recv` or Node
  `data` event is a complete packet.
- Acquisition fixture parity with existing USB tests: terminal data before
  `pen`, sticky front/back routing, `lftd000` only, two-sheet duplex collation,
  cancel/finalize/unlock ordering and lossless preservation of earlier pages.
- Electron IPC tests for resolved numeric endpoints, permission/endpoint
  rejection before socket creation, one owner per device, cancellation and
  renderer teardown. Retain originals and bounded storage/processing behavior.
- Explicit real-device trials: one-sheet gray/color, duplex, two sheets,
  empty feeder, controlled cancellation, and an immediate second job. Record
  device/firmware/transport, decoded JPEG dimensions/color, page/side order,
  cleanup and successful reacquisition. A settings-only success must remain
  labeled settings-only until these complete.

No administrator settings, pairing changes, firmware changes, SNMP writes or
network reset are part of this migration design's current experiment. Their
necessity has not been established by the new successful settings session.
