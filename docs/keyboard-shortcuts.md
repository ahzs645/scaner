# Keyboard shortcuts

The command registry in `web-app/src/shortcuts.ts` drives the keyboard matcher,
tooltips, ARIA shortcut metadata and the in-app guide. Open the keyboard button
in the header, or press `?`. macOS uses Command; Windows/Linux use Control.

## Main commands

| Action | Shortcut |
| --- | --- |
| Rotate selected page right / left | R / Shift+R |
| Rotate in the Edit scope right / left | Alt/Option+R / Alt/Option+Shift+R |
| Undo / redo in the Edit Apply to scope | Command/Ctrl+Z / Command/Ctrl+Shift+Z (also Command/Ctrl+Y) |
| Previous / next page | Left/Right arrow or Page Up/Page Down |
| First / last page | Home / End |
| Auto-crop / upright text / both | C / O / A |
| Restore original in Edit scope | Shift+X |
| Zoom in / out | + or = / - (also Command/Ctrl versions) |
| Fit / actual size | F or Command/Ctrl+0 / 0 |
| Original / edited preview | V |
| Page overview | G |
| Capture / Edit / Page info / Activity | 1 / 2 / 3 / 4 |
| Saved jobs / inspector / search saved jobs | L / I / slash |
| Connect USB / read device settings / disconnect | U / Shift+U / Alt/Option+U |
| Discover / connect network scanner (Electron) | Shift+N / Alt/Option+Enter |
| Scan / stop | Command/Ctrl+Enter / Escape |
| New workspace | N |
| Export ZIP / selected page / original JPEG | Command/Ctrl+S / +Shift+S / +Alt/Option+S |
| Switch edited / original export | B |
| Apply / remove selected ICC profile | P / Shift+P |
| Import ICC / compare / measured calibration | Shift+I / Shift+C / Shift+M |
| Theme / scanning help / shortcut guide | T / H / ? |

Rotation always affects the selected page. Pipeline actions (including undo and
redo) use the existing Edit scope: selected page, all pages, fronts or backs.
A fresh edit clears that page's redo stack. Up to 20 undo and redo recipes per
page are saved in IndexedDB without changing the original captures. Earlier
saved edits without redo fields still load normally; no database upgrade is
required. Redo re-renders the saved recipe from the original, including its crop,
rotation and optional color profile.

## Browser and focus behavior

Command/Ctrl+R remains reload, including its Shift variant. Tab/window shortcuts,
clipboard operations, browser Find and the address bar keep their native keys.
Disabled controls never become enabled through a shortcut. Typing, composition,
AltGraph input, text undo, and native control navigation are protected. Scan and
export modifier chords work from settings inputs too. Open dialogs isolate all
workspace shortcuts; native Escape cancellation retains their cleanup hooks.
On a small screen, Escape closes a drawer before stopping active processing.
Held keys can repeat only page navigation and zoom, not capture or edits.

The guide includes a saved preference to disable letter, number and symbol
shortcuts; modifier commands and non-character navigation remain available.
This follows the accessibility principle in
[WCAG character key shortcuts](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html).
Tooltips and ARIA metadata update when the preference changes.

Electron uses the same registry to bypass default menu accelerators only for app
modifier commands, letting renderer focus rules apply. No global OS shortcuts
are registered. Desktop source is maintained, but the Pages action builds only
the webpage.

## References and verification

Reviewed primary shortcut documentation from
[Apple Preview](https://support.apple.com/en-lb/guide/preview/cpprvw0003/mac),
[Adobe Acrobat](https://helpx.adobe.com/acrobat/desktop/get-started/preferences-and-settings/keyboard-shortcuts.html),
[Chrome](https://support.google.com/chrome/answer/157179?hl=en), and
[Electron webContents](https://www.electronjs.org/docs/latest/api/web-contents#event-before-input-event).
R/Shift+R is this app's rotation mapping; it avoids Chrome's reserved reload
chords rather than claiming identical shortcuts in every editor.

Run `npm test` for the browser driver, processing, keyboard and persistence tests.
Run `npm run test:desktop` for the desktop routing checks as well. A synthetic
browser harness checks the real UI without feeding paper:

```sh
cd web-app
npm run prepare-browser-tests
SCANNER_WEB_PORT=8768 SCANNER_BROWSER_TEST_FRAMES=1 node scripts/serve.mjs
```

Open `http://127.0.0.1:8768/shortcuts-check.html` and choose Run keyboard checks.
Use this separate test origin to avoid mixing fixture jobs with real scans.
Same-origin frames are allowed only with the explicit test flag and a non-default
port. Normal dev hosting retains its framing restriction. All generated test
pages are removed by the production build and excluded from deployment.

Validated October 11, 2026: 244 browser and desktop unit/integration tests
passed locally, plus 48 checks in the real browser UI harness. Native Mac key
presses verified Option+R rotation, Command+Z undo, Command+Shift+Z redo,
Command+S ZIP export and question-mark help. Checks used three synthetic pages;
no hardware acquisition or private scan editing was needed.
