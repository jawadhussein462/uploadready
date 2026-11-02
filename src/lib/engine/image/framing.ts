/**
 * Automatic framing.
 *
 * Photos: estimate the head from a skin-tone component that differs from the
 * background colour (CIELAB distance from the border median), then place it with
 * ID-photo proportions — head ≈ 60 % of a square frame, ≈ 70 % of a 35×45 frame —
 * leaving a small margin above the crown. If no face-like region is found, fall
 * back to a saliency search: the window of the required aspect ratio that holds
 * the most edge + foreground energy, found in O(1) per window with an integral image.
 *
 * Signatures: trim to the ink bounding box, then pad to the required ratio.
 * Documents: never cropped; padded with white when a ratio is required.
 */
import type { DocumentKind } from "../types";
import { borderStats, isSkin, rgbToLab, type RGBA } from "./analysis";

/** Rectangle in source-normalised coordinates. May extend beyond [0,1]; the outside is padded. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Framing {
  rect: Rect;
  method: "face" | "saliency" | "trim" | "pad" | "none";
  confidence: number;
  padColor: [number, number, number];
  note?: string;
}

export const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };

export function frameImage(img: RGBA, kind: DocumentKind, aspect?: number): Framing {
  const border = borderStats(img);
  const white: [number, number, number] = [255, 255, 255];
  if (kind === "photo") {
    if (!aspect) return { rect: FULL, method: "none", confidence: 1, padColor: border.median };
    const face = faceFraming(img, aspect, border.median);
    if (face && face.confidence >= 0.45) return face;
    return saliencyCrop(img, aspect, border.median);
  }
  if (kind === "signature") {
    const box = inkBox(img);
    let rect = box ?? FULL;
    if (aspect) rect = padToAspect(rect, aspect, img.width, img.height);
    return {
      rect,
      method: box ? "trim" : aspect ? "pad" : "none",
      confidence: box ? 0.9 : 0.5,
      padColor: white,
      note: box ? "Trimmed the empty space around the signature." : undefined,
    };
  }
  if (aspect && Math.abs(img.width / img.height - aspect) / aspect > 0.01) {
    return { rect: padToAspect(FULL, aspect, img.width, img.height), method: "pad", confidence: 1, padColor: white };
  }
  return { rect: FULL, method: "none", confidence: 1, padColor: white };
}

/** Grow the rectangle (never shrink) until it has the given aspect ratio, keeping its centre. */
export function padToAspect(rect: Rect, aspect: number, srcW: number, srcH: number): Rect {
  const pxW = rect.w * srcW;
  const pxH = rect.h * srcH;
  const cx = (rect.x + rect.w / 2) * srcW;
  const cy = (rect.y + rect.h / 2) * srcH;
  let w = pxW;
  let h = pxH;
  if (pxW / pxH < aspect) w = pxH * aspect;
  else h = pxW / aspect;
  return { x: (cx - w / 2) / srcW, y: (cy - h / 2) / srcH, w: w / srcW, h: h / srcH };
}

/** Largest rectangle with the given aspect that fits inside the image, centred. */
export function centreCrop(aspect: number, srcW: number, srcH: number): Rect {
  if (srcW / srcH > aspect) {
    const w = (srcH * aspect) / srcW;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = srcW / aspect / srcH;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

/* ------------------------------ Face framing ----------------------------- */

interface Component {
  area: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  pixels: Int32Array;
}

function components(mask: Uint8Array, w: number, h: number, minArea: number): Component[] {
  const seen = new Uint8Array(mask.length);
  const out: Component[] = [];
  const stack = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    const pix: number[] = [];
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    while (top) {
      const p = stack[--top];
      pix.push(p);
      const x = p % w;
      const y = (p / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q >= 0 && mask[q] && !seen[q]) {
          seen[q] = 1;
          stack[top++] = q;
        }
      }
    }
    if (pix.length >= minArea) out.push({ area: pix.length, x0, y0, x1, y1, pixels: Int32Array.from(pix) });
  }
  return out;
}

