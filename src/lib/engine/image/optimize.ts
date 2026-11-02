/**
 * Size targeting as a rate–distortion search.
 *
 * For every accepted format and a ladder of output scales, the encoder quality
 * is found by bisection: the highest quality whose file still fits under the
 * byte limit. Each feasible candidate is decoded and compared with the
 * full-quality reference using SSIM (after resampling both to the same
 * analysis grid, so lost resolution counts as lost detail too). The candidate
 * with the highest SSIM wins. Minimum sizes are met by raising quality and, as a
 * last resort, by adding inert comment bytes to the file.
 */
import type { DocumentKind, ImageOutputFormat } from "../types";
import { ssim, toLuma } from "./analysis";
import { padJpeg, padPng, setJpegDpi, setPngDpi } from "./binary";
import { canEncode, encodeCanvas, fitWithin, readPixels, resize, type AnyCanvas } from "./canvas";

export interface OptimizeInput {
  canvas: AnyCanvas;
  formats: ImageOutputFormat[];
  kind: DocumentKind;
  maxBytes?: number;
  minBytes?: number;
  minWidth?: number;
  minHeight?: number;
  lockDimensions: boolean;
  dpi?: number;
  onProgress?: (fraction: number) => void;
}

export interface TracePoint {
  format: ImageOutputFormat;
  quality: number | null;
  width: number;
  height: number;
  bytes: number;
  ssim: number;
  feasible: boolean;
  chosen?: boolean;
}

export interface OptimizeOutput {
  bytes: Uint8Array;
  format: ImageOutputFormat;
  quality: number | null;
  width: number;
  height: number;
  ssim: number;
  trace: TracePoint[];
  /** Bytes added to meet a minimum size. */
  padded: number;
  /** True when no candidate fit under the maximum size. */
  overLimit: boolean;
}

const SCALES = [1, 0.86, 0.74, 0.63, 0.54, 0.46, 0.39, 0.33, 0.28, 0.24];
const Q_MIN = 0.3;
const Q_MAX = 0.95;
const ANALYSIS_SIDE = 768;
const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

function preferredFormat(kind: DocumentKind, formats: ImageOutputFormat[]): ImageOutputFormat {
  if (kind === "signature" && formats.includes("png")) return "png";
  if (formats.includes("jpg")) return "jpg";
  return formats[0];
}

