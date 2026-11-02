/**
 * Pixel analysis on raw RGBA buffers. No DOM access, so everything here runs in
 * tests as well as in the browser.
 *
 * - SSIM (Wang, Bovik, Sheikh & Simoncelli, 2004) computed with summed-area
 *   tables over 8×8 windows, used to score how much detail a compressed file keeps.
 * - Variance of the Laplacian (Pech-Pacheco et al., 2000) as a sharpness score.
 * - CIELAB statistics of the border ring to judge background uniformity.
 */

export interface RGBA {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** Rec. 709 luma of gamma-encoded sRGB. */
export function toLuma(img: RGBA): Float32Array {
  const { data, width, height } = img;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  return out;
}

function integral(src: Float32Array | Float64Array, w: number, h: number, square = false, other?: Float32Array): Float64Array {
  const W = w + 1;
  const out = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = other ? src[i] * other[i] : square ? src[i] * src[i] : src[i];
      row += v;
      out[(y + 1) * W + x + 1] = out[y * W + x + 1] + row;
    }
  }
  return out;
}

const rectSum = (t: Float64Array, W: number, x0: number, y0: number, x1: number, y1: number) =>
  t[y1 * W + x1] - t[y0 * W + x1] - t[y1 * W + x0] + t[y0 * W + x0];

/** Mean SSIM between two luma planes of identical size. 1 = identical. */
export function ssim(a: Float32Array, b: Float32Array, width: number, height: number, win = 8, stride = 4): number {
  if (a.length !== b.length) throw new Error("SSIM inputs differ in size");
  if (width < win || height < win) return 1;
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  const W = width + 1;
  const sa = integral(a, width, height);
  const sb = integral(b, width, height);
  const saa = integral(a, width, height, true);
  const sbb = integral(b, width, height, true);
  const sab = integral(a, width, height, false, b);
  const n = win * win;
  let total = 0;
  let count = 0;
  for (let y = 0; y + win <= height; y += stride) {
    for (let x = 0; x + win <= width; x += stride) {
      const x1 = x + win;
      const y1 = y + win;
      const ma = rectSum(sa, W, x, y, x1, y1) / n;
      const mb = rectSum(sb, W, x, y, x1, y1) / n;
      const va = Math.max(0, rectSum(saa, W, x, y, x1, y1) / n - ma * ma);
      const vb = Math.max(0, rectSum(sbb, W, x, y, x1, y1) / n - mb * mb);
      const cov = rectSum(sab, W, x, y, x1, y1) / n - ma * mb;
      total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      count++;
    }
  }
  return count ? total / count : 1;
}

/** Variance of the 4-neighbour Laplacian; higher means sharper. */
export function laplacianVariance(luma: Float32Array, width: number, height: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = luma[i - width] + luma[i + width] + luma[i - 1] + luma[i + 1] - 4 * luma[i];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export interface ExposureStats {
  mean: number;
  clippedHighlights: number;
  clippedShadows: number;
}

export function exposureStats(luma: Float32Array): ExposureStats {
  let sum = 0;
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < luma.length; i++) {
    const v = luma[i];
    sum += v;
    if (v >= 250) hi++;
    else if (v <= 5) lo++;
  }
  const n = luma.length || 1;
  return { mean: sum / n, clippedHighlights: hi / n, clippedShadows: lo / n };
}

/* ------------------------------- Colour --------------------------------- */

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

const LINEAR = new Float32Array(256).map((_, i) => srgbToLinear(i));

/** sRGB (0–255) to CIELAB (D65). */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = LINEAR[r | 0];
  const G = LINEAR[g | 0];
  const B = LINEAR[b | 0];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export interface BorderStats {
  meanL: number;
  stdL: number;
  meanChroma: number;
  /** Mean CIEDE76 distance of border pixels from their average colour. */
  spread: number;
  median: [number, number, number];
}

