# FF-680W network discovery and scanning research

2026-10-11. Source/doc inspection only: no scanner network queries, pairing writes, packet capture, UI actions or third-party software execution were performed by this research agent. Newly downloaded references remain ignored under `references/`.

**Most useful route:** Epson's proprietary plain-TCP ESC/I-2 transport plus the FF-680W's paired button/job-preparation workflow. `epson2paperless` now has exact-model captures and a TypeScript implementation. Generic eSCL/WSD support is not established for this unit. An ordinary browser page cannot replace WebUSB with raw TCP/UDP discovery; network support needs an explicitly selected local socket-capable helper or an installed-app transport.

## Existing local evidence: preserve the dates

[research.md](../docs/research.md:135) contains earlier 2026-04-03 hardware observations: `_scanner._tcp` resolved the FF-680W on TCP 1865, an Epson `IS` welcome arrived, the generic SANE lock received EOF, and ScanSmart first attempted a failing TLS connection before another connection. Historical TXT/SNMP showed an unavailable/owned session and a paired host. These describe that earlier state; they do not prove the scanner is currently busy or requires TLS.

Parent's **new bounded, read-only discovery on 2026-10-11** finds the same FF-680W `_scanner._tcp` endpoint on 1865 with `scannerAvailable=1`. No `_uscan._tcp` advertisement appeared in that short window. Discovery availability is not scan validation, and a missing advertisement during one bounded browse does not prove a protocol is absent.

The historical [HTTP investigation](../docs/research.md:364) received 404 or 500 from candidate eSCL paths. Neither response supplies the ScannerCapabilities XML needed to claim eSCL support; the older interpretation that 500 suggests a hidden service remains an inference. Current greeting/HTTP results should be recorded separately when available.

## Current upstream SANE epsonds: useful framing, incomplete model proof

Inspected commit `36c87fc33d91ebd60f70a0934f2e44ffd9a818d2`:

