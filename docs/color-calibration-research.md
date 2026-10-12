# Measured scanner color characterization

The implemented workflow creates a local RGB input ICC profile from a scan of a physical, measured target and that target's reference file. It does not identify an arbitrary chart, invent reference measurements, or claim that a scanner has been calibrated merely because the software can fit numerical test data. No scanner or physical color-target measurement was performed for this implementation.

## Source basis and scope

ArgyllCMS's [scanner profiling workflow](https://www.argyllcms.com/doc/Scenarios.html#PS2) matches scanner RGB samples to known CIE values using a target layout and the manufacturer's individual/batch reference file or instrument measurements. It requires restoring the same scanner/image-processing state when subsequently using the profile, and cautions that a 24-patch target gives limited characterization. That is the basis for explicit reference selection, manual grid-to-ID mapping, repeatable capture settings, and separate front/back capture signatures in this app. A generic printed chart without measured reference values is not an adequate substitute.

[Argyll's measurement format](https://www.argyllcms.com/doc/ti3_format.html) describes CGATS color/measurement tables. [Its spot measurement documentation](https://www.argyllcms.com/doc/spotread.html) uses XYZ on a 0–100 scale for reflective/transmissive measurements and defaults Lab to D50. [Its spectral conversion documentation](https://www.argyllcms.com/doc/spec2cie.html) explicitly warns that nonstandard illuminants/observers are not interchangeable with standard profiles. The app therefore accepts already computed **D50 / CIE 1931 2°** XYZ or Lab; it does not integrate spectra or adapt a different illuminant.

[ICC.1:2010 v4.3](https://www.color.org/specification/ICC1v43_2010-12.pdf), clauses 8.2, 8.3.3, 10.5, 10.13, 10.29 and Annex F.3, permits RGB matrix/TRC input profiles with XYZ PCS and defines the required tags, sampled curves, multilingual descriptions and D50 encoding. Serialization follows that specification. The fitter is our bounded implementation, not an ArgyllCMS port, and makes no equivalence claim to Argyll's mature nonlinear/LUT profiling methods. [Argyll colprof](https://www.argyllcms.com/doc/colprof.html) offers matrix/shaper alternatives and more elaborate models.

## Implemented API

`web-app/src/color/calibration.ts` exports:

```ts
parseReference(text: string): ReferencePatch[];
fitScannerProfile(samples, references, { name?, validationIds?, createdAt? });
// -> { iccBytes: Uint8Array, report: CalibrationReport, model: ScannerColorModel }
```

A reference patch has `{id, xyz:[X,Y,Z], lab:[L,a,b]}`; XYZ is normalized to Y=1 for D50 white after reading standard CGATS XYZ values on a 0–100 scale. Samples have `{id, rgb:[r,g,b], spread?, clippedFraction?}` with scanner device RGB normalized to 0–1. Their order does not imply a target layout: the caller maps grid cells to the selected reference IDs. Parsing preserves reference-file order.

The single-table CGATS parser supports quoted strings/comments, `SAMPLE_ID` or `SAMPLE_NAME`, `LAB_L/A/B` and/or `XYZ_X/Y/Z`, optional counts, extra unused columns, and CRLF/BOM. It rejects duplicate IDs/fields, malformed numbers or rows, incomplete/multiple tables, explicit incompatible illuminants/observers, and materially inconsistent XYZ/Lab pairs. Bounds are 2 MiB of text, 20,000 lines, 8,192 characters per line, 256 fields, and 4,096 patches. A missing illuminant/observer declaration is **not verification**: the user must confirm the actual manufacturer's D50/2° reference. The numbers cannot establish target identity, batch identity or measurement provenance.

## Fit and validation guards

The model is:

```
XYZ_D50 = matrix3x3 × [r^gammaR, g^gammaG, b^gammaB]
```

A multistart bounded coordinate search fits positive per-channel exponents (0.2–5). Each candidate solves the 3×3 color matrix using reorthogonalized weighted QR and a three-variable nonnegative active-set solve, with iterative residual downweighting and a Huber objective. The nonnegative constraint follows ICC v4 XYZType colorant requirements; a response requiring negative primaries may need a LUT profile instead. There is no black offset, multidimensional LUT, arbitrary channel mixing before the tone curves, or fluorescent/spectral compensation. Significant scanner cross-channel nonlinearities can exceed this model's accuracy.

At least 24 usable patches are required: at least 18 training and 6 validation. Default validation is a deterministic ID-hash selection of approximately 25%; explicit validation IDs may be supplied. **Withheld patch colorimetry and RGB never enter fitting, candidate selection, or tone optimization.** The report records both held-out IDs and original sample indices, separate training/validation counts and errors, and per-patch DeltaE76 values. It does not claim DeltaE2000 or perceptual equivalence between them.

Nonfinite/out-of-range samples fail; clipped or visibly nonuniform patch samples are excluded (RGB at/beyond 1/255 or 254/255, clipped fraction >1%, inner-patch spread >12%). The remaining training data must span at least 0.3 per RGB channel and substantial measured lightness/chroma ranges. Near-singular designs and invalid/singular matrices are rejected. Large training residuals and small targets produce warnings.

Application acceptance requires withheld **mean DeltaE76 ≤4, 95th percentile ≤8, maximum ≤15**, and exponents away from their fitting limits. These are conservative application gates, not ICC requirements, a manufacturer's tolerance, or proof of accuracy on all photographs. A failed report and profile bytes remain available for diagnosis; the UI must prohibit activating a failed profile. Validation uses patches withheld from this scan, not a second independent capture: scan-to-scan repeatability, different materials, paper fluorescence, illumination differences and target aging still require additional measurements.

## ICC encoding and behavior

Output is ICC v4.3 `scnr` / `RGB ` / `XYZ `, relative-colorimetric default intent. It contains `desc`/`cprt` UTF-16BE `mluc` tags, `wtpt` D50, `rXYZ/gXYZ/bXYZ` nonnegative matrix columns stored in signed fixed-point format, and three 4,096-entry monotonic unsigned-16-bit `curv` tags with 0/1 endpoints. Header/tag padding, big-endian values, size and UTC creation date are explicit. The ICC profile-ID field is zero as permitted for an uncomputed ID; the surrounding library separately computes content SHA-256 IDs.

The fixed D50 white tag preserves reference D50 colorimetry rather than automatically neutralizing/normalizing the target's paper white. This avoids hiding a mismatch by white-balancing the validation data; it is not paper-white calibration or color restoration. Argyll documents a related D50-white input behavior under [`colprof -ua`](https://www.argyllcms.com/doc/colprof.html). The fitted matrix and ICC values describe the same mapping. No assumed Epson factory matrix or resource byte string is treated as a measured profile.

The main workflow must retain the original device RGB JPEG, sample that original, and use the same capture pipeline, side, DPI, mode and quality associated with the profile. Root-owned UI/storage code enforces this capture signature. Imported profiles require compatible capture settings and independent verification. Color-managed display pixels are not scanner device RGB and must not be sampled for this fit.

## Verification

`web-app/tests/color-calibration.test.mjs` uses explicitly synthetic **numerical fixtures**, never supplied target measurements. Tests check CGATS bounds/units/errors, D50 Lab conversion, recovery of different channel exponents, prediction on unseen colors, robust outlier influence, insufficient/clipped/degenerate data, held-out IDs/indices, nonnegative colorant constraints, and monotonic ICC tags. Crucially, corrupting only held-out references fails acceptance while leaving fitted model and ICC bytes unchanged.

An independent LittleCMS test opens the generated profile and compares an RGB-to-XYZ transform against the numerical model, including RGB white. This checks the encoded profile's actual color mapping rather than only inspecting its tags. The installed `lcms-wasm@1.0.5` wrapper's float64 transform packing is unsuitable; the test uses standard float32 formatter codes and compares at 0.0003 XYZ tolerance. The app uses RGB8 transforms for actual image edits. Sources: [lcms-wasm API](https://github.com/mattdesl/lcms-wasm/blob/main/lib/api.js), [LittleCMS](https://github.com/mm2/Little-CMS).

Verification run: `npm run build` and `node --test tests/color-calibration.test.mjs` — 13 tests passed. These establish software/numerical correctness, not the accuracy of any particular scanner/target combination.
