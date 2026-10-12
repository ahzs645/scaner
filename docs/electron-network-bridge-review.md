# Electron network bridge design review

Reviewed **2026-10-11** against current official Electron documentation and this project's existing browser assets. This reviews the proposed architecture; it is not a completed Electron runtime or hardware audit. No device or browser was operated.

**Follow-up scope:** the user subsequently authorized actual network scanning. The final two sections review that proposed extension and standalone macOS launch identity. Earlier settings-only recommendations describe the first implementation stage; network scan readiness still requires actual acquisition evidence.

## Recommended scope

The proposed split is appropriate: reuse the existing browser UI, WebUSB driver, image workers and IndexedDB; put Bonjour discovery and the bounded Epson network settings reader in Electron's main process. Expose only two named preload operations: `discover()` and `readSettings(scannerId)`. Network scanning remains unavailable until its session, parameter and image-transfer flow is verified on this unit. Discovery success and readable settings must not enable a LAN scan button.

This supplies capabilities missing from an ordinary website without a general local HTTP bridge server. It does **not** mean there are no receive sockets: Bonjour necessarily receives mDNS UDP traffic. Describe it as no exposed HTTP/TCP bridge service, and close the discovery sockets when the bounded discovery operation finishes.

## Renderer and preload boundary

Keep explicit `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, and `webSecurity: true`. Native network modules belong in main. The sandboxed preload has a limited Node environment; it needs only `contextBridge` and fixed `ipcRenderer.invoke` wrappers. It must not expose `ipcRenderer`, generic channel invocation, sockets, arbitrary fetch, filesystem paths or process execution. Electron recommends one IPC wrapper per operation. [Context isolation guidance](https://www.electronjs.org/docs/latest/tutorial/context-isolation), [Sandbox behavior](https://www.electronjs.org/docs/latest/tutorial/sandbox)

For each IPC call, main must validate the sender, the actual sending frame and the arguments independently of preload. Require the intended BrowserWindow's `webContents`, its main frame, and the expected app origin. Reject vanished frames, child frames and other windows. The current Electron security guide specifically uses `senderFrame.origin`, because URLs alone do not identify inherited or opaque origins reliably. Disable unapproved navigation and new windows. [Electron sender and navigation guidance](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages)

**Custom-scheme pitfall:** a Node-side `new URL('app://scanner/index.html').origin` evaluates to the literal string `"null"` in the local Node check. That value must never become an accepted origin. Verify Chromium's `senderFrame.origin` for the registered standard scheme in the pinned Electron build. Use exact parsed protocol/hostname/port checks as additional URL constraints, not hostname-only or substring matching. Until the runtime origin is verified, fail closed rather than accepting any opaque origin.

## App loading, protocol and storage

Prefer a fixed bundled origin such as `app://scanner/index.html` to `file://`. Register `app` before Electron's ready event with `standard: true`, `secure: true`, and `supportFetchAPI: true`; set `corsEnabled: true` if using that scheme's CORS support. Leave `bypassCSP`, extension access and unneeded Service Worker privileges disabled. Standard schemes provide relative resource resolution and web storage; secure registration is needed for secure-context APIs. [Protocol API](https://www.electronjs.org/docs/latest/api/protocol), [Scheme privilege fields](https://www.electronjs.org/docs/latest/api/structures/custom-scheme)

The protocol handler should serve only the known `scanner` host, GET/HEAD requests and files inside the built `web-app/dist` root. Resolve and verify containment, including percent encoding, separators and symlinks; reject unknown hosts, traversal, credentials, unexpected ports and network proxy routes. Return explicit MIME types and CSP headers. Register the handler on the **same session/partition** used by the BrowserWindow; a default-session handler does not automatically serve a custom partition.

A custom protocol avoids starting an HTTP listener and gives a stable origin. A loopback-only static server is a reasonable compatibility fallback if the pinned Electron build cannot support required workers/WebUSB on the custom scheme. That fallback should still serve assets only, bind `127.0.0.1`, validate Host, and expose no network-command routes. Use a stable origin/port if persistence matters; changing the port changes the storage origin.

