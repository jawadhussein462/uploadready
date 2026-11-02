/**
 * PDF assembly and size fitting.
 *
 * Strategy ladder (stops at the first that fits the limit):
 *   1. Keep original PDF pages untouched; embed images as JPEG (q 0.9, 200 dpi).
 *   2. Re-encode only the embedded images, lowering resolution (150→100 dpi)
 *      and bisecting JPEG quality.
 *   3. Re-render every page with pdf.js (150→72 dpi) and bisect JPEG quality.
 *      Text stops being selectable, so this is reported to the user.
 */
import { PDFDocument, type PDFPage } from "pdf-lib";
import { ssim, toLuma } from "../image/analysis";
import { encodeCanvas, fitWithin, readPixels, resize, type AnyCanvas } from "../image/canvas";
import { closePdf, openPdf, renderPage } from "./pdfjs";

export type PdfPart = { kind: "pdf"; bytes: Uint8Array; name: string; encrypted?: boolean } | { kind: "image"; canvas: AnyCanvas; name: string };

export interface PdfBuildResult {
  bytes: Uint8Array;
  pages: number;
  strategy: "original" | "images" | "rasterized";
  dpi?: number;
  quality?: number;
  fidelity: number;
  overLimit: boolean;
  notes: string[];
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 28;
const NATURAL_DPI = 150;

/** Where an image goes on its A4 page, in points. */
function imagePlacement(pxW: number, pxH: number) {
  const landscape = pxW > pxH * 1.15;
  const [pageW, pageH] = landscape ? [A4[1], A4[0]] : A4;
  const maxW = pageW - 2 * MARGIN;
  const maxH = pageH - 2 * MARGIN;
  // Small images keep their natural size at 150 dpi; large ones are fitted to the page.
  const naturalW = pxW * (72 / NATURAL_DPI);
  let w = Math.min(maxW, naturalW);
  let h = (w * pxH) / pxW;
  if (h > maxH) {
    h = maxH;
    w = (h * pxW) / pxH;
  }
  return { pageW, pageH, x: (pageW - w) / 2, y: (pageH - h) / 2, w, h };
}

interface Cache {
  images: Map<string, AnyCanvas>;
  raster: Map<string, { canvas: AnyCanvas; widthPt: number; heightPt: number }[]>;
  docs: Map<number, PDFDocument>;
}

async function imageCanvasAt(part: Extract<PdfPart, { kind: "image" }>, index: number, dpi: number, cache: Cache) {
  const key = `${index}:${dpi}`;
  if (!cache.images.has(key)) {
    const place = imagePlacement(part.canvas.width, part.canvas.height);
    const targetW = Math.min(part.canvas.width, Math.round((place.w / 72) * dpi));
    const targetH = Math.round((targetW * part.canvas.height) / part.canvas.width);
    cache.images.set(key, targetW === part.canvas.width ? part.canvas : resize(part.canvas, targetW, targetH));
  }
  return cache.images.get(key)!;
}

async function rasterPages(part: Extract<PdfPart, { kind: "pdf" }>, index: number, dpi: number, cache: Cache) {
  const key = `${index}:${dpi}`;
  if (!cache.raster.has(key)) {
    const doc = await openPdf(part.bytes);
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) pages.push(await renderPage(doc, p, dpi));
    await closePdf(doc);
    cache.raster.set(key, pages);
  }
  return cache.raster.get(key)!;
}

async function assemble(
  parts: PdfPart[],
  mode: { raster: boolean; dpi: number; quality: number },
  cache: Cache,
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.kind === "pdf" && !mode.raster && !part.encrypted) {
      let src = cache.docs.get(i);
      if (!src) {
        src = await PDFDocument.load(part.bytes, { ignoreEncryption: true, updateMetadata: false });
        cache.docs.set(i, src);
      }
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p: PDFPage) => out.addPage(p));
      continue;
    }
    if (part.kind === "pdf") {
      for (const page of await rasterPages(part, i, mode.dpi, cache)) {
        const jpg = await encodeCanvas(page.canvas, "jpg", mode.quality);
        const img = await out.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
        const pdfPage = out.addPage([page.widthPt, page.heightPt]);
        pdfPage.drawImage(img, { x: 0, y: 0, width: page.widthPt, height: page.heightPt });
      }
      continue;
    }
    const canvas = await imageCanvasAt(part, i, mode.dpi, cache);
    const place = imagePlacement(part.canvas.width, part.canvas.height);
    const jpg = await encodeCanvas(canvas, "jpg", mode.quality);
    const img = await out.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
    const page = out.addPage([place.pageW, place.pageH]);
    page.drawImage(img, { x: place.x, y: place.y, width: place.w, height: place.h });
  }
  out.setProducer("UploadReady");
  out.setCreator("UploadReady");
  return out.save({ useObjectStreams: true });
}

