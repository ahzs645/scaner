# Scan Studio desktop network prototype

This Electron shell reuses the static browser interface, drivers and image
pipeline. The renderer remains sandboxed with context isolation and no Node
integration. Two narrow preload calls let the main process discover supported
FF-680W Bonjour advertisements and read device settings. The renderer cannot
choose arbitrary addresses, commands or socket operations.

```sh
cd scaner/web-app
npm install
npm run desktop
```

Electron is pinned to 44.7.0. On a clean installation its official runtime may
be downloaded when first run. `npm run test:desktop` rebuilds and runs the desktop
unit tests. The ordinary HTTPS/localhost website remains usable independently;
its deployment includes only `dist/`, with no Electron runtime.

A local macOS app can also be built with `npm run package:desktop`. The generated
`desktop-output/Scan Studio-darwin-arm64/Scan Studio.app` bundles the runtime,
static assets, source and licenses. It uses a local ad-hoc signature and declares
the exact Bonjour service plus the purpose of local-network access. Distribution
with Developer ID signing/notarization remains separate.

The desktop controls find FF-680W scanners through `_scanner._tcp`, then connect
using a validated discovery target and private LAN IPv4 address. **Connect network
scanner** reads INFO/CAPA/RESA/STAT. The shared **Scan loaded sheets** button then
uses the selected USB or network driver, with the same options, local page storage,
editing and exports. A real network job completed on 2026-10-11: one sheet, color,
both sides, 200 dpi, two RGB JPEGs, no cleanup warnings. Each streamed page is
acknowledged only after its IndexedDB transaction commits.

This shell starts no HTTP/TCP bridge server. Bonjour uses bounded native mDNS
service discovery; settings use an outbound TCP connection. It serves bundled
assets from a stable secure `scan-studio://app/` origin. OCR worker policy permits
only its bundled assets, while the renderer retains `connect-src 'none'`.
Electron uses its own persistent IndexedDB profile; Chrome jobs and USB grants
do not automatically migrate. Export existing scans from the original browser
for durable copies.

[Protocol, driver design and remaining scan validation](../../docs/network-driver-design.md)
and [browser Local Network Access limits](../../docs/network-browser-feasibility.md)
distinguish discovery, settings access and real acquisition. This is a local
prototype, not a Developer ID signed/notarized distributable application.


The packaged macOS app now uses a source-built distinct main executable linked
in process to the pinned Electron framework. Its UUID differs from stock Electron;
helpers and renderer security remain unchanged. See [native build notes](native/README.md).
The earlier independently launched bundle reported EHOSTUNREACH; the rebuilt bundle
also reports EHOSTUNREACH on this Mac. Its saved-job loading works, but standalone
network permission/signing attribution remains unresolved. Use `npm run desktop`
for the verified network-scanning path. No macOS privacy
or firewall settings were changed.