Use a dedicated persistent partition, for example `persist:ff680w-desktop`, for jobs and OCR cache. Electron's session documentation distinguishes persistent `persist:` partitions from in-memory sessions. Custom-scheme IndexedDB still needs a restart test. Existing Chrome jobs and USB grants do not automatically move into Electron's separate origin/profile. Preserve the Chrome data and use an explicit export/import format if migration is desired; do not copy live IndexedDB profile files. [Session partitions](https://www.electronjs.org/docs/latest/api/session#sessionfrompartitionpartition-options)

## Main-owned discovery registry

Discovery should be a bounded, user-triggered browse for the scanner service types the native implementation understands. Main owns records containing the vetted address, interface, service port and identity hints. Return only bounded display data and an opaque ID. `readSettings(id)` resolves that ID in the registry; the renderer must never supply a hostname, port, URL, protocol, raw frame or timeout override.

Constrain endpoints to the intended local network and supported FF-680W protocol/port. Avoid resolving an arbitrary renderer-provided DNS name. Keep the selected advertised address pinned for the operation rather than resolving it again after selection. Expire stale registry entries and serialize operations per scanner. Treat Bonjour TXT values as untrusted identity hints, not authentication: validate lengths/types, render them as text, and confirm FF-680W identity from the read protocol when possible.

Limit discovery duration/results and settings response size, frame lengths and aggregate bytes. Socket errors, malformed replies, timeout and cancellation must close owned resources. A selected ID must not survive a change to the underlying endpoint silently.

## Network settings reads

The native reader should construct all traffic itself from a fixed allowlist: protocol-specific session acquisition when necessary, `INFO`, `CAPA`, `RESA`, `STAT`, and the matching session finalization/connection close. Do not expose `PARA`, `TRDT`, `IMG`, `MECH`, feeder loading, device reset, network reconfiguration, SNMP writes or a generic command method through this first bridge.

Session locking/finalization is real device communication even though it does not feed paper. Only release a session this operation acquired. Preserve a primary query error if cleanup also fails, and report cleanup warnings. Keep discovery, settings-read success and actual scan readiness as separate results. The FF-680W can advertise a service while still rejecting a session or being owned by another client.

## Preserve WebUSB as its own transport

Electron documents WebUSB device selection through the session's `select-usb-device` event, permission checks and device permission handlers. The existing renderer can retain `navigator.usb`, but Electron must implement its chooser/permission policy. Scope it to the intended app/main frame and FF-680W VID/PID `04b8:016b`; a broad handler returning true for all USB requests is unsuitable. Only choose a device following the explicit Connect action, and require an actual choice when multiple matching devices exist. Cancel unexpected selection requests. [Electron device access](https://www.electronjs.org/docs/latest/tutorial/devices#webusb-api)

Install permission handlers on the same session used by the window. Use the same narrow checks for request/check/device-selection paths, and reject unrelated permissions by default. A selected device registry should govern reuse. Electron's default granted-device permission is in memory; persistent application sessions do **not** automatically imply persistent USB grants. Any persisted grants need explicit app policy, reliable device identity and a revocation path. [Session permission and device handlers](https://www.electronjs.org/docs/latest/api/session)

`secure: true` is necessary setup, not runtime proof that this exact custom-scheme WebUSB path works. Verify `isSecureContext`, `navigator.usb`, the selection event, grant/reuse behavior, descriptor/interface claiming and disconnect cleanup in the pinned Electron release. Do not introduce blocklist bypasses or disable web security to make ordinary FF-680W access work.

## CSP and existing image/OCR workers

The current static server keeps the document's `connect-src 'none'`. It separately gives the local OCR worker narrowly scoped access to `/vendor/ocr/` and permits WebAssembly compilation there. Preserve this separation in the custom handler rather than broadening the main renderer policy to arbitrary networks.

Suggested document policy:

```text
default-src 'self'; script-src 'self'; style-src 'self';
img-src 'self' blob:; worker-src 'self'; connect-src 'none';
object-src 'none'; base-uri 'none'; frame-ancestors 'none'
```

For the exact local OCR worker script response, adapt the existing worker policy to the actual app origin:

```text
default-src 'none'; script-src 'self' 'wasm-unsafe-eval';
connect-src app://scanner/vendor/ocr/; object-src 'none'
```

These are proposed policies to verify, not claims of a successful Electron run. Serve JS, WASM and compressed language data with correct MIME/headers. Test module-worker imports, classic worker `importScripts`, local core/language fetch, IndexedDB OCR caching and Blob image decoding. The existing `workerBlobURL: false` avoids needing blob worker creation. Keep scripts/core/data bundled; no CDN fallback and no renderer `unsafe-eval`. Native Bonjour/TCP operations happen through IPC and need no renderer `connect-src` exception.

## What Local Network Access means here

For an ordinary website, LNA is permission for requests from the site to local devices, not permission to enumerate Bonjour services or open arbitrary TCP sockets. CORS still determines whether JavaScript can read another HTTP server's responses. Supported Chrome can relax HTTPS-to-HTTP mixed-content restrictions for declared local targets after permission; that does not turn Epson port 1865 into an HTTP API. [Chrome LNA explanation](https://developer.chrome.com/blog/local-network-access), [Current LNA specification](https://wicg.github.io/local-network-access/)

Electron main's Node Bonjour/TCP code supplies the missing native transport and does not depend on renderer fetch or CORS. macOS local-network permissions and the device's own availability still apply. Enabling Electron is an architecture change that the user authorized, not a browser permission setting that fixes the existing website's missing APIs.

## Verification priorities

Before presenting the desktop bridge as working, verify the custom origin's storage persistence, workers/OCR and USB permission integration; then verify bounded native discovery and a no-feed settings read. Negative cases should cover unauthorized sender/child frame, unknown registry ID, attempts to inject addresses or commands, traversal, malformed mDNS/TXT/replies, timeout and cleanup. Keep the first LAN controls named **Discover scanners** and **Read network settings**, with scan readiness accurately reported as unverified until an actual LAN job succeeds.

## Follow-up: streamed network scan and cancellation

Reviewed the proposed `scanNetwork(id, options, onImage, signal)` design on 2026-10-11. At the source snapshot inspected, main/preload exposed discovery and settings reads only; this is an integration design and test matrix, not a claim that newly added acquisition code passed review.

Keep `AbortSignal` in the renderer TypeScript driver. Do not transport it through `contextBridge`: the bridge supports copied/proxied values, not a shared live EventTarget. Expose a narrow start/scan wrapper plus cancellation by job token. The renderer attaches/removes its own signal listener. Only plain validated options, strings, numbers, bounded byte arrays and the image callback cross the boundary. [Supported contextBridge types](https://www.electronjs.org/docs/latest/api/context-bridge#parameter--error--return-type-support)

An invoke whose promise represents the whole job plus one fixed page-event channel is sufficient. Preload installs its listener before invoking start, filters correlation tokens and page sequence, wraps away the Electron event, and awaits the callback before acknowledging storage. Do not expose raw event/channel APIs to the renderer. Use a main-issued token with a start handshake, or a strictly validated preload-issued correlation nonce; it is never a replacement for creator frame authorization. [Electron event handling](https://www.electronjs.org/docs/latest/api/ipc-renderer)

Main revalidates the actual authorized main frame for start, ACK and cancel. Bind the active job to the initiating frame/document and WebContents. Navigation, reload or destruction ends that owner's job even when the replacement page has the same app origin. IDs resolve only in the current discovery registry, pin the vetted numeric address, and expire as settings IDs do. Acquisition validates option ranges/capabilities and device identity; the renderer supplies no endpoint, frames, raw command, storage path or timeout overrides.

Keep exactly one unacknowledged page. ACK must match active token, owner and pending integer sequence; reject or ignore duplicate/stale/unexpected ACKs. A filename may be display metadata but must not be a main-side filesystem target. Preload ACKs only when the image callback's IndexedDB transaction has committed, not merely when a Blob exists. Count acquired images and persisted images separately; a later failure must retain earlier saved pages. Bound page bytes, aggregate job bytes, result counters and the ACK wait (for example 20 seconds). This bounds queued work even if storage freezes.

When the callback rejects, preload sends NACK/cancel, retains the original storage error, and rejects the renderer scan with that error after native termination. Never acknowledge a failed save or let native cancellation overwrite the save failure. A success/failure completion envelope should carry plain `ok`, error message/code, acquired/persisted counts and cleanup warnings; Electron invoke exceptions preserve only the original message. Preload/driver may reconstruct a local Error after preserving those fields. [Electron invoke error behavior](https://www.electronjs.org/docs/latest/api/ipc-main#ipcmainhandlechannel-listener)

Use a single settled guard for ACK timeout, NACK, cancel, window teardown and completion. Every path removes listeners/timers and releases the operation lock in `finally`; later ACK/cancel for a completed token cannot affect another job. A normal Stop should request cancellation at the next safe protocol boundary, then use the transport's bounded CAN/FIN/unlock cleanup. A stuck socket can require destruction after a deadline; do not claim orderly device cancellation when the socket was already lost. Preserve the primary transfer/save error if cleanup fails. A settings reader's short whole-session deadline must not silently become the multi-page acquisition deadline.

Required meaningful integration tests, with mocked IPC and bounded native transport:

- Listener installed before synchronous first-page delivery; two duplex sheets arrive in order and the returned promise resolves only after all page callbacks/ACKs complete.
- Holding the first callback open prevents a second image delivery; its ACK occurs only after commit. No full-job image accumulation in main.
- Callback failure on a later page preserves earlier saved pages, sends one NACK/stop, returns the original failure and reports cleanup warnings.
- Wrong sender/frame, unknown/expired scanner ID, arbitrary host/frame options, wrong token and wrong sequence cannot acknowledge or control a job.
- Duplicate ACK and late ACK/cancel do not advance or cancel a subsequent job; concurrent starts obey the global/per-device ownership policy.
- Already-aborted signal starts no acquisition; cancellation during transfer, pending ACK and finalization all settle once and clear resources.
- Renderer reload, same-origin navigation, crash and window destruction abort the initiating document's native operation and release a pending ACK wait.
- ACK timeout, malformed frame/declared length, unexpected close, feeder empty, cancellation cleanup failure and finalization error preserve accurate partial counts.
- A successful follow-up job proves lock/listener/timer cleanup after each failure; no false successful completion or automatic retry that feeds more paper.

## Follow-up: packaged macOS identity and EHOSTUNREACH

Read-only local inspection found the packaged `ScanStudio` executable and development Electron executable have the same arm64 build UUID, `4C4C44AF-5555-3144-A1E7-7E571B4F50E9`. The packaged app reports ad hoc signing and no TeamIdentifier. Current packaging already supplies `NSLocalNetworkUsageDescription` and `NSBonjourServices: ['_scanner._tcp']`; missing plist keys are no longer the only suspect.

Apple warns that distinct apps sharing a main executable UUID can inherit incorrect network constraints. Its supported fix is a distinct source-built main executable, adding unique code if necessary, followed by UUID verification; renaming/resource reskinning does not achieve this. Apple offers no command to reset LC_UUID after building, and the signature covers it. [Apple TN3178](https://developer.apple.com/documentation/technotes/tn3178-checking-for-and-resolving-build-uuid-problems)

Apple recommends an Apple-issued signing identity for reliable local-network permission tracking. A terminal launch being usable is not a standalone-app permission proof. An `EHOSTUNREACH` error alone cannot prove local-network denial; use native DNS-SD PolicyDenied or Network.framework diagnostics where available. On this Mac's 27.0.1, do not assume the permission-reset buttons documented for 27.2 exist. [Apple TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)

If a properly built/signed single app copy still has no prompt or settings entry, use a clean-user/VM reproduction and log the exact local operation; submit that bounded reproduction and diagnostic evidence to Apple. Apple DTS recommends this isolation path for current no-prompt cases. Do not delete system privacy databases, disable SIP, globally exempt network ranges, or introduce a helper solely to evade app attribution. [Apple DTS discussion](https://developer.apple.com/forums/thread/814226)