export function faceFraming(img: RGBA, aspect: number, bg: [number, number, number]): Framing | null {
  const { data, width: w, height: h } = img;
  const bgLab = rgbToLab(bg[0], bg[1], bg[2]);
  const fg = new Uint8Array(w * h);
  const skin = new Uint8Array(w * h);
  const stats = borderStats(img);
  const threshold = Math.max(14, stats.spread * 2.2);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
    const d = Math.hypot(lab[0] - bgLab[0], lab[1] - bgLab[1], lab[2] - bgLab[2]);
    if (d > threshold) {
      fg[p] = 1;
      if (isSkin(data[i], data[i + 1], data[i + 2])) skin[p] = 1;
    }
  }

  const comps = components(skin, w, h, Math.max(12, Math.round(w * h * 0.008)));
  if (!comps.length) return null;
  let best: Component | null = null;
  let bestScore = -1;
  for (const c of comps) {
    const cx = (c.x0 + c.x1) / 2 / w;
    const cy = (c.y0 + c.y1) / 2 / h;
    const centrality = 1 - Math.min(1, Math.abs(cx - 0.5) * 1.6);
    const upper = cy < 0.75 ? 1 : 0.4;
    const score = c.area * centrality * upper;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (!best) return null;
  const c = best;
  const compH = c.y1 - c.y0 + 1;

  // Row widths of the component.
  const rowCount = new Int32Array(compH);
  const rowSumX = new Float64Array(compH);
  for (const p of c.pixels) {
    const y = ((p / w) | 0) - c.y0;
    rowCount[y]++;
    rowSumX[y] += p % w;
  }
  const upperRows = Math.max(1, Math.round(compH * 0.55));
  const widths = Array.from(rowCount.subarray(0, upperRows)).sort((a, b) => a - b);
  const faceW = widths[Math.floor(widths.length * 0.9)] || 1;
  let sx = 0;
  let sn = 0;
  for (let y = 0; y < upperRows; y++) {
    sx += rowSumX[y];
    sn += rowCount[y];
  }
  const cx = sn ? sx / sn : (c.x0 + c.x1) / 2;
  if (faceW < w * 0.06) return null;

  // Crown: walk up from the top of the skin region while the foreground (hair) continues.
  const bandX0 = Math.max(0, Math.round(cx - faceW * 0.75));
  const bandX1 = Math.min(w - 1, Math.round(cx + faceW * 0.75));
  const bandW = bandX1 - bandX0 + 1;
  let crown = c.y0;
  let crownTouchesEdge = false;
  for (let y = c.y0 - 1; y >= 0; y--) {
    let n = 0;
    for (let x = bandX0; x <= bandX1; x++) n += fg[y * w + x];
    if (n / bandW >= 0.18) {
      crown = y;
      if (y === 0) crownTouchesEdge = true;
    } else break;
  }

  // Chin: the first row below the widest part where the skin narrows into the neck.
  let maxRow = 0;
  for (let y = 0; y < upperRows; y++) if (rowCount[y] > rowCount[maxRow]) maxRow = y;
  let chin = -1;
  for (let y = maxRow + Math.round(faceW * 0.45); y < compH; y++) {
    if (rowCount[y] < faceW * 0.62) {
      chin = c.y0 + y;
      break;
    }
  }
  if (chin < 0 || chin - c.y0 > faceW * 1.7) chin = Math.round(c.y0 + faceW * 1.25);
  let headH = chin - crown;
  headH = Math.max(faceW * 1.05, Math.min(faceW * 1.9, headH));

  const headShare = aspect >= 0.95 ? 0.6 : 0.7;
  const topMargin = aspect >= 0.95 ? 0.13 : 0.09;
  const cropH = headH / headShare;
  const cropW = cropH * aspect;
  const top = crown - topMargin * cropH;
  const left = cx - cropW / 2;

  const rect = { x: left / w, y: top / h, w: cropW / w, h: cropH / h };
  const symmetry = 1 - Math.min(1, Math.abs(cx - (c.x0 + c.x1) / 2) / faceW);
  const areaOk = c.area / (w * h) > 0.01 && c.area / (w * h) < 0.6 ? 1 : 0.4;
  const confidence = Math.max(0, Math.min(1, 0.35 + 0.4 * symmetry * areaOk + (crownTouchesEdge ? -0.1 : 0.15)));
  const outside = rect.x < -0.01 || rect.y < -0.01 || rect.x + rect.w > 1.01 || rect.y + rect.h > 1.01;
  return {
    rect,
    method: "face",
    confidence,
    padColor: bg,
    note: outside
      ? "The photo is framed tightly, so plain background was added around it. A photo with more space around your head will look more natural."
      : "Centred the face with standard ID-photo proportions.",
  };
}

/* ---------------------------- Saliency crop ----------------------------- */

