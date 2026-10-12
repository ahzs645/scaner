# Browser scanning research

Researched 2026-10-11. This note is research, not a browser/hardware validation result.

## Answer for this scanner

The existing custom transport uses bidirectional bulk USB and ESC/I-2, not a serial port. **WebUSB is the appropriate direct browser transport; Web Serial is not.** Chrome describes Web Serial as access to actual serial ports or USB/Bluetooth devices emulating one. A USB vendor/product filter does not turn an arbitrary USB peripheral into a serial port. [Chrome Web Serial documentation](https://developer.chrome.com/docs/capabilities/serial)

On this Mac, direct browser scanning is a realistic experiment. Google documents that macOS WebUSB can claim interfaces when no kernel driver or other application owns them. Epson Scanner Monitor, ScanSmart, FastFoto, Image Capture, and the Python driver must release the scanner first. A successful device chooser selection alone does not prove the interface can be claimed or the scanner protocol is supported. [Chrome platform requirements](https://developer.chrome.com/docs/capabilities/build-for-webusb)

WebUSB requires a secure context and a user action to open its device chooser. The browser APIs expose configuration/interface selection and transfers; they do not provide scanner settings or image decoding automatically. [Chrome WebUSB documentation](https://developer.chrome.com/docs/capabilities/usb)

## Existing implementations

| Project | Architecture | Relevance and limitations |
| --- | --- | --- |
| [sane-wasm](https://github.com/goncalomb/sane-wasm) and [WebScan](https://github.com/goncalomb/webscan) | SANE backends compiled to WebAssembly, with a libusb-to-WebUSB bridge | Actual direct browser USB document/image scanning; WebScan exposes backend scanning options. The project excludes some backends, so device support must be checked in the build actually used. |
| [scanservjs](https://github.com/sbs20/scanservjs) | Browser UI → Node server → SANE → USB/network scanner | Existing multipage, duplex collation, cropping, output formats, and OCR. It requires a Linux host or a VM with USB passthrough; its documented installation is not a native Mac app. |
| [NAPS2.WebScan](https://github.com/cyanfish/naps2-webscan) | Browser JS/TS → HTTP eSCL service → NAPS2 SDK → local scanner driver | The sample local service targets Windows, with a cross-platform concept. It documents reading successive documents for feeder batches. It is a bridge rather than raw browser USB. |

The SANE revision currently pinned by sane-wasm is `c7e4b5e35e3d614d2b1181d760a717bfc395a203` (checked through GitHub's repository API). Its `epsonds` device description explicitly lists **FF-680W, USB 04b8:016b, status complete**. This makes the existing WebScan demo a credible experiment, but does not establish that its deployed WASM build can successfully scan this Mac's unit. [Pinned SANE source](https://gitlab.com/sane-project/backends/-/raw/c7e4b5e35e3d614d2b1181d760a717bfc395a203/doc/descriptions/epsonds.desc)

There is also recent model-specific work: a May 2026 SANE merge request reports FF-680W USB testing on Debian and fixes automatic crop/paper-end detection behavior, including duplex command examples. This is evidence that people have worked on this scanner's protocol and edge cases, not proof of complete feature parity with Epson software. Check merge/release inclusion before assuming a particular installed backend contains the fix. [FF-680W auto-crop work](https://gitlab.com/sane-project/backends/-/merge_requests/919)

An emerging `navigator.scanners` proposal exists, but its authors explicitly describe an early design that has not been approved to ship in Chrome. It should not be used as an available API for this project. [Web Scanning explainer](https://github.com/explainers-by-googlers/web-scanning)

## Practical paths for this project

1. **Fastest local browser UI:** serve the UI and an API together on loopback; keep the working Python USB transport and scan implementation. The server owns one scanner session at a time and returns capability data, progress, and page files. This avoids rewriting the validated ESC/I-2 implementation and permits browsers without WebUSB. Bind to `127.0.0.1`; validate Origin, require a per-launch token for mutations, and avoid permissive CORS. These are proposed implementation choices, not existing features.
2. **Direct USB with existing code:** test WebScan/sane-wasm after releasing Epson clients. First verify selection, interface claim, detection, and capability enumeration; then test one ordinary sheet, duplex, two-sheet batch, and cancellation. Keep paper-count limits explicit: duplex yields two images per physical sheet.
3. **Custom direct WebUSB implementation:** port the Python transport/session/framing and image handling to JavaScript or WASM. Query capabilities rather than copying a universal settings list. Derive endpoint numbers from actual descriptors; do not copy Arduino example endpoints or CDC control commands. Preserve short-transfer handling, cleanup, errors, cancellation, page ordering, and device exclusivity. JPEG output can become Blob-backed previews/downloads, but page assembly remains protocol-specific.

The Mac hardware/browser trial is still needed before calling either direct-WebUSB path working. No browser was launched, permissions requested, scanner interface claimed, or paper consumed by this research.


## Later local implementation evidence

The research-only statements above describe the initial investigation. The
custom WebUSB UI subsequently captured a 200-dpi one-sheet duplex pair, a
300-dpi cropped two-sheet batch, and a controlled two-sheet stack in two
separate one-sheet jobs. See [live validation](live-validation-2026-10-11.md).
The existing WebScan/sane-wasm demo itself was not hardware-tested here.
