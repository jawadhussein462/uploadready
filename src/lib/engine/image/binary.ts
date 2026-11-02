/**
 * Byte-level helpers for JPEG, PNG and WebP: read dimensions and DPI without
 * decoding, write DPI metadata, and pad a file up to a minimum size with
 * comment data that viewers ignore.
 */

/* ----------------------------- CRC32 (PNG) ------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/* --------------------------------- JPEG --------------------------------- */

export interface ImageInfo {
  width: number;
  height: number;
  dpiX?: number;
  dpiY?: number;
  /** Number of colour components (1 = greyscale) for JPEG; colour type for PNG. */
  channels?: number;
}

interface JpegSegment {
  marker: number;
  start: number; // offset of 0xFF
  length: number; // total bytes including marker
}

function jpegSegments(b: Uint8Array): JpegSegment[] {
  const out: JpegSegment[] = [];
  if (b[0] !== 0xff || b[1] !== 0xd8) return out;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = u16(b, i + 2);
    out.push({ marker, start: i, length: len + 2 });
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end
    i += len + 2;
  }
  return out;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export function readJpegInfo(b: Uint8Array): ImageInfo | null {
  let info: ImageInfo | null = null;
  let dpiX: number | undefined;
  let dpiY: number | undefined;
  for (const s of jpegSegments(b)) {
    if (s.marker === 0xe0 && String.fromCharCode(b[s.start + 4], b[s.start + 5], b[s.start + 6], b[s.start + 7]) === "JFIF") {
      const units = b[s.start + 11];
      const x = u16(b, s.start + 12);
      const y = u16(b, s.start + 14);
      if (units === 1) {
        dpiX = x;
        dpiY = y;
      } else if (units === 2) {
        dpiX = Math.round(x * 2.54);
        dpiY = Math.round(y * 2.54);
      }
    }
    if (SOF.has(s.marker)) {
      info = { height: u16(b, s.start + 5), width: u16(b, s.start + 7), channels: b[s.start + 9] };
    }
  }
  if (info) {
    info.dpiX = dpiX;
    info.dpiY = dpiY;
  }
  return info;
}

/** Write DPI into the JFIF header (inserting one if the encoder did not). */
export function setJpegDpi(b: Uint8Array, dpi: number): Uint8Array {
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  const segs = jpegSegments(b);
  const jfif = segs.find(
    (s) => s.marker === 0xe0 && String.fromCharCode(b[s.start + 4], b[s.start + 5], b[s.start + 6], b[s.start + 7]) === "JFIF",
  );
  if (jfif) {
    const out = b.slice();
    out[jfif.start + 11] = 1;
    out[jfif.start + 12] = d >> 8;
    out[jfif.start + 13] = d & 0xff;
    out[jfif.start + 14] = d >> 8;
    out[jfif.start + 15] = d & 0xff;
    return out;
  }
  const app0 = new Uint8Array([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x01, d >> 8, d & 0xff, d >> 8, d & 0xff, 0x00, 0x00]);
  return concat([b.subarray(0, 2), app0, b.subarray(2)]);
}

/** Insert JPEG comment segments so the file grows by exactly `extra` bytes (min 4). */
export function padJpeg(b: Uint8Array, extra: number): Uint8Array {
  if (extra <= 0) return b;
  const segs = jpegSegments(b);
  const afterApp0 = segs.find((s) => s.marker === 0xe0);
  const insertAt = afterApp0 ? afterApp0.start + afterApp0.length : 2;
  const chunks: Uint8Array[] = [];
  let remaining = Math.max(4, extra);
  while (remaining > 0) {
    const payload = Math.min(65533, Math.max(0, remaining - 4));
    const seg = new Uint8Array(payload + 4);
    seg[0] = 0xff;
    seg[1] = 0xfe;
    seg[2] = (payload + 2) >> 8;
    seg[3] = (payload + 2) & 0xff;
    seg.fill(0x20, 4);
    chunks.push(seg);
    remaining -= payload + 4;
  }
  return concat([b.subarray(0, insertAt), ...chunks, b.subarray(insertAt)]);
}