export function saliencyCrop(img: RGBA, aspect: number, bg: [number, number, number]): Framing {
  const { data, width: w, height: h } = img;
  const energy = new Float32Array(w * h);
  const bgLab = rgbToLab(bg[0], bg[1], bg[2]);
  const luma = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    luma[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  let total = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const gx = luma[p - w + 1] + 2 * luma[p + 1] + luma[p + w + 1] - luma[p - w - 1] - 2 * luma[p - 1] - luma[p + w - 1];
      const gy = luma[p + w - 1] + 2 * luma[p + w] + luma[p + w + 1] - luma[p - w - 1] - 2 * luma[p - w] - luma[p - w + 1];
      const i = p * 4;
      const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
      const fgDist = Math.min(1, Math.hypot(lab[0] - bgLab[0], lab[1] - bgLab[1], lab[2] - bgLab[2]) / 40);
      const e = Math.min(1, Math.hypot(gx, gy) / 400) * 0.5 + fgDist * 0.35 + (isSkin(data[i], data[i + 1], data[i + 2]) ? 0.6 : 0);
      energy[p] = e;
      total += e;
    }
  }
  if (total <= 0) return { rect: centreCrop(aspect, w, h), method: "saliency", confidence: 0.3, padColor: bg };

  const W = w + 1;
  const integ = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += energy[y * w + x];
      integ[(y + 1) * W + x + 1] = integ[y * W + x + 1] + row;
    }
  }
  const sum = (x0: number, y0: number, x1: number, y1: number) =>
    integ[y1 * W + x1] - integ[y0 * W + x1] - integ[y1 * W + x0] + integ[y0 * W + x0];

  let maxW = w;
  let maxH = Math.round(w / aspect);
  if (maxH > h) {
    maxH = h;
    maxW = Math.round(h * aspect);
  }
  let best = { score: -Infinity, x: 0, y: 0, ww: maxW, hh: maxH };
  for (const scale of [1, 0.92, 0.84, 0.76]) {
    const ww = Math.max(4, Math.round(maxW * scale));
    const hh = Math.max(4, Math.round(maxH * scale));
    const stride = Math.max(1, Math.round(Math.min(w, h) * 0.02));
    for (let y = 0; y + hh <= h; y += stride) {
      for (let x = 0; x + ww <= w; x += stride) {
        const inside = sum(x, y, x + ww, y + hh) / total;
        const cxOff = Math.abs(x + ww / 2 - w / 2) / w;
        const score = inside - 0.3 * (1 - scale) - 0.08 * cxOff;
        if (score > best.score) best = { score, x, y, ww, hh };
      }
    }
  }
  return {
    rect: { x: best.x / w, y: best.y / h, w: best.ww / w, h: best.hh / h },
    method: "saliency",
    confidence: 0.5,
    padColor: bg,
    note: "No face was detected, so the frame was placed on the most detailed area. Check the framing.",
  };
}

/* ------------------------------ Ink bounding ---------------------------- */

export function inkBox(img: RGBA): Rect | null {
  const { data, width: w, height: h } = img;
  const stats = borderStats(img, 0.04);
  const bgL = 0.2126 * stats.median[0] + 0.7152 * stats.median[1] + 0.0722 * stats.median[2];
  const threshold = Math.min(bgL - 45, 170);
  const rows = new Int32Array(h);
  const cols = new Int32Array(w);
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (l < threshold) {
        rows[y]++;
        cols[x]++;
        count++;
      }
    }
  }
  if (count < 10) return null;
  const noiseR = Math.max(1, Math.round(w * 0.003));
  const noiseC = Math.max(1, Math.round(h * 0.003));
  let y0 = 0;
  while (y0 < h && rows[y0] <= noiseR) y0++;
  let y1 = h - 1;
  while (y1 > y0 && rows[y1] <= noiseR) y1--;
  let x0 = 0;
  while (x0 < w && cols[x0] <= noiseC) x0++;
  let x1 = w - 1;
  while (x1 > x0 && cols[x1] <= noiseC) x1--;
  if (x1 <= x0 || y1 <= y0) return null;
  const margin = Math.round(Math.max(x1 - x0, y1 - y0) * 0.08);
  const nx0 = Math.max(0, x0 - margin);
  const ny0 = Math.max(0, y0 - margin);
  const nx1 = Math.min(w, x1 + margin + 1);
  const ny1 = Math.min(h, y1 + margin + 1);
  // Not worth trimming if it would remove almost nothing.
  if ((nx1 - nx0) * (ny1 - ny0) > w * h * 0.92) return null;
  return { x: nx0 / w, y: ny0 / h, w: (nx1 - nx0) / w, h: (ny1 - ny0) / h };
}
