/** FF-680W PARA serialization, matching src/ff680w_re/profiles.py.
 * The grayscale LUT below is copied from this project's FF680W_MONO_LUT.
 * Its original source is SANE backend/epsonds.c, LUT family 2:
 * Copyright (C) 2015 Tower Technologies; author Alessandro Zummo;
 * GPL-2.0-only, as stated in that source's header.
 * See ../../docs/sane-comparison.md and ../../references/sane-backends/COPYING.
 * RGB tables intentionally remain the project's identity curves, not SANE's
 * calibrated curves; hardware color parity has not been established.
 */

export interface ScanOptions {
  mode: "color" | "gray";
  duplex: boolean;
  dpi: number;
  max_sheets: number;
  paper: "letter" | "a4" | "legal";
  quality: number;
  deskew: boolean;
  auto_crop: boolean;
  double_feed: boolean;
  color_capture?: "neutral-v1";
}

export const DEFAULT_OPTIONS: Readonly<ScanOptions> = Object.freeze({
  mode: "color", duplex: false, dpi: 300, max_sheets: 0, paper: "letter",
  quality: 90, deskew: false, auto_crop: false, double_feed: true,
});

export const DEVICE_INPUT_RESOLUTIONS = Object.freeze(
  [50, 75, 100, 150, 200, 240, 300, 360, 400, 600] as const,
);

const PAPER_SIZES: Readonly<Record<ScanOptions["paper"], readonly [number, number]>> = {
  letter: [8.5, 11], a4: [210 / 25.4, 297 / 25.4], legal: [8.5, 14],
};

// Preserve the 256 data bytes exactly, including embedded NUL/# delimiters.
const MONO_LUT = Uint8Array.from([
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x07, 0x08, 0x0a, 0x0c,
  0x0e, 0x10, 0x12, 0x14, 0x16, 0x16, 0x19, 0x1b, 0x1d, 0x1f, 0x21, 0x23, 0x25, 0x27, 0x28, 0x2a,
  0x2c, 0x2e, 0x30, 0x32, 0x33, 0x35, 0x37, 0x39, 0x3a, 0x3c, 0x3e, 0x40, 0x41, 0x43, 0x45, 0x46,
  0x48, 0x4a, 0x4b, 0x4d, 0x4f, 0x50, 0x52, 0x53, 0x55, 0x57, 0x58, 0x5a, 0x5b, 0x5d, 0x5f, 0x60,
  0x62, 0x63, 0x65, 0x66, 0x68, 0x69, 0x6b, 0x6c, 0x6e, 0x6f, 0x71, 0x72, 0x74, 0x75, 0x77, 0x78,
  0x7a, 0x7b, 0x7d, 0x7e, 0x80, 0x81, 0x83, 0x84, 0x86, 0x87, 0x88, 0x8a, 0x8b, 0x8d, 0x8e, 0x90,
  0x91, 0x92, 0x94, 0x95, 0x97, 0x98, 0x99, 0x9b, 0x9c, 0x9e, 0x9f, 0xa0, 0xa2, 0xa3, 0xa5, 0xa7,
  0xa9, 0xaa, 0xab, 0xad, 0xae, 0xb0, 0xb1, 0xb2, 0xb4, 0xb5, 0xb6, 0xb8, 0xb9, 0xba, 0xbc, 0xbd,
  0xbe, 0xc0, 0xc1, 0xc2, 0xc4, 0xc5, 0xc6, 0xc8, 0xc9, 0xca, 0xcc, 0xcd, 0xce, 0xd0, 0xd1, 0xd2,
  0xd4, 0xd5, 0xd6, 0xd7, 0xd9, 0xda, 0xdb, 0xdd, 0xde, 0xdf, 0xe1, 0xe2, 0xe3, 0xe4, 0xe6, 0xe7,
  0xe8, 0xe9, 0xeb, 0xec, 0xed, 0xef, 0xf0, 0xf1, 0xf2, 0xf4, 0xf5, 0xf6, 0xf7, 0xf9, 0xfa, 0xfb,
  0xfc, 0xfe, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
]);
const RGB_IDENTITY = Uint8Array.from({ length: 256 }, (_, index) => index);
const ASCII = new TextEncoder();