/** Statistics of the outer ring of an image (default 6% of the short side). */
export function borderStats(img: RGBA, ringFraction = 0.06): BorderStats {
  const { data, width, height } = img;
  const ring = Math.max(1, Math.round(Math.min(width, height) * ringFraction));
  const labs: [number, number, number][] = [];
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 20000)));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (x >= ring && x < width - ring && y >= ring && y < height - ring) continue;
      const i = (y * width + x) * 4;
      labs.push(rgbToLab(data[i], data[i + 1], data[i + 2]));
      rs.push(data[i]);
      gs.push(data[i + 1]);
      bs.push(data[i + 2]);
    }
  }
  const n = labs.length || 1;
  const mean = labs.reduce((acc, l) => [acc[0] + l[0], acc[1] + l[1], acc[2] + l[2]], [0, 0, 0]).map((v) => v / n);
  let varL = 0;
  let spread = 0;
  for (const l of labs) {
    varL += (l[0] - mean[0]) ** 2;
    spread += Math.hypot(l[0] - mean[0], l[1] - mean[1], l[2] - mean[2]);
  }
  const med = (arr: number[]) => {
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 255;
  };
  return {
    meanL: mean[0],
    stdL: Math.sqrt(varL / n),
    meanChroma: Math.hypot(mean[1], mean[2]),
    spread: spread / n,
    median: [med(rs), med(gs), med(bs)],
  };
}

/** True when nearly every sampled pixel has R≈G≈B. */
export function isGrayscale(img: RGBA, tolerance = 8): boolean {
  const { data } = img;
  const total = data.length / 4;
  const step = Math.max(1, Math.floor(total / 40000));
  let colourful = 0;
  let n = 0;
  for (let p = 0; p < total; p += step) {
    const i = p * 4;
    const max = Math.max(data[i], data[i + 1], data[i + 2]);
    const min = Math.min(data[i], data[i + 1], data[i + 2]);
    if (max - min > tolerance) colourful++;
    n++;
  }
  return colourful / n < 0.005;
}

/** Skin likelihood test in YCbCr (Chai & Ngan, 1999). */
export function isSkin(r: number, g: number, b: number): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return y > 45 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
}

export interface ContentTraits {
  aspect: number;
  /** Share of pixels that look like skin in the central region. */
  skin: number;
  /** Share of dark "ink" pixels. */
  ink: number;
  /** Share of near-white pixels. */
  white: number;
  /** Mean luma. */
  brightness: number;
  colourful: boolean;
}

export function contentTraits(img: RGBA): ContentTraits {
  const { data, width, height } = img;
  let skin = 0;
  let centre = 0;
  let ink = 0;
  let white = 0;
  let lumaSum = 0;
  let colourfulCount = 0;
  const total = width * height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumaSum += l;
      if (l < 110) ink++;
      if (l > 225 && Math.max(r, g, b) - Math.min(r, g, b) < 24) white++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 30) colourfulCount++;
      const inCentre = x > width * 0.2 && x < width * 0.8 && y > height * 0.1 && y < height * 0.75;
      if (inCentre) {
        centre++;
        if (isSkin(r, g, b)) skin++;
      }
    }
  }
  return {
    aspect: width / height,
    skin: centre ? skin / centre : 0,
    ink: ink / total,
    white: white / total,
    brightness: lumaSum / total,
    colourful: colourfulCount / total > 0.05,
  };
}

/** Likelihood scores (0–1) used to match files to requirement slots. */
export function classifyTraits(t: ContentTraits) {
  const portrait = clamp01((t.skin - 0.04) / 0.22) * (t.aspect < 1.4 ? 1 : 0.5);
  const signature = clamp01((t.white - 0.55) / 0.3) * clamp01((0.25 - t.ink) / 0.2) * (t.aspect > 1.4 ? 1 : 0.55) * (t.colourful ? 0.6 : 1);
  const page = clamp01((t.white - 0.35) / 0.4) * (Math.abs(t.aspect - 0.707) < 0.15 || Math.abs(t.aspect - 1.414) < 0.2 ? 1 : 0.6);
  return { portrait, signature, page };
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
