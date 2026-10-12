# REA scanner investigation — 2026-10-11

## Outcome and scope

The existing independent driver completed a real USB grayscale scan during this
session: the coordinating agent reported a 941,021-byte, 2544 × 3300 JPEG and
visually checked it. The initial empty `IMG ` reply did not require an additional
start command. This agent performed only offline analysis; hardware tests and
Epson application control belonged to the coordinating and official-software
agents. Color and duplex validation are separate from this grayscale result.

The historical April notes that image transfer never starts are superseded for
this tested USB configuration. They do not establish the cause of the old
failure. Repairing the copied Python environment, obtaining exclusive access
from Scanner Monitor, and using a longer polling interval all occurred in this
session; their individual effects were not isolated.

## Target identity and canonical REA evidence

Target: `/Library/Image Capture/Support/EPSON/Epson Scan 2/Core/Scanner.framework/Versions/A/Scanner`.
Full universal binary SHA-256:
`cae0ae95bc6794ffd613d893f6f3146557c1673c92b1dcd9ceea2773370e069f`.
The selected static architecture was arm64.

| Evidence | Location | What it establishes |
| --- | --- | --- |
| `ev_ab6edc299d1075c74bd38580226e67d37a3d81795e2139cf4c2af4c31cafbec3` | `rea-evidence/scanner-macho.json` | Native Mach-O identity, segments, imports, symbols, universal architectures. |
| `ev_d99b72d67c82f16b052e37d5c32bff143334ec8c5bc92cecf150ed6a8dd1962f` | `rea-evidence/scanner-dispatch.json` | Decoded Objective-C class methods, implementation addresses, ivars, and metadata coverage. |
| Derived local view of the preceding evidence | `rea-evidence/scanner-dispatch-lifecycle-view.json` | Focused scan lifecycle and double-feed methods with parent Evidence ID. |
| REA provider diagnostic, not an Evidence record | `rea-evidence/rea-providers.json` | Deep native decompilation unavailable: no configured engine; Ghidra requires an extracted 12.1.x directory and full 64-bit JDK 21+. |

The full dispatch result is retained, rather than treating a truncated preview
as canonical data. Its default 5,000-record limit was reached: several metadata
facets are partial, fixup decoding has explicit limitations, and advanced Swift
facets are unsupported. The relevant ESCI2Scanner method records were decoded;
this does not imply exhaustive control-flow analysis.

REA CLI 6.4.0 provided the portable analysis. No Ghidra, Hopper, or unrelated
packages were installed. The configured MCP integration needs a Codex reconnect
to appear in a future chat, but the CLI supported the present investigation.
No persistent native engine session was opened.

## Bounded native instruction observations

`scanner-disassembly-arm64.txt` is an ordinary `otool -arch arm64 -tvV`
capture, not REA Evidence or decompiler output. Focused subsets are saved in
`scanner-lifecycle-disassembly.txt` and `scanner-doublefeed-disassembly.txt`.
Instruction and selector observations below are static, not observed execution.
Some otool Objective-C message comments become stale when selectors are saved
in registers; follow explicit selector loads and register flow instead of
assuming every message comment is accurate. Several CFString annotations say
`bad cfstring ref` and were not used as recovered text.

- `scanInContext` at `0x41200` calls `parametersForScan`, `sendParameters:`,
  `startScanning`, then `transferImage`, with status checks between steps.
- `startScanning` at `0x38fcc` constructs `TRDT` (`0x54524454`) for
  `runSequence:paramBlock:headerInfo:dataBlock:`. Authentication-dependent
  parameter handling also exists; this scan did not demonstrate that path.
- `requestFinalize` at `0x36ec8` constructs `FIN ` (`0x46494e20`).
- `requestCancel` at `0x411b8` constructs `CAN ` (`0x43414e20`) and clears
  the internal transferring flag afterward.
- `captureScanner` / `releaseScanner` set scanner mode to 1 / 0. These names
  do not prove that either is an additional scan-start packet.
