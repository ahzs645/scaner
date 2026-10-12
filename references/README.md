# Research reference sources

`sources.json` records upstream repositories and the commits inspected during
scanner, SANE, processing and networking research. The build does not depend on
these checkouts. Downloaded third-party trees and earlier application snapshots
stay outside version control; relevant sources, provenance and licenses for
runtime assets are under `web-app/third-party` and the npm lockfile.

To reproduce a source inspection, clone an entry's URL into its directory here
and check out its recorded commit. These are research inputs, not git submodules.