- [epsonds-net.c:478](https://gitlab.com/sane-project/backends/-/blob/36c87fc33d91ebd60f70a0934f2e44ffd9a818d2/backend/epsonds-net.c#L478) browses `_scanner._tcp` using Avahi; its resolver accepts Epson announcements and reads `mdl=`. [epsonds.c:1450](https://gitlab.com/sane-project/backends/-/blob/36c87fc33d91ebd60f70a0934f2e44ffd9a818d2/backend/epsonds.c#L1450) opens TCP 1865 and then locks.
- [epsonds-net.c:196](https://gitlab.com/sane-project/backends/-/blob/36c87fc33d91ebd60f70a0934f2e44ffd9a818d2/backend/epsonds-net.c#L196) builds 12-byte `IS` headers; passthrough type 0x2000 adds an 8-byte outgoing/expected-response length header. [Line 249](https://gitlab.com/sane-project/backends/-/blob/36c87fc33d91ebd60f70a0934f2e44ffd9a818d2/backend/epsonds-net.c#L249) sends 0x2100 with seven lock bytes; unlock uses 0x2101. This is a wrapper around scan commands, distinct from HTTP.
- [epsonds-tcp.c:26](https://gitlab.com/sane-project/backends/-/blob/36c87fc33d91ebd60f70a0934f2e44ffd9a818d2/backend/epsonds-tcp.c#L26) tries a plain welcome first; failure reconnects with OpenSSL when compiled in. That fallback is generic backend behavior, not evidence the FF-680W uses TLS. It has no FF-specific paired button/JobList preparation identified here.

SANE's device table marks FF-680W USB complete, while its manual's old network wording and source network implementation differ. Neither should be promoted into a tested FF-680W network claim. Source framing is reusable; successful acquisition still needs a model-specific session test.

## Exact-model TypeScript implementation: epson2paperless

Pinned source `bf64ee0f1774ddc8aca1c3c6713c1c7fbe1b16ca` (MIT). Its [compatibility table](https://github.com/mtheuma/epson2paperless/blob/bf64ee0f1774ddc8aca1c3c6713c1c7fbe1b16ca/README.md#compatible-printers) calls FF-680W experimental, ADF-only, with 200/300 dpi verified. This is the author's validation, not a scan performed here. Its [committed FF-680W fixtures](https://github.com/mtheuma/epson2paperless/tree/bf64ee0f1774ddc8aca1c3c6713c1c7fbe1b16ca/tools/pcap-extract/captures/ff-680w) cover 200 dpi simplex/duplex and 300 dpi simplex.

The implementation separates three channels:

| Channel | Source-derived purpose |
|---|---|
| UDP multicast `239.255.255.253:2968` | Epson announcement/destination registration. Keepalive responses echo the announcement sequence and advertise host name/event endpoint. FF-680W uses NetScanMonitor v3 format. This differs from Bonjour mDNS and WSD discovery. |
| Incoming TCP 2968 | Epson push-scan SOAP/JobList requests. Its unusual `Header : value` spacing is parsed by a raw TCP HTTP parser, rather than a standard HTTP server. |
| Outgoing TCP 1865 | FF-680W plain-TCP IS-wrapped job control and ESC/I-2 acquisition. Other Epson families in this project can use TLS; do not copy their TLS/certificate rules to FF-680W. |

These channel facts come from the [protocol reference](https://github.com/mtheuma/epson2paperless/blob/bf64ee0f1774ddc8aca1c3c6713c1c7fbe1b16ca/docs/PROTOCOL-REFERENCE.md). The important new model-specific evidence is in [startup.ts:129](https://github.com/mtheuma/epson2paperless/blob/bf64ee0f1774ddc8aca1c3c6713c1c7fbe1b16ca/src/startup.ts#L129): **JobList → dummy job commit → JobNumber → selected-job read → scan**. [job-control.ts:36](https://github.com/mtheuma/epson2paperless/blob/bf64ee0f1774ddc8aca1c3c6713c1c7fbe1b16ca/src/job-control.ts#L36) wraps JOBW/JOBR in IS type 0x2300 and checks welcome, lock ACK, job reply and unlock ACK before graceful socket close. An ordinary INFO/STAT/scan lock probe does not reproduce that flow.

Its [FF dialect:217](https://github.com/mtheuma/epson2paperless/blob/bf64ee0f1774ddc8aca1c3c6713c1c7fbe1b16ca/src/esci2/dialects/registry.ts#L217) selects CAPA fingerprint `5d4dea564bf876ff0714a167b700007bd381de839615ad8dbded0c59c53eaabd`, fixed ADF, eight initialization polls, model gamma/CMX classes and ADF-CRP parameter composition. Duplex-back rotation is explicitly marked **unverified**, so retain our independently established side orientation rather than importing that assumption.

[Button-only pairing documentation](https://github.com/mtheuma/epson2paperless/blob/bf64ee0f1774ddc8aca1c3c6713c1c7fbe1b16ca/docs/BUTTON-ONLY-SCANNERS.md) identifies one stored host name via SNMP OID `1.3.6.1.4.1.1248.1.1.3.1.10.2.5.0`; the advertised ClientName must match it. A pairing write changes where button presses go, so reading/reusing the existing name is the first comparison step. No write was made here. The README explicitly expects generic host/webhook-triggered FF-680W scans to fail because they skip panel job preparation; it is not evidence a browser Scan button already works over Wi-Fi.

## eSCL/WSD and other implementations

[sane-airscan](https://github.com/alexpevzner/sane-airscan/tree/1d8f1f80820ff3871bfe0e5eb666deea19c0540a), inspected commit `1d8f1f80820ff3871bfe0e5eb666deea19c0540a`, supports eSCL and WSD. Its [README tested-device table](https://github.com/alexpevzner/sane-airscan/blob/1d8f1f80820ff3871bfe0e5eb666deea19c0540a/README.md) includes other Epson models, including ES-580W WSD, but no FF-680W. Its eSCL discovery uses `_uscan._tcp`/`_uscans._tcp`; [WSD discovery](https://github.com/alexpevzner/sane-airscan/blob/1d8f1f80820ff3871bfe0e5eb666deea19c0540a/airscan-wsdd.c#L1912) uses multicast UDP 3702. This is an alternative only if actual FF capabilities/discovery XML proves it, not an interchangeable transport for `_scanner._tcp:1865`.

[Eppascan](https://github.com/michael-hessi/Eppascan/blob/23fb4a8f188248a49ba5bf80c1e747d5b54c5451/README.md), commit `23fb4a8f188248a49ba5bf80c1e747d5b54c5451`, is a Linux daemon around SANE scanimage, tested with ES-500WII. Its generic port/firewall notes do not prove FF-680W support; it is a weaker reference than the exact-model captures above.

## Browser boundary and next implementation step

The [Direct Sockets explainer](https://github.com/WICG/direct-sockets/blob/main/docs/explainer.md) explains that ordinary web HTTP/WebSocket/WebRTC APIs do not expose raw TCP/UDP; Direct Sockets targets Isolated Web Apps. Normal fetch cannot perform Epson IS framing on port 1865, SNMP or multicast Bonjour/NetScanMonitor discovery. CORS, private-network permissions or loosening CSP do not turn HTTP into that protocol. Even a verified eSCL endpoint would require appropriate HTTP-origin/certificate access; it would not make browser multicast discovery available.

Next useful work is offline first: import the pinned FF fixtures as data, validate bounded IS stream framing against fragmented/coalesced input, and compare JOBW/JOBR plus initialization/teardown against our existing Python frame builders. Preserve capture provenance and MIT attribution for copied code. Then use a controlled paired **button-triggered** network capture on this unit to establish a working session; do not start by guessing new pairing writes or transplanting USB cleanup ordering into a network job.

Expose network support through a separate optional socket-capable transport/driver, retaining the existing local image processors and original-page storage. A localhost helper can own mDNS/UDP/SNMP/TCP and an explicitly allowed scanner target; an installed IWA could be explored separately if avoiding that helper is essential. Both are different deployment choices from today's backend-free static WebUSB page. A browser-originated network Scan button remains a further feature: implement it only after identifying equivalent job preparation, rather than claiming the paired button path already supplies it.

## Acquisition framing follow-up: parameters and one-sheet duplex

Source inspection while preparing network acquisition identified a concrete PARA framing requirement. [SANE epsonds-cmd.c:154](https://gitlab.com/sane-project/backends/-/blob/36c87fc33d91ebd60f70a0934f2e44ffd9a818d2/backend/epsonds-cmd.c#L154) sends the 12-byte PARA request with **expected response length zero** when a parameter body follows. It then sends that body with expected length 64 at line 179. [epsonds-io.c:49](https://gitlab.com/sane-project/backends/-/blob/36c87fc33d91ebd60f70a0934f2e44ffd9a818d2/backend/epsonds-io.c#L49) carries these distinct expected lengths into the IS 0x2000 wrapper.

In the pinned FF `adf-duplex-200.jsonl`, zero-based records 128–135 explicitly show:

| Step | Outgoing IS passthrough metadata / response |
|---|---|
| PARA request | cmd_size=12, reply_size=0, `PARAx00003E8` |
| Transport response | IS 0xa000 with zero payload |
| Parameter body | cmd_size=1000, reply_size=64, body begins `#ADFCRP SKEWDPLXDFL1` |
| Command response | IS 0xa000 declaring 64 bytes, followed by `PARAx0000000#parOK` and padding |
| Start | TRDT request with reply_size=64, then its 64-byte reply |

[The TypeScript graph:739](https://github.com/mtheuma/epson2paperless/blob/bf64ee0f1774ddc8aca1c3c6713c1c7fbe1b16ca/src/esci2/graph.ts#L739) likewise sends the header/body pair with 0/64 expected sizes. Waiting for a **64-byte reply to the header before sending the body** blocks the protocol. Either consume the empty transport ACK or send the pair and skip that empty ACK while awaiting the body reply; do not mistake it for the PARA command result. TCP capture records are fragments: an IS header and its declared payload can be separate JSONL records. Retain exact-stream buffering, including coalesced frames.

The subsequent image loop sends IMG metadata with expected length 64, then a pure-read IS request with cmd_size=0 and expected length equal to the IMG header's advertised extra length. [SANE image read:1114](https://gitlab.com/sane-project/backends/-/blob/36c87fc33d91ebd60f70a0934f2e44ffd9a818d2/backend/epsonds-cmd.c#L1114) explicitly sends that network read request; simply waiting for the advertised bytes without it is insufficient.

### Initialization and fixture limits

Captured Epson host writes include outer lock, FS Y → INFO/EXI/CAPA/FIN, FS Z → STAT/INFO/CAPA/a tiny date-time PARA/RESA/FIN, eight FS Y → STAT → FIN cycles, then FS X → STAT → acquisition PARA → TRDT. These network legacy-mode switches are intentional in that capture; the separately validated USB FIN-only cleanup does not imply removing them from a network initialization sequence.

However, the [fixture README](https://github.com/mtheuma/epson2paperless/blob/bf64ee0f1774ddc8aca1c3c6713c1c7fbe1b16ca/tools/pcap-extract/captures/ff-680w/README.md#init-handshake-trim) states that five printer-to-host initialization reply packets were removed to fit its simpler graph; host writes were left untouched. The library omits EXI, extra STAT and date-time PARA. Its replay feeds replies independently of host emissions. Consequently replay success verifies selected parsing/payload behavior, not the sufficiency of a fresh host-only session or every captured initialization write. Do not hardcode the captured date-time token as a presumed scan prerequisite.

[runEsci2ScanOverPlain:251](https://github.com/mtheuma/epson2paperless/blob/bf64ee0f1774ddc8aca1c3c6713c1c7fbe1b16ca/src/esci2/scanner.ts#L251) does not call JOBW/JOBR. Those transactions belong to the earlier button/JobList handoff in startup.ts. The source's explicit host-trigger warning therefore remains important: usable INFO/CAPA via FS X establishes settings access, not that acquisition can skip all job preparation. First fix the established PARA segmentation; only a controlled acquisition result can decide whether the unit needs richer initialization or job preparation beyond it.

### One sheet means two images in duplex

The captured duplex PARA contains `#PAGd000` (all), so this fixture does **not** demonstrate a network one-sheet stop. Our FF-680W USB tests established `#PAGd002` for one physical duplex sheet, and the shared planner multiplies physical sheets by two for duplex. Network transport should preserve this parameter and receive both IMGA/IMGB images before completion, but its physical stop still needs a controlled network test. Cancelling after the first front image risks dropping the back; host file-count checks cannot prove the feeder did not advance another sheet. Keep the originals and require matching side counts plus terminal job indication before reporting completion.
