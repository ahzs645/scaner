# Continue a saved scan

Choose an item in **My scans**, then its **Add pages** button. This opens capture
settings for that document. Load another sheet or batch, connect the scanner and
choose **Add pages to this scan**. The keyboard shortcut is Command/Ctrl+Shift+Enter.
Choose **Scan as new document** (Command/Ctrl+Enter) to create a separate item.

A sheet limit of 1 applies to this new acquisition, even when the saved document
already has many pages. Zero requests all sheets loaded for this acquisition.
Duplex additions create a front/back pair per new physical sheet. Adding pages
works with the same ScannerDriver contract for WebUSB and Electron network scans.

Existing originals, crop/rotation/color edits and undo/redo history remain intact.
Automatic post-capture crop/orientation runs only on newly saved pages. Added
sheet numbers start after the highest sheet already saved, including incomplete
duplex sheets. The first newly added page is selected after capture.

Each page records its actual capture options, driver and available scanner
identity. Additions may use different resolution, sides, quality, color mode or
scanner: page properties and color-profile compatibility use that page's own
capture metadata. My scans labels documents with different color modes/DPI as
mixed capture settings. Older saved jobs inherit their original job metadata and
can be continued without a database upgrade.

Completed pages from a failed or canceled addition remain saved alongside older
pages. Retry adds new sheets after them; it never overwrites a partially saved
front or back. Capture records retain individual completion/error states even
when a later retry succeeds. The ZIP export includes all pages and each capture
batch/settings; edited exports also include existing processed pages.

A Web Lock prevents two current app windows from adding to the same job while
one is acquiring or processing. Capture IDs reject delayed save/finish callbacks
from an older acquisition. Interrupted capture recovery is permitted only while
the app owns that lock. Environments without Web Locks reject jobs still marked
as scanning. The existing 512 MiB original-capture budget applies to the combined
job; new documents provide a separate budget.

Validation on October 11, 2026 used a simulated driver through the real app UI
and synthetic JPEGs. It verified continued duplex filenames, single-sided
additions, mixed DPI/color metadata, preserved originals and edits, processing
only new pages, partial failure/retry, cross-window lock refusal, combined ZIP
export and a separate new document: 27 browser checks passed. Hardware scan
transport was not exercised in this validation; its existing driver tests remain
in the suite.

To repeat the browser checks on a separate test origin:

```sh
cd web-app
npm run prepare-browser-tests
SCANNER_WEB_PORT=8769 node scripts/serve.mjs
```

Open `http://127.0.0.1:8769/append-check.html` and choose **Run add-pages checks**.
Reload before a repeat run to seed a fresh fixture. The generated test page
substitutes a simulated driver before loading the app, never requests USB access
and is removed from production builds. Fixture jobs stay only in that test
origin's browser storage.
