# Bringing SANE's useful parts into a browser-only FF-680W app

2026-10-11. Downloaded and inspected official source and npm artifacts; did **not** execute the downloaded library or scan through SANE/WASM. References are ignored under `references/`. Recommendation: keep the working direct WebUSB transport and implement the FF-680W core in TypeScript; reuse SANE's proven protocol behavior and option model. An optional SANE/WASM adapter is useful later for other scanner families, but the published package is not a drop-in replacement for our measured duplex, one-sheet and repeat-job behavior.

## What the published package actually includes

The [official npm registry](https://registry.npmjs.org/sane-wasm) reports latest `sane-wasm@0.5.0`, published 2025-07-01, package source commit `067b5576f1dde4433c17a29fa6bbaba762c021a8`. Its [submodule pins](https://github.com/goncalomb/sane-wasm/tree/067b5576f1dde4433c17a29fa6bbaba762c021a8/deps) are:

- SANE backends `32f335d0f1bb9f4fa25fdab722d0201043614df3` (2023-12-12 commit).
- libusb `cc3df7760926bd98358e3d2c76c1511fe7861365`.
- libjpeg-turbo `be96fa0a403e5d084719757f7b8241d20393246d`.

The inspected binary contains `epsonds`, its API symbols and `FF-680W`. The pinned source maps USB `04b8:016b` to FF-680W/LUT 2 ([epsonds.c:1243](../references/sane-wasm-pinned/backend/epsonds.c:1243)); its device table marks USB support complete ([epsonds.desc:267](../references/sane-wasm-pinned/doc/descriptions/epsonds.desc:267)). This establishes inclusion, not tested browser compatibility on this computer.

The git repository's current HEAD is `c1aea0085d9f1af3f0faadd0120151c01bbe717d`, which differs from the npm build even though package.json still says 0.5.0. Do not substitute HEAD behavior for the published artifact.

## API and concrete limitations

| Capability | Published package evidence and consequence |
|---|---|
| All exposed backend options | `sane_get_option_descriptor`, get/set/auto option calls expose type, unit, range/list constraints, INACTIVE/ADVANCED/AUTOMATIC capabilities and reload flags. [options.js:21](../references/sane-wasm-npm/package/dist/options.js:21) enumerates options; line 95 reloads descriptors when settings change. This is a good model for a dynamic TS settings UI. It exposes SANE backend options, not every Epson ScanSmart/FastFoto software feature. |
| Low-level frames/batches | `sane_start`, `sane_get_parameters`, `sane_read`, `sane_cancel` are available. A custom wrapper can repeatedly start/read sides and pages until NO_DOCS. Only one open device handle is supported. SANE output is decoded raster, rather than the original scanner JPEG. |
| High-level reader | [readers.js:111](../references/sane-wasm-npm/package/dist/readers.js:111) treats the first EOF as finished, then calls sane_cancel; line 116 explicitly leaves document-feeder/multi-page handling TODO. Readers are single-use. Using this helper unchanged risks ending before the buffered duplex back or next sheet. |
| Image conversion | [readers.js:218](../references/sane-wasm-npm/package/dist/readers.js:218) supports GRAY/RGB, 1/8 bits, known positive dimensions, last_frame=true. It converts scanlines to RGBA and allocates a complete RGBA image at line 241. This is useful for raster display but adds memory beyond SANE's own JPEG/raster page buffers. |
| One physical sheet | No `#PAG` command exists in the pinned epsonds source, and the public API has no arbitrary ESC/I-2 command hook. Cancelling after one returned image is not the same as an on-device physical sheet limit; duplex has two returned images and the feeder may run ahead. Preserving our validated PAG=2 duplex behavior requires a backend patch/custom build or direct TS parameters. |
| Crop and repeat jobs | Pinned [epsonds.c:2362](../references/sane-wasm-pinned/backend/epsonds.c:2362) resets crop on geometry changes; its ADF source at line 2901 sends CRP without PEDT. FF-680W [MR !919](https://gitlab.com/sane-project/backends/-/merge_requests/919) is absent. Its cancel at line 3631 merely sets a flag, lacking the newer master's FIN/relock/RESA reset. Neither current model-specific behavior should be assumed in the npm binary. |

## Deployment and build footprint

Measured package: 4,373,607-byte compressed tarball; 10,474,535-byte unpacked package; `libsane.wasm` 10,082,032 bytes; loader/runtime JS 262,465 bytes; worker JS 6,933 bytes. The [published loader](https://github.com/goncalomb/sane-wasm/blob/067b5576f1dde4433c17a29fa6bbaba762c021a8/lib/loader.js) defaults to jsDelivr, but its loaderURL can point to same-origin static files. No scanner backend service is required.

It uses shared WASM memory and pthread workers, so deployment needs cross-origin isolation headers COOP/COEP for SharedArrayBuffer ([Emscripten official requirements](https://emscripten.org/docs/porting/pthreads.html)). This is static hosting configuration, not a scanning backend, but limits hosts that cannot set headers. The published [build script](https://github.com/goncalomb/sane-wasm/blob/067b5576f1dde4433c17a29fa6bbaba762c021a8/build.sh) compiles USB-supporting backends, excludes genesys, and uses Asyncify/pthreads/memory growth. Its Dockerfile pins Emscripten 3.1.50, plus autotools/libtool/gettext/pkg-config; CMake builds libjpeg-turbo. A lean epsonds-only build is possible but requires a maintained build and our crop/PAG/lifecycle patches.

## Reusable parts and recommendation

Implement a TS capability/option registry with types, units, bounds/lists, dependencies and disabled reasons; redraw constraints after source/mode changes. Carry over CAPA-gated controls, protocol-error interpretation, bounded image transfers, independent duplex buffers, JPEG decode validation and dimensions, line-art conversion when requested, and truthful job-end/cancel handling. Retain the hardware-confirmed FIN-only session completion, omit unadvertised LOAD, and preserve on-device PAG counts. Browser-native image decoding/canvas can provide raster transforms without porting libjpeg or SANE's C ring wholesale. WASM remains useful selectively for expensive OCR/image filters, or as a later multi-scanner adapter behind the same app interface.

## Implemented browser path

The [TypeScript app](../web-app/README.md) now runs acquisition without an
application backend. It uses capability-driven option constraints, bounded
binary/image handling, independent duplex assembly, FIN-only completion,
CAPA-gated LOAD, browser JPEG validation and per-image durable storage. It retains
the measured on-device sheet count. Parameter bytes match 14 frozen Python
profiles; 65 tests pass. A real color duplex one-sheet 200 dpi job survived reload
and exported an independently verified ZIP; see [validation](browser-only-validation-2026-10-11.md).

Next additions: arbitrary validated geometry, line-art conversion, PDF/TIFF,
rotation and blank-page processing. Evaluate SANE RGB tables/matrix against a
known color target before changing default appearance. OCR/heavier processing
can use local WASM without replacing USB. SANE/WASM remains a later multi-scanner
candidate needing a patched backend and custom batch wrapper.

## Source licenses and attribution

The package advertises `GPL-2.0+ OR LGPL-2.1+` for its wrapper. SANE's [LICENSE](https://gitlab.com/sane-project/backends/-/blob/32f335d0f1bb9f4fa25fdab722d0201043614df3/LICENSE) says file notices override its general description and not every backend has a linking exception. The epsonds files inspected carry **GPL version 2**, Tower Technologies 2015, Alessandro Zummo, with no linking-exception notice. Do not assume choosing the wrapper's LGPL alternative relicenses epsonds. Preserve notices/license text and a pinned provenance record for copied or translated code/tables; a mechanical TS translation does not remove the source license. Independently implementing protocol behavior and the public SANE option/API concepts differs from copying implementation code. Before distributing a copied backend/WASM build, inventory all included licenses and supply corresponding source/build modifications as required by those licenses. This report records source notices rather than determining an application's final legal status.
