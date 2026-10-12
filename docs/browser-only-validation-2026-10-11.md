# Browser-only FF-680W validation — October 11, 2026

The new TypeScript `web-app/` scanned in Chrome through WebUSB without Python or
a scanner API. The older Python server and temporary 8766 static host were
stopped; a static-only Node host served the build on the paired origin
http://127.0.0.1:8765/.

At 12:56:55 PDT the user-loaded ordinary sheet was scanned with color RGB,
duplex, 200 dpi, Letter area, quality 90, one physical sheet, double-feed detection
enabled and crop/deskew disabled. Job ended with `lftd000`; FIN completed without
warnings. Job ID: `597516cf-1689-4b53-8fc1-e2dd7238210d`.

| File | Bytes | Decoded size | Color |
| --- | ---: | --- | --- |
| `001-front.jpg` | 695,922 | 1696 × 2200 | RGB |
| `001-back.jpg` | 607,666 | 1696 × 2200 | RGB |

Both passed native browser decoding before IndexedDB persistence. Reloading the
final build retained the complete job. Opening its history entry restored both
previews, front first. Reconnecting read live CAPA; selecting 200 dpi disabled
crop and explained its 300/600 dpi requirement. No new scan was needed for reload
verification.

The final UI-downloaded ZIP passed Python `zipfile` CRC verification. Its three
entries are `001-front.jpg`, `001-back.jpg` and `scan-job.json`. ZIP size:
1,304,600 bytes. Manifest JPEG total: 1,303,588 bytes; status complete, correct
options/dimensions/per-image counts, no warnings. Extracted JPEGs also passed
macOS `sips` RGB/dimension inspection. Local copies:
`scans/browser-only/597516cf-1689-4b53-8fc1-e2dd7238210d/` (ignored by Git).

Screenshots `webusb-backend-free-scan.png` and `webusb-backend-free-restored.png`
show initial completion and final restored results respectively.

Strict TypeScript build and all 65 tests pass. Fourteen frozen profiles check
exact Python parameter bytes across modes, geometry, DPI, sheet limits and crop.
Other tests cover CAPA constraints, interleaved multi-sheet duplex mock transfers,
terminal data, FIN/CAN/LOAD, reset exclusivity, timeout/unplug, buffer bounds,
atomic storage, durable earlier pages and independently decoded ZIPs.

This new app's hardware evidence covers the specified one-sheet job, connection,
settings, reload and ZIP. Its multi-sheet/cancel fault cases use mocks. Earlier
direct-browser/native hardware tests cover two-sheet batches and controlled
consecutive one-sheet jobs; these do not validate every new-app combination.
SANE and sane-wasm were inspected as source/artifacts, not run on this Mac.
