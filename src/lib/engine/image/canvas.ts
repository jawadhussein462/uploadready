/**
 * Browser-only canvas helpers: decoding (including iPhone HEIC), high-quality
 * resampling, cropping with padding, rotation and encoding.
 */
import type { ImageOutputFormat, KnownFormat } from "../types";
import type { RGBA } from "./analysis";
import { FULL, type Rect } from "./framing";

export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
type Source = ImageBitmap | AnyCanvas;

const MIME: Record<ImageOutputFormat, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

export function createCanvas(w: number, h: number): AnyCanvas {
  const width = Math.max(1, Math.round(w));
  const height = Math.max(1, Math.round(h));
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

export function ctx2d(c: AnyCanvas, readFrequently = false): Ctx {
  const ctx = c.getContext("2d", { willReadFrequently: readFrequently }) as Ctx | null;
  if (!ctx) throw new Error("Canvas 2D is not available in this browser.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

export async function canvasToBlob(c: AnyCanvas, type: string, quality?: number): Promise<Blob> {
  if ("convertToBlob" in c) return c.convertToBlob({ type, quality });
  return new Promise((resolve, reject) =>
    (c as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error("Encoding failed"))), type, quality),
  );
}

export function readPixels(c: AnyCanvas): ImageData {
  return ctx2d(c, true).getImageData(0, 0, c.width, c.height);
}

export function canvasFromPixels(img: RGBA): AnyCanvas {
  const c = createCanvas(img.width, img.height);
  const data = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  ctx2d(c).putImageData(data, 0, 0);
  return c;
}

export class UnsupportedEncodingError extends Error {}

export async function encodeCanvas(c: AnyCanvas, format: ImageOutputFormat, quality?: number): Promise<Blob> {
  const blob = await canvasToBlob(c, MIME[format], format === "png" ? undefined : quality);
  if (blob.type && blob.type !== MIME[format]) throw new UnsupportedEncodingError(`${format} encoding is not supported in this browser`);
  return blob;
}

const encoderSupport = new Map<ImageOutputFormat, boolean>();
export async function canEncode(format: ImageOutputFormat): Promise<boolean> {
  if (encoderSupport.has(format)) return encoderSupport.get(format)!;
  let ok = false;
  try {
    const c = createCanvas(2, 2);
    ctx2d(c).fillRect(0, 0, 1, 1);
    await encodeCanvas(c, format, 0.8);
    ok = true;
  } catch {
    ok = false;
  }
  encoderSupport.set(format, ok);
  return ok;
}

/* -------------------------------- Decoding ------------------------------ */

const MAX_WORKING_PIXELS = 36_000_000;

export async function decodeImage(blob: Blob, format: KnownFormat): Promise<ImageBitmap> {
  let source: Blob = blob;
  if (format === "heic") {
    try {
      return await limitSize(await createImageBitmap(blob));
    } catch {
      const { default: heic2any } = await import("heic2any");
      const converted = await heic2any({ blob, toType: "image/jpeg", quality: 0.95 });
      source = Array.isArray(converted) ? converted[0] : converted;
    }
  }
  try {
    const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
    return await limitSize(bitmap);
  } catch {
    if (format === "tiff") throw new Error("This browser can't read TIFF files. Export the image as JPG or PDF and add it again.");
    throw new Error("This image could not be read. It may be damaged or in an unsupported format.");
  }
}

async function limitSize(bitmap: ImageBitmap): Promise<ImageBitmap> {
  const pixels = bitmap.width * bitmap.height;
  if (pixels <= MAX_WORKING_PIXELS) return bitmap;
  const s = Math.sqrt(MAX_WORKING_PIXELS / pixels);
  const resized = await createImageBitmap(bitmap, {
    resizeWidth: Math.round(bitmap.width * s),
    resizeHeight: Math.round(bitmap.height * s),
    resizeQuality: "high",
  });
  bitmap.close();
  return resized;
}

/* ------------------------------- Resampling ----------------------------- */

/**
 * Draw `rect` (source-normalised, may extend outside the image) into a new
 * canvas of dw×dh. Large reductions are done in halving steps, which avoids the
 * aliasing a single bilinear pass produces.
 */
export function renderRect(src: Source, rect: Rect, dw: number, dh: number, pad: [number, number, number] = [255, 255, 255]): AnyCanvas {
  const W = Math.max(1, Math.round(dw));
  const H = Math.max(1, Math.round(dh));
  let source: Source = src;
  let sW = src.width;
  let sH = src.height;
  let scale = Math.min(W / (rect.w * sW), H / (rect.h * sH));
  while (scale < 0.5 && sW > 2 && sH > 2) {
    const nw = Math.max(1, Math.round(sW / 2));
    const nh = Math.max(1, Math.round(sH / 2));
    const c = createCanvas(nw, nh);
    ctx2d(c).drawImage(source, 0, 0, sW, sH, 0, 0, nw, nh);
    source = c;
    scale *= sW / nw;
    sW = nw;
    sH = nh;
  }
  const out = createCanvas(W, H);
  const ctx = ctx2d(out);
  ctx.fillStyle = `rgb(${pad[0]},${pad[1]},${pad[2]})`;
  ctx.fillRect(0, 0, W, H);
  const rx = rect.x * sW;
  const ry = rect.y * sH;
  const rw = rect.w * sW;
  const rh = rect.h * sH;
  const ix0 = Math.max(0, rx);
  const iy0 = Math.max(0, ry);
  const ix1 = Math.min(sW, rx + rw);
  const iy1 = Math.min(sH, ry + rh);
  if (ix1 > ix0 && iy1 > iy0) {
    const dx0 = ((ix0 - rx) / rw) * W;
    const dy0 = ((iy0 - ry) / rh) * H;
    const dx1 = ((ix1 - rx) / rw) * W;
    const dy1 = ((iy1 - ry) / rh) * H;
    ctx.drawImage(source, ix0, iy0, ix1 - ix0, iy1 - iy0, dx0, dy0, dx1 - dx0, dy1 - dy0);
  }
  return out;
}

export function resize(src: Source, w: number, h: number): AnyCanvas {
  return renderRect(src, FULL, w, h);
}

/** Fit inside a box (never enlarging) for analysis/thumbnails. */
export function fitWithin(srcW: number, srcH: number, maxSide: number): [number, number] {
  const s = Math.min(1, maxSide / Math.max(srcW, srcH));
  return [Math.max(1, Math.round(srcW * s)), Math.max(1, Math.round(srcH * s))];
}

export function analysisPixels(src: Source, maxSide = 320): ImageData {
  const [w, h] = fitWithin(src.width, src.height, maxSide);
  return readPixels(resize(src, w, h));
}

export function rotate(src: Source, quarterTurns: number): AnyCanvas {
  const q = ((quarterTurns % 4) + 4) % 4;
  const w = q % 2 ? src.height : src.width;
  const h = q % 2 ? src.width : src.height;
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.translate(w / 2, h / 2);
  ctx.rotate((q * Math.PI) / 2);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

export async function blobToCanvas(blob: Blob, w?: number, h?: number): Promise<AnyCanvas> {
  const bmp = await createImageBitmap(blob);
  const c = resize(bmp, w ?? bmp.width, h ?? bmp.height);
  bmp.close();
  return c;
}

export async function canvasToObjectUrl(c: AnyCanvas, maxSide = 640, format: ImageOutputFormat = "jpg"): Promise<string> {
  const [w, h] = fitWithin(c.width, c.height, maxSide);
  const small = w === c.width && h === c.height ? c : resize(c, w, h);
  const blob = await encodeCanvas(small, format, 0.85);
  return URL.createObjectURL(blob);
}