async function firstPageFidelity(parts: PdfPart[], mode: { raster: boolean; dpi: number; quality: number }, cache: Cache): Promise<number> {
  const idx = parts.findIndex((p) => p.kind === "image" || mode.raster || (p.kind === "pdf" && p.encrypted));
  if (idx < 0) return 1;
  const part = parts[idx];
  let reference: AnyCanvas;
  let candidate: AnyCanvas;
  if (part.kind === "image") {
    reference = part.canvas;
    candidate = await imageCanvasAt(part, idx, mode.dpi, cache);
  } else {
    reference = (await rasterPages(part, idx, 150, cache))[0].canvas;
    candidate = (await rasterPages(part, idx, mode.dpi, cache))[0].canvas;
  }
  const [aw, ah] = fitWithin(reference.width, reference.height, 900);
  const ref = toLuma(readPixels(resize(reference, aw, ah)));
  const blob = await encodeCanvas(candidate, "jpg", mode.quality);
  const bmp = await createImageBitmap(blob);
  const cand = toLuma(readPixels(resize(bmp, aw, ah)));
  bmp.close();
  return ssim(ref, cand, aw, ah);
}

/** True when any of the first pages carries real text (so re-rendering would lose selectable text). */
async function pdfHasText(bytes: Uint8Array): Promise<boolean> {
  try {
    const doc = await openPdf(bytes);
    let found = false;
    for (let p = 1; p <= Math.min(2, doc.numPages) && !found; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      found = content.items.some((it) => "str" in it && it.str.trim().length > 0);
    }
    await closePdf(doc);
    return found;
  } catch {
    return false;
  }
}

async function countPages(parts: PdfPart[], cache: Cache): Promise<number> {
  let n = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.kind === "image") {
      n++;
      continue;
    }
    try {
      let doc = cache.docs.get(i);
      if (!doc) {
        doc = await PDFDocument.load(part.bytes, { ignoreEncryption: true, updateMetadata: false });
        cache.docs.set(i, doc);
      }
      n += doc.getPageCount();
    } catch {
      n += 1;
    }
  }
  return n;
}

