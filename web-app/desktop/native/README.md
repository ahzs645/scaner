# Source-built macOS main executable

Packaging compiles `scan-studio-main.cc` with Apple clang before signing the app.
It directly enters the pinned Electron **44.7.0** framework in the same process.
The framework, helper executables and their sandbox startup stay intact. No
privacy settings or system network exemptions are changed.

The launcher retains app-specific identity in its native image. Packaging checks
its build UUID against the original Electron main and refuses a missing or
unchanged UUID. Build evidence is saved in the packaged app's
`Contents/Resources/app/build-inputs/native-main.json`. Re-signing and strict
signature verification occur after compilation.

This follows Apple's distinct-executable guidance for applications whose shared
main UUID can confuse network identity. It does not guarantee that macOS grants
Local Network access. The local prototype remains ad hoc signed; Apple recommends
an Apple-issued identity for reliable distribution.

Requirements: macOS, Apple command-line developer tools (`xcrun clang++`), and
the installed pinned Electron framework. Only single-architecture arm64/x64
packaging is implemented. The exported entry points are an internal Electron
interface; changing the pinned version requires reviewing and testing startup.

Run compilation tests without launching Electron:

```sh
node --test desktop/tests/native-main.test.mjs
```

The startup test links a synthetic framework entry stub, exercises argument
forwarding, the run-as-node fuse branches and closed-descriptor repair. A separate
test links the installed real framework in a temporary bundle and checks UUID,
runtime dependency and unchanged original input. Neither test opens an app.

Sources: [Electron macOS main](https://github.com/electron/electron/blob/v44.7.0/shell/app/electron_main_mac.cc),
[stdio repair](https://github.com/electron/electron/blob/v44.7.0/shell/app/uv_stdio_fix.cc),
[framework entry](https://github.com/electron/electron/blob/v44.7.0/shell/app/electron_library_main.mm),
[Apple build UUID guidance](https://developer.apple.com/documentation/technotes/tn3178-checking-for-and-resolving-build-uuid-problems).
