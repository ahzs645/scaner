# Network scanning from the backend-free browser app

Research date: **2026-10-11**. This is a browser/platform assessment, not a new device test. No scanner connections, scans, browser sessions, or configuration changes were made for this research.

## Conclusion

The ordinary static browser app can use a **known HTTP(S) scanning endpoint** if that endpoint is compatible with browser requests. It cannot directly browse Bonjour/mDNS or open Epson's arbitrary TCP scanning connection. Granting Chrome local-network permission does not add those APIs. An installed Isolated Web App (IWA) can expose TCP/UDP and multicast, but that is a distinct application/distribution model.

For this FF-680W, the existing local README records an Epson `_scanner._tcp` service on port 1865 and proprietary `IS` frames. Those are historical observations, not proof of the current device state. The same notes say `_uscan._tcp` was absent in that test window. **Native eSCL support, its path/port, and its CORS behavior remain unverified.** A WebConfig administration page alone is not evidence of an HTTP scan API. [Existing device observations](../README.md#cli)

## What the browser can actually do

| Capability | Ordinary HTTPS page / regular PWA | Installed IWA with permissions | Local/native bridge |
| --- | --- | --- | --- |
| Fetch a known scanner HTTP API | Yes, subject to CORS, local-network permission, CSP and transport support | Yes; raw sockets offer another implementation route | Yes |
| Resolve a supplied `.local` hostname | Possible through the platform resolver; not service enumeration | Possible; can also implement discovery | Possible |
| Browse `_scanner._tcp`, `_uscan._tcp`, `_uscans._tcp` | No standard browser service-browse API | Implement mDNS using multicast UDP | Native DNS-SD/Bonjour tools |
| Send proprietary Epson traffic to TCP 1865 | No raw TCP API | Possible with `TCPSocket`; protocol still needs implementation | Possible |
| Send UDP discovery or SNMP | No raw UDP API | Possible with `UDPSocket` | Possible |
| Keep all page processing/storage local | Yes | Yes | Yes, if designed to do so |

Google's Direct Sockets documentation, updated **2025-12-17**, explicitly distinguishes regular web protocols from raw TCP/UDP exposed to IWAs. It also documents multicast and the manifest permissions `direct-sockets`, `direct-sockets-private`, `direct-sockets-multicast`, and `cross-origin-isolated`. [Direct Sockets documentation](https://developer.chrome.com/docs/iwa/direct-sockets)

An old `navigator.getNetworkServices()` proposal is not a deployment path: W3C discontinued the Network Service Discovery specification. The shelving decision was recorded on **2017-01-10**. [Current W3C status](https://www.w3.org/TR/discovery-api/), [W3C decision](https://lists.w3.org/Archives/Public/public-device-apis/2017Jan/0000.html)

Epson TCP cannot be substituted with `new WebSocket("ws://scanner:1865")`: a WebSocket peer must perform the WebSocket handshake and framing. The existing native Epson greeting is a different protocol. This is a protocol incompatibility, not an address-discovery problem. [WebSockets standard](https://websockets.spec.whatwg.org/#connections)

## Local Network Access is helpful, but separate from CORS

Chrome's announcement was published **2025-06-09** and updated **2025-09-29** to identify Chrome 142 as the launch. Its supported local-network request path can exempt private-IP literals and `.local` HTTP URLs from mixed-content blocking when permission is granted. A custom hostname can use `targetAddressSpace: "local"` to declare the intended address space. Consequently, “an HTTPS site can never contact an HTTP LAN scanner” is too broad for current Chrome. This behavior must still be tested in the actual browser/version. [Chrome announcement](https://developer.chrome.com/blog/local-network-access)

The current LNA draft, dated **2026-08-07**, uses separate `local-network` and `loopback-network` permission names. It treats origins already on loopback differently from a public site contacting a LAN device. These are access restrictions, not a device picker, DNS-SD browser, certificate bypass, or CORS waiver. [LNA draft](https://wicg.github.io/local-network-access/)

Google's current implementation guidance recommends a user-initiated first connection, handling permission-query differences, and ordinary CORS headers for readable responses. It says LNA replaces the paused Private Network Access preflight effort; old `Access-Control-Allow-Private-Network` headers should not be treated as the solution. A loopback development page is not a sufficient reproduction of every permission restriction of a public HTTPS deployment. [Google implementation guidance](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/security/local-network-access.md)

For cross-origin eSCL, CORS must permit reading capabilities, job responses, and image data. XML `POST` and cancellation `DELETE` normally require ordinary OPTIONS preflights. The server must allow the relevant methods and headers, and expose a job's `Location` response header if the client needs it. `mode: "no-cors"` produces an opaque response and cannot supply usable XML, job URLs, or image bytes. Authentication with credentials requires additional CORS cooperation. These conditions follow the Fetch standard; accepting LNA does not change them. [Fetch CORS protocol and response filtering](https://fetch.spec.whatwg.org/#http-cors-protocol)

HTTPS endpoints still need certificates accepted by the browser. JavaScript cannot suppress a scanner's certificate failure. An HTTP device can be considered only where the browser's local-network mixed-content path permits it; otherwise use trusted HTTPS or a different architecture.

## eSCL / AirScan: exact feasible conditions

Mopria describes eSCL as an interface for controlling a scanning engine from multiple classes of clients. This establishes that eSCL is a scanning protocol, but does **not** establish this FF-680W's support or browser-readable CORS. [Mopria specification overview](https://mopria.openwebportal.com/specifications)

The open-source SANE AirScan client distinguishes `_uscan._tcp` / `_uscans._tcp` as actual scanner endpoints and `_scanner._tcp` as a discovery hint. Thus discovering the latter must not automatically select eSCL. [SANE AirScan source](https://github.com/alexpevzner/sane-airscan/blob/master/airscan.h)

NAPS2.WebScan demonstrates a browser JS/TS eSCL client, but its scanner endpoint is provided by an installed local service. Its service source deliberately sets `ServerAllowAnyOrigin` and specifies a port because browser discovery is unavailable. This is useful architectural evidence, not evidence that native Epson firmware already accepts browser clients. [NAPS2.WebScan](https://github.com/cyanfish/naps2-webscan), [Service source](https://github.com/cyanfish/naps2-webscan/blob/master/NAPS2.WebScan.LocalService/Worker.cs)

A truly backend-free **ordinary web** implementation is feasible only if all of the following are established:

1. The scanner exposes a usable HTTP(S) scan protocol, such as eSCL, not only a configuration web page or Epson raw TCP.
2. The app knows the actual endpoint URL from user input, saved configuration, or an out-of-browser discovery result.
3. The browser permits that request: secure app context, appropriate LNA permission where applicable, compatible HTTP/HTTPS handling, accepted certificates, and app CSP permitting the selected origin.
4. The device permits cross-origin capability reads, scan-job creation, image reads, and cancellation, including required preflight responses and exposed job headers.
5. The returned capabilities actually include the needed feeder, color, duplex, resolution, image formats and limits. Job/image transfer and cancellation are tested against this unit.

These are necessary compatibility conditions. Adding a manual IP field alone resolves only item 2. A readable `/eSCL/ScannerCapabilities` response is a useful first read-only check; it does not by itself verify job creation or scanning.

## IWA and bridge alternatives

An IWA could retain the TypeScript UI and processing while implementing Epson TCP framing and mDNS multicast inside the installed app. This can be backend-free at runtime. It still requires packaging, installation, permissions, and any device-protocol/TLS implementation; a normal PWA install does not turn on IWA-only sockets. Google's Telnet IWA demonstrates direct client-to-server communication and signed-bundle/developer-proxy installation. [Chromium IWA model](https://www.chromium.org/blink/launching-features/isolated-web-apps/), [Google Telnet demo](https://github.com/GoogleChromeLabs/telnet-client)

Do not promise ordinary production IWA installation on this Mac from old examples alone. Current Chromium policy source inspected on the research date lists force installation as supported on ChromeOS 128+, with general desktop Chrome listed as future support. The user-installation policy lists ChromeOS 146+. Developer-mode experiments are a separate avenue and must be verified for the actual Mac/Chrome build. [Force-install policy](https://github.com/chromium/chromium/blob/main/components/policy/resources/templates/policy_definitions/Miscellaneous/IsolatedWebAppInstallForceList.yaml), [User-install policy](https://github.com/chromium/chromium/blob/main/components/policy/resources/templates/policy_definitions/Miscellaneous/IsolatedWebAppUserInstallationEnabled.yaml)

A loopback/native bridge can discover Bonjour services and speak Epson TCP while presenting a browser-compatible HTTP or WebSocket API. It preserves the browser UI and local processing, but is **not** the requested backend-free ordinary website. NAPS2's eSCL sharing service is one established example of that category.

## Proposed next step

First establish this scanner's actual advertised services and perform read-only native HTTP capability/header probes. If eSCL exists, test the same capability URL from the ordinary app's intended deployed origin, then verify preflight/job-header compatibility before implementing a job client. If only Epson TCP exists, make the choice explicit: an IWA experiment or a local bridge. There is no ordinary-page API setting that simultaneously supplies raw Epson TCP and Bonjour browsing.