export async function optimizeEncode(input: OptimizeInput): Promise<OptimizeOutput> {
  const { canvas, kind, maxBytes, minBytes, dpi } = input;
  const supported: ImageOutputFormat[] = [];
  for (const f of input.formats) if (await canEncode(f)) supported.push(f);
  if (!supported.length) throw new Error(`This browser cannot create ${input.formats.map((f) => f.toUpperCase()).join(" or ")} files.`);

  // DPI metadata must not push a file over the limit: reserve room for it.
  const overhead = dpi ? 32 : 0;
  const budget = maxBytes ? maxBytes - overhead - 16 : Number.POSITIVE_INFINITY;

  const [aw, ah] = fitWithin(canvas.width, canvas.height, ANALYSIS_SIDE);
  const refLuma = toLuma(readPixels(resize(canvas, aw, ah)));
  const scoreBlob = async (blob: Blob) => {
    const bmp = await createImageBitmap(blob);
    const luma = toLuma(readPixels(resize(bmp, aw, ah)));
    bmp.close();
    return ssim(refLuma, luma, aw, ah);
  };

  const scaled = new Map<number, AnyCanvas>();
  const atScale = (s: number) => {
    if (s === 1) return canvas;
    if (!scaled.has(s)) scaled.set(s, resize(canvas, canvas.width * s, canvas.height * s));
    return scaled.get(s)!;
  };
  const scales = input.lockDimensions
    ? [1]
    : SCALES.filter(
        (s) =>
          s === 1 ||
          (canvas.width * s >= (input.minWidth ?? 1) && canvas.height * s >= (input.minHeight ?? 1) && Math.min(canvas.width, canvas.height) * s >= 48),
      );

  const trace: TracePoint[] = [];
  type Best = { blob: Blob; point: TracePoint };
  let best: Best | null = null;
  let smallest: Best | null = null;
  const consider = (blob: Blob, point: TracePoint) => {
    trace.push(point);
    if (!smallest || point.bytes < smallest.point.bytes) smallest = { blob, point };
    if (!point.feasible) return;
    if (!best) {
      best = { blob, point };
      return;
    }
    const b = best.point;
    const prefIdx = (f: ImageOutputFormat) => supported.indexOf(f);
    const better =
      point.ssim > b.ssim + 0.002 ||
      (Math.abs(point.ssim - b.ssim) <= 0.002 && (prefIdx(point.format) < prefIdx(b.format) || (point.format === b.format && point.bytes < b.bytes)));
    if (better) best = { blob, point };
  };

  let steps = 0;
  const totalSteps = Math.max(1, supported.length * scales.length);
  const tick = () => input.onProgress?.(Math.min(0.98, ++steps / totalSteps));

  if (!Number.isFinite(budget)) {
    // No size limit: encode once at high quality in the most suitable format.
    const format = preferredFormat(kind, supported);
    const quality = format === "png" ? null : 0.92;
    const blob = await encodeCanvas(canvas, format, quality ?? undefined);
    consider(blob, { format, quality, width: canvas.width, height: canvas.height, bytes: blob.size, ssim: await scoreBlob(blob), feasible: true });
  } else {
    for (const format of supported) {
      let bestSsimForFormat = -1;
      for (const s of scales) {
        await yieldToUi();
        tick();
        const c = atScale(s);
        if (format === "png") {
          const blob = await encodeCanvas(c, "png");
          const feasible = blob.size <= budget;
          const point: TracePoint = { format, quality: null, width: c.width, height: c.height, bytes: blob.size, ssim: await scoreBlob(blob), feasible };
          consider(blob, point);
          if (feasible) break;
          continue;
        }
        // Lossy: bisection on quality. Every encode is decoded and scored, so the
        // trace shows the whole size/quality curve, including versions over the limit.
        const tryQ = async (q: number) => {
          const blob = await encodeCanvas(c, format, q);
          const feasible = blob.size <= budget;
          const point: TracePoint = { format, quality: round3(q), width: c.width, height: c.height, bytes: blob.size, ssim: await scoreBlob(blob), feasible };
          consider(blob, point);
          return { blob, feasible, point };
        };
        const top = await tryQ(Q_MAX);
        let q = Q_MAX;
        let score = top.point.ssim;
        if (!top.feasible) {
          const bottom = await tryQ(Q_MIN);
          if (!bottom.feasible) continue;
          let lo = Q_MIN;
          let hi = Q_MAX;
          q = Q_MIN;
          score = bottom.point.ssim;
          for (let i = 0; i < 6; i++) {
            const mid = (lo + hi) / 2;
            const r = await tryQ(mid);
            if (r.feasible) {
              lo = mid;
              q = mid;
              score = r.point.ssim;
            } else hi = mid;
          }
        }
        // A high quality at this scale beats any smaller scale; a falling score means we're past the optimum.
        if (q >= 0.9 || score < bestSsimForFormat - 0.004) break;
        bestSsimForFormat = Math.max(bestSsimForFormat, score);
      }
    }
  }

  const overLimit = !best;
  const chosen: Best = (best ?? smallest)!;
  chosen.point.chosen = true;
  let bytes = new Uint8Array(await chosen.blob.arrayBuffer());
  let quality = chosen.point.quality;
  const format = chosen.point.format;

  // Minimum size: first try the top quality, then pad.
  let padded = 0;
  if (minBytes && bytes.length + overhead < minBytes && format !== "png" && (quality ?? 1) < 1) {
    const c = atScale(chosen.point.width === canvas.width ? 1 : chosen.point.width / canvas.width);
    const top = await encodeCanvas(c, format, 1);
    if (top.size <= budget) {
      bytes = new Uint8Array(await top.arrayBuffer());
      quality = 1;
    }
  }

  if (dpi && format === "jpg") bytes = setJpegDpi(bytes, dpi) as Uint8Array<ArrayBuffer>;
  if (dpi && format === "png") bytes = setPngDpi(bytes, dpi) as Uint8Array<ArrayBuffer>;

  if (minBytes && bytes.length < minBytes) {
    const target = Math.min(maxBytes ?? Number.POSITIVE_INFINITY, minBytes + Math.min(2048, Math.round(minBytes * 0.02)));
    const extra = target - bytes.length;
    const before = bytes.length;
    if (format === "jpg") bytes = padJpeg(bytes, extra) as Uint8Array<ArrayBuffer>;
    else if (format === "png") bytes = padPng(bytes, extra) as Uint8Array<ArrayBuffer>;
    padded = bytes.length - before;
  }
  input.onProgress?.(1);

  return {
    bytes,
    format,
    quality,
    width: chosen.point.width,
    height: chosen.point.height,
    ssim: chosen.point.ssim,
    trace,
    padded,
    overLimit,
  };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
