# WebUSB repeat-job/reset diagnosis

2026-10-11, source analysis only; no scanner commands were issued for this investigation.

## Observed resolution: FIN-only session cleanup

Parent reports that removing FS Y from settings-read and job cleanup let PARA succeed at 12:37:13 without a native reset. A controlled two-sheet feeder job scanned only the first sheet in 200 dpi duplex, yielding two images. No native reset had occurred since 12:29. This is stronger direct evidence for the session-ending sequence than for a reset defect as the immediate cause. At 12:37:53 a second one-sheet job captured the remaining document without user reload, after an idle WebUSB reset. Both jobs completed with lftd000 and two RGB images each.

## Secondary platform difference: browser versus native reset

Installed Chrome's bundle metadata reports **154.0.8037.99** (`PlistBuddy` reading `/Applications/Google Chrome.app/Contents/Info.plist`, `CFBundleShortVersionString`). Homebrew `brew info --json=v2 libusb` reports installed/linked **1.0.30**. The project's PyUSB backend loads `/opt/homebrew/lib/libusb-1.0.dylib`.

The matching [Chromium 154.0.8037.99 device implementation](https://github.com/chromium/chromium/blob/154.0.8037.99/services/device/usb/usb_device_handle_impl.cc#L960) calls `libusb_reset_device` at line 963. Its [bundled Darwin implementation](https://github.com/chromium/chromium/blob/154.0.8037.99/third_party/libusb/src/libusb/os/darwin_usb.c#L1220) calls IOKit's `ResetDevice` at line 1228, checks whether descriptors changed, and only invokes `USBDeviceReEnumerate` if they changed (lines 1239–1259). Otherwise it returns success.

By comparison, [libusb 1.0.30](https://github.com/libusb/libusb/blob/v1.0.30/libusb/os/darwin_usb.c#L2057) normally uses `darwin_reenumerate_device`, which calls `USBDeviceReEnumerate` and waits for completion. Its [comment at line 2004](https://github.com/libusb/libusb/blob/v1.0.30/libusb/os/darwin_usb.c#L2004) explains that macOS 10.11 onward made the older `ResetDevice` operation ineffective. There is an exception when the handle has captured a kernel driver: that branch still uses `ResetDevice` to preserve authorization.

**Secondary inference:** a successful Chrome `device.reset()` can leave this scanner's acquisition state unchanged, while the native reset clears it through re-enumeration. This fits the earlier native recovery and browser reset followed by readable settings but rejected PARA, but it is not needed to explain the latest FIN-only success. Matching release source was verified; the installed Chrome binary's internal linkage was not disassembled. Therefore this is a strongly supported platform diagnosis, not proof of the exact runtime branch. No browser-only API in this inspected implementation directly requests the stronger re-enumeration.

## Source support for the session correction

The FS command values and 12-byte FIN framing agree with SANE: [epsonds-io.c:158](../references/sane-backends/backend/epsonds-io.c:158) defines FS Y and FS X; [epsonds-cmd.c:245](../references/sane-backends/backend/epsonds-cmd.c:245) sends `FIN x0000000`. Padding is not indicated.

However, SANE does **not call FS Y** in its backend lifecycle. FIN marks the lock released, and [close_scanner:1410](../references/sane-backends/backend/epsonds.c:1410) sends FIN then closes USB. Its reused-session ADF reset is [FIN → FS X → RESA:3698](../references/sane-backends/backend/epsonds.c:3698). Our browser had ended settings reads with FS Y without FIN, and scan cleanup sent an additional FS Y after FIN. Removing these extra FS Y commands now has an observed successful result; source inspection alone had identified them as a hypothesis. Accepting an UNKN control reply as success also does not prove acquisition lock state; SANE requires ACK. The controlled two-job test passed; native recovery was not required for either FIN-only job.
