# Local color engine assets

`scripts/vendor-color.mjs` copies the pinned `lcms-wasm@1.0.5` JavaScript/WASM,
its MIT license, the underlying LittleCMS MIT license, and bundles only the
`jpeg-js@0.4.4` decoder as browser ESM with its BSD license. Generated runtime
assets and SHA-256 manifest go to `dist/vendor/color/`. There is no runtime CDN
or network profile lookup.

The registry package's git revision is
`762214c66e907674c8a5538223c624291f5039dd`; its LittleCMS submodule revision is
`c2a54017d73080f97c5cd34a78ff2fb51564aade` (LittleCMS 2.16). These are recorded
in `provenance.json`. The runtime uses the package's own WebAssembly binary;
the native system library is used only for independently generated fixtures
and validation, not for application image conversion.

`srgb.icc` is an explicitly generated destination/export profile from Pillow's
LittleCMS 2.19 sRGB generator, with a fixed 2024-01-01 header creation timestamp
and zero optional profile ID. Its identity and transfer function were tested
against the bundled engine. It never supplies an assumed scanner source profile.

`inspectICC` applies file/header/tag/curve/LUT bounds before loading a profile.
`validateICC` additionally proves that LittleCMS can construct its RGB-to-sRGB
transform; run both before accepting an imported source profile. Rendering uses
relative colorimetric intent and preserves unassociated alpha. RGB work is split
into 32,768-pixel blocks; output is a separate bounded raster. The source profile
is explicit and capped at 4 MiB. Raster work is capped at 40 million pixels.

`decodeCapture` uses the pure JPEG decoder, avoiding browser/Canvas ICC
normalization before the explicit transform. It checks frame dimensions and
RGB/grayscale component count first, rejects CMYK/unsupported coding, and caps
JPEG input at 64 MiB, dimensions at 40 MP and decoder allocations at 512 MiB.
JPEG component-to-RGB decoding is retained; embedded ICC profiles are ignored
by this raw decoder and must be handled explicitly by the profile selection
layer. It does not auto-rotate EXIF or reinterpret original scan provenance.

The bundled jpeg-js decoder has one documented source patch,
`legal-restart-marker-fill-v1`. Epson emits repeated `FF` fill bytes before
`RSTn` markers; unmodified jpeg-js incorrectly exits its scan loop at `FFFF`
and later reports an unknown restart marker. The patch skips only those legal
fill bytes at interval boundaries before reading the marker. It preserves
`tolerantDecoding: false` and throws on truncated markers. The manifest records
the original decoder source SHA-256 and patch identity; vendoring fails if the
pinned source patch anchor changes. Node modules remain unmodified.

Before decoding, `validateCaptureJPEG` independently checks complete segment
framing, one frame, selector/sampling bounds, restart interval counts and cyclic
marker order, entropy stuffing, and final EOI. Corrupted or missing markers are
errors, not a fallback to partially decoded pixels. The regression suite includes
a nonsensitive synthetic restart JPEG with/without fill, corrupt/truncated forms,
and four local USB/network captures. Those private captures stay in the scans
folder and are skipped when absent; none are embedded in source or transmitted.
Local comparison against native libjpeg-turbo with matching nearest-neighbor
chroma upsampling and stop-on-warning produced maximum channel differences of
3–4 and mean differences of 0.22–0.42, consistent with independent integer IDCT
and rounding. No color-profile conversion is performed by either raw decoder.

Worker policy needs local script loading, `'wasm-unsafe-eval'` for compilation,
and `connect-src` confined to the bundled `/vendor/color/` directory. The main
renderer need not receive a broader connection policy. Node numeric tests read
the same local assets, including a synthetic LUT profile and a native Pillow
LittleCMS comparison. Browser worker loading remains an integration check for
the root application.

Primary sources: [lcms-wasm](https://github.com/mattdesl/lcms-wasm),
[LittleCMS](https://github.com/mm2/Little-CMS),
[jpeg-js](https://github.com/jpeg-js/jpeg-js),
[libjpeg-turbo marker handling](https://github.com/libjpeg-turbo/libjpeg-turbo/blob/main/src/jdmarker.c),
[ICC specifications](https://www.color.org/icc_specs2/).