- `transferImage` issues `IMG ` and dispatches page start, image data, and
  page end to separate methods with a surface argument.
- The empty-data branch uses `NSDate dateWithTimeIntervalSinceNow:` and
  `NSRunLoop runUntilDate:`. The double loaded at virtual address `0x62690`
  is **0.1 seconds**. Its exact bytes, absolute file offset, target digest,
  and instruction references are retained in `scanner-idle-delay-literal.json`.
  This supports a 100 ms delay for empty-image polling. It does not prove the
  cause of the old failure or require a delay after every nonempty block.

## Duplex routing and termination recommendations

The SANE sources already downloaded by this task were copied into the evidence
directory as `epson-epsonds.c` and `epson-epsonds-cmd.c`; their exact upstream
commit was not established here. These are source observations, separate from
the shipped Epson implementation and the live hardware result.

`epson-epsonds-cmd.c` `img_cb` (lines 771–835) establishes:

- `#typIMGA` selects front; `#typIMGB` selects back. The side is sticky across
  blocks until another `typ` token changes it.
- `#pst` has three eight-byte numeric fields: width, dummy/padding count,
  height. It denotes the start of a page image for the selected surface.
- `#pen` with 16 value bytes denotes **page end**, not the end of a duplex job.
- Only `#lftd000` ends the scanning state; a nonzero `lft` is not terminal.
- `#atnCAN ` means cancellation, while `err` decodes scanner failures.
- `esci2_img` (lines 873–919) drains all advertised image data even if header
  parsing reported end/error. Header tokens must not leave USB data unread.

For an independent duplex implementation: inspect all tokens in the block to
select its `typ` surface, associate page-start metadata, append the advertised
data to that surface, then apply page-end state. Keep separate front/back
buffers or output files. Do not concatenate both JPEG streams, stop on the
first `pen`, or stop on an arbitrary `lft` value. Declare success only when
each requested surface is complete and decodes as an image; an unexpected end,
error, or exhausted polling budget must remain failure. For multi-sheet jobs,
track page starts/ends per surface instead of only one global byte buffer.

## Double-feed modes

The saved live CAPA reply advertises `ADF=DFL1DFL3`, duplex `DPLX`, and
24-bit color `C024`. SANE `sane_start` (lines 1266–1275) remarks that some
devices reject duplex unless double-feed detection is enabled, and emits
`DFL1` for its basic supported mode. Its older capability parsing does not
fully cover this scanner's `DFL1DFL3` combination.

The Epson native `setDoubleFeedDetection:` implementation at `0x1bb38`
removes `DFL0`, `DFL1`, `DFL2`, and `DFL3` from the ADF parameter list before
adding the selected one. Enum 1 selects `DFL1`, enum 2 selects `DFL2`, enum 3
selects `DFL3`; `doubleFeedDetection` reports the corresponding enum. Thus
**DFL1 and DFL3 are alternative modes**, not flags to combine. Their precise
physical sensitivity/meaning is unresolved in this bounded analysis.
`#ADFDPLXDFL1` is a source-supported first duplex candidate, pending hardware
confirmation. `#COLC024` is both CAPA-supported and the SANE RGB8 encoding.

## Remaining questions

| Question | Status |
| --- | --- |
| Does the existing custom USB scan start and return an image? | Answered by coordinating agent's live grayscale scan. |
| Is there evidence of a required hidden startup command? | No such command in the bounded static scan path; successful live scan is stronger evidence for the tested mode. |
| How should duplex sides and page ends be handled? | Source-supported recommendations above; hardware confirmation still required. |
| What are DFL1 versus DFL3 physically? | Unresolved; native code establishes mutual exclusion and enum mapping only. |
| Does color duplex work and retain correct color? | Requires live verification by the hardware-owning agent. |
| Is the independent Wi-Fi handshake solved? | Unresolved; no network or hardware access was performed by this agent. |

`rea-evidence/manifest.json` records local evidence file sizes and SHA-256
digests. Additional scan captures generated by the coordinating agent may be
recorded separately after this manifest was created.