/* ---------------------------------- PNG --------------------------------- */

interface PngChunk {
  type: string;
  start: number; // offset of the length field
  length: number; // data length
}

function pngChunks(b: Uint8Array): PngChunk[] {
  const out: PngChunk[] = [];
  let i = 8;
  while (i + 12 <= b.length) {
    const length = u32(b, i);
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    out.push({ type, start: i, length });
    i += 12 + length;
    if (type === "IEND") break;
  }
  return out;
}

export function readPngInfo(b: Uint8Array): ImageInfo | null {
  const chunks = pngChunks(b);
  const ihdr = chunks.find((c) => c.type === "IHDR");
  if (!ihdr) return null;
  const info: ImageInfo = { width: u32(b, ihdr.start + 8), height: u32(b, ihdr.start + 12), channels: b[ihdr.start + 8 + 9] };
  const phys = chunks.find((c) => c.type === "pHYs");
  if (phys && b[phys.start + 16] === 1) {
    info.dpiX = Math.round(u32(b, phys.start + 8) * 0.0254);
    info.dpiY = Math.round(u32(b, phys.start + 12) * 0.0254);
  }
  return info;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const len = data.length;
  out[0] = (len >>> 24) & 0xff;
  out[1] = (len >>> 16) & 0xff;
  out[2] = (len >>> 8) & 0xff;
  out[3] = len & 0xff;
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const c = crc32(out, 4, 8 + len);
  out[8 + len] = (c >>> 24) & 0xff;
  out[9 + len] = (c >>> 16) & 0xff;
  out[10 + len] = (c >>> 8) & 0xff;
  out[11 + len] = c & 0xff;
  return out;
}

export function setPngDpi(b: Uint8Array, dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254);
  const data = new Uint8Array(9);
  for (const offset of [0, 4]) {
    data[offset] = (ppm >>> 24) & 0xff;
    data[offset + 1] = (ppm >>> 16) & 0xff;
    data[offset + 2] = (ppm >>> 8) & 0xff;
    data[offset + 3] = ppm & 0xff;
  }
  data[8] = 1;
  const chunks = pngChunks(b);
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  for (const c of chunks) {
    if (c.type === "pHYs") continue;
    parts.push(b.subarray(c.start, c.start + 12 + c.length));
    if (c.type === "IHDR") parts.push(makePngChunk("pHYs", data));
  }
  return concat(parts);
}

/** Add a tEXt comment chunk so the file grows by `extra` bytes (min 21). */
export function padPng(b: Uint8Array, extra: number): Uint8Array {
  if (extra <= 0) return b;
  const keyword = "Comment";
  const textLen = Math.max(1, extra - 12 - keyword.length - 1);
  const data = new Uint8Array(keyword.length + 1 + textLen);
  for (let i = 0; i < keyword.length; i++) data[i] = keyword.charCodeAt(i);
  data[keyword.length] = 0;
  data.fill(0x20, keyword.length + 1);
  const chunks = pngChunks(b);
  const iend = chunks.find((c) => c.type === "IEND");
  if (!iend) return b;
  return concat([b.subarray(0, iend.start), makePngChunk("tEXt", data), b.subarray(iend.start)]);
}

/* --------------------------------- WebP --------------------------------- */

export function readWebpInfo(b: Uint8Array): ImageInfo | null {
  if (b.length < 30) return null;
  const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (tag === "VP8X") {
    const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    return { width: w, height: h };
  }
  if (tag === "VP8 ") {
    const w = (b[26] | (b[27] << 8)) & 0x3fff;
    const h = (b[28] | (b[29] << 8)) & 0x3fff;
    return { width: w, height: h };
  }
  if (tag === "VP8L") {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

export function readImageInfo(b: Uint8Array, format: string): ImageInfo | null {
  if (format === "jpg") return readJpegInfo(b);
  if (format === "png") return readPngInfo(b);
  if (format === "webp") return readWebpInfo(b);
  return null;
}
