# Epson FF-680W scanning on this Mac

Epson ScanSmart successfully scanned both sides of the loaded sheet in color on October 11, 2026.

Verified output: `scans/epson-software/epson-color-duplex-2026-10-11.pdf` — 2 pages, 356,550 bytes. Each page contains an 8-bit RGB image. Both pages were rendered and visually checked for legibility, orientation, and color.

## Scan documents in color on both sides

1. Open `/Applications/Epson Software/Epson ScanSmart.app`.
2. Check that **Scanner: EPSON FF-680W (USB)** is selected.
3. Open **Settings → Scan Settings**. In Epson Scan 2 choose:
   - Document Source: **ADF**
   - Scanning Side: **Double-Sided**
   - Document Size: **Auto Detect**
   - Image Type: **Color**
   - Resolution: **200 dpi** for the tested setting
   - Stitch Images: **Off**
   - Skip Blank Pages: **Off** to retain both sides even when one is blank
4. Click **Save**, then **Close**.
5. Load the sheet and click **double-sided SCAN**.
6. Review the two images. Keep **Include back sides** on.
7. Click **Next → Save**. Choose **PDF**, a new filename, and the desired folder, then click **Save**.

The tested settings and save folder remain selected in ScanSmart.

## Switching between Epson software and the custom driver

Only one workflow should use the scanner at a time. Close ScanSmart/FastFoto before running the custom USB driver. Epson Scanner Monitor can hold the scanner's USB interface and prevent the custom driver from opening it; stop that process before custom scanning.

When returning to Epson software, restore Epson Scanner Monitor. Its installed application is:

`/Library/Application Support/Epson/Scanner/ScannerMonitor/Epson Scanner Monitor.app`

During this session, ScanSmart initially reported **E581-A2017** / **E581-B301** after custom-driver scanning. Closing ScanSmart, resetting the USB device, and relaunching Epson Scanner Monitor restored communication and allowed the color duplex scan. A normal scanner power cycle or USB reconnection with scanner apps closed may be needed if communication fails again. This was a connection recovery, not a driver reinstall or firmware update.

## Installed Epson components

- Epson ScanSmart
- Epson FastFoto
- Epson Scan 2 Utility
- FF-680W model ES0170 TWAIN and Image Capture drivers

No software installation was needed for the verified official scan.