function decimal(value: number): string { return value.toString().padStart(3, "0"); }
function integer(value: number): string { return value.toString().padStart(7, "0"); }
function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function validate(options: ScanOptions): void {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("scan options must be an object");
  }
  if (options.mode !== "color" && options.mode !== "gray") {
    throw new TypeError("mode must be color or gray");
  }
  if (options.paper !== "letter" && options.paper !== "a4" && options.paper !== "legal") {
    throw new TypeError("paper must be letter, a4 or legal");
  }
  for (const key of ["duplex", "deskew", "auto_crop", "double_feed"] as const) {
    if (typeof options[key] !== "boolean") { throw new TypeError(`${key} must be boolean`); }
  }
  for (const key of ["dpi", "max_sheets", "quality"] as const) {
    if (!Number.isSafeInteger(options[key])) { throw new TypeError(`${key} must be a finite integer`); }
  }
  if (!DEVICE_INPUT_RESOLUTIONS.some(dpi => dpi === options.dpi)) {
    throw new RangeError("unsupported device DPI");
  }
  if (options.auto_crop && options.dpi !== 300 && options.dpi !== 600) {
    throw new RangeError("FF-680W advertises automatic cropping at 300 or 600 dpi");
  }
  if(options.color_capture!==undefined&&options.color_capture!=="neutral-v1")throw Error("Unknown color acquisition pipeline");
  const imageCount = options.max_sheets * (options.duplex ? 2 : 1);
  if (options.max_sheets < 0 || imageCount > 999) {
    throw new RangeError("sheet count must fit the three-digit image count (0 means all)");
  }
  if (options.quality < 1 || options.quality > 100) {
    throw new RangeError("JPEG quality must be between 1 and 100");
  }
}

export function buildScanPlan(options: ScanOptions): {
  payload: Uint8Array;
  summary: {
    acquisition: { left: number; top: number; width: number; lines: number };
    image_count_limit: number;
  };
} {
  validate(options);
  const [widthInches, heightInches] = PAPER_SIZES[options.paper];
  const physicalWidth = Math.trunc(8.5 * options.dpi);
  const width = Math.floor(Math.trunc(widthInches * options.dpi) / 8) * 8;
  const acquisition = {
    left: Math.floor((physicalWidth - width) / 2), top: 0,
    width, lines: Math.trunc(heightInches * options.dpi),
  };
  const imageCount = options.max_sheets * (options.duplex ? 2 : 1);
  let source = "#ADF";
  if (options.duplex) source += "DPLX";
  if (options.double_feed) source += "DFL1";
  if (options.deskew) source += "SKEW";
  // CRP alone is insufficient on this model: pair it with paper-end detection.
  if (options.auto_crop) source += "CRP PEDT";
  const { left, top, lines } = acquisition;
  const header = source + (options.mode === "color" ? "#COLC024" : "#COLM008")
    + `#FMTJPG #JPGd${decimal(options.quality)}#GMMUG18`
    + `#RSMd${decimal(options.dpi)}#RSSd${decimal(options.dpi)}#BSZi0065536`
    + `#ACQi${integer(left)}i${integer(top)}i${integer(width)}i${integer(lines)}`
    + `#PAGd${decimal(imageCount)}` + (options.auto_crop ? "#CRPi0000000" : "");
  const parts = [ASCII.encode(header+(options.mode==="color"&&options.color_capture==="neutral-v1"?"#CMXUNIT":""))];
  if (options.mode === "color") {
    for (const channel of ["RED ", "GRN ", "BLU "]) {
      parts.push(ASCII.encode(`#GMT${channel}h100`), RGB_IDENTITY);
    }
  } else {
    parts.push(ASCII.encode("#GMTMONOh100"), MONO_LUT);
  }
  return { payload: concatenate(parts), summary: { acquisition, image_count_limit: imageCount } };
}