export async function buildPdf(
  parts: PdfPart[],
  maxBytes?: number,
  onProgress?: (f: number) => void,
  options: { imageDpi?: number } = {},
): Promise<PdfBuildResult> {
  const cache: Cache = { images: new Map(), raster: new Map(), docs: new Map() };
  const budget = maxBytes ? maxBytes - 256 : Number.POSITIVE_INFINITY;
  const notes: string[] = [];
  const hasImages = parts.some((p) => p.kind === "image");
  const hasEncrypted = parts.some((p) => p.kind === "pdf" && p.encrypted);
  if (hasEncrypted) notes.push("A protected PDF was re-rendered page by page so the portal can open it.");

  const finish = async (bytes: Uint8Array, strategy: PdfBuildResult["strategy"], mode: { raster: boolean; dpi: number; quality: number }, overLimit = false) => {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const fidelity = strategy === "original" && !hasImages && !hasEncrypted ? 1 : await firstPageFidelity(parts, mode, cache);
    onProgress?.(1);
    return {
      bytes,
      pages: doc.getPageCount(),
      strategy,
      dpi: strategy === "original" && !hasImages ? undefined : mode.dpi,
      quality: strategy === "original" && !hasImages ? undefined : mode.quality,
      fidelity,
      overLimit,
      notes,
    } satisfies PdfBuildResult;
  };

  // 1. Originals untouched.
  onProgress?.(0.1);
  const first = { raster: false, dpi: Math.max(200, Math.min(600, options.imageDpi ?? 200)), quality: 0.9 };
  let smallest = await assemble(parts, first, cache);
  let smallestMode = first;
  if (smallest.length <= budget) return finish(smallest, "original", first);

  // 2. Re-encode embedded images only.
  if (hasImages) {
    let step = 0;
    for (const dpi of [first.dpi > 200 ? first.dpi : 0, 150, 120, 100].filter(Boolean)) {
      onProgress?.(0.15 + 0.1 * step++);
      const found = await bisectQuality(async (q) => assemble(parts, { raster: false, dpi, quality: q }, cache), budget, 0.45, 0.88);
      if (found.fit) {
        notes.push(`Images were saved at ${dpi} dpi to fit the size limit.`);
        return finish(found.fit, "images", { raster: false, dpi, quality: found.quality });
      }
      if (found.smallest.length < smallest.length) {
        smallest = found.smallest;
        smallestMode = { raster: false, dpi, quality: 0.45 };
      }
    }
  }

  // 3. Re-render every page. Small documents start at print resolution; prefer
  // the highest resolution that still allows a reasonable JPEG quality (≥ 0.5).
  const pages = await countPages(parts, cache);
  const ladder = pages <= 4 ? [300, 220, 150, 120, 100, 85, 72] : pages <= 12 ? [200, 150, 120, 100, 85, 72] : [150, 120, 100, 85, 72];
  let textLost = false;
  for (const part of parts) if (part.kind === "pdf" && (await pdfHasText(part.bytes))) textLost = true;
  const rasterNote = (dpi: number) =>
    textLost
      ? `Pages were re-rendered at ${dpi} dpi to fit the size limit, so text in this file can no longer be selected.`
      : `Scanned pages were re-saved at ${dpi} dpi to fit the size limit.`;
  let step = 0;
  let fallback: { bytes: Uint8Array; dpi: number; quality: number } | null = null;
  for (const dpi of ladder) {
    onProgress?.(0.45 + (0.5 * step++) / ladder.length);
    const found = await bisectQuality(async (q) => assemble(parts, { raster: true, dpi, quality: q }, cache), budget, 0.35, 0.9);
    if (found.fit && found.quality >= 0.5) {
      notes.push(rasterNote(dpi));
      return finish(found.fit, "rasterized", { raster: true, dpi, quality: found.quality });
    }
    if (found.fit && !fallback) fallback = { bytes: found.fit, dpi, quality: found.quality };
    // Free the renders of this resolution before trying the next one.
    if (!fallback || fallback.dpi !== dpi) {
      for (const key of Array.from(cache.raster.keys())) if (key.endsWith(`:${dpi}`) && dpi !== 150) cache.raster.delete(key);
    }
    if (found.smallest.length < smallest.length) {
      smallest = found.smallest;
      smallestMode = { raster: true, dpi, quality: 0.35 };
    }
  }
  if (fallback) {
    notes.push(rasterNote(fallback.dpi));
    return finish(fallback.bytes, "rasterized", { raster: true, dpi: fallback.dpi, quality: fallback.quality });
  }
  return finish(smallest, smallestMode.raster ? "rasterized" : "images", smallestMode, true);
}

async function bisectQuality(make: (q: number) => Promise<Uint8Array>, budget: number, lo: number, hi: number) {
  const top = await make(hi);
  if (top.length <= budget) return { fit: top, quality: hi, smallest: top };
  const bottom = await make(lo);
  if (bottom.length > budget) return { fit: null, quality: lo, smallest: bottom };
  let fit = bottom;
  let quality = lo;
  for (let i = 0; i < 5; i++) {
    const mid = (lo + hi) / 2;
    const b = await make(mid);
    if (b.length <= budget) {
      lo = mid;
      fit = b;
      quality = mid;
    } else hi = mid;
  }
  return { fit, quality: Math.round(quality * 100) / 100, smallest: bottom };
}

export interface PdfInspection {
  pages: number;
  encrypted: boolean;
  needsPassword: boolean;
}

export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return { pages: doc.getPageCount(), encrypted: doc.isEncrypted, needsPassword: false };
  } catch {
    try {
      const doc = await openPdf(bytes);
      const pages = doc.numPages;
      await closePdf(doc);
      return { pages, encrypted: true, needsPassword: false };
    } catch (err) {
      const name = (err as { name?: string })?.name;
      return { pages: 0, encrypted: true, needsPassword: name === "PasswordException" };
    }
  }
}
