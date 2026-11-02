import type { KnownFormat, OutputFormat } from "./types";

/** Identify a file by its leading bytes rather than its extension. */
export function sniffFormat(bytes: Uint8Array, fileName = ""): KnownFormat {
  const b = bytes;
  const ascii = (start: number, len: number) => {
    let s = "";
    const end = Math.min(b.length, start + len);
    for (let i = start; i < end; i++) s += String.fromCharCode(b[i]);
    return s;
  };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 3) === "PNG") return "png";
  if (ascii(0, 1024).includes("%PDF-")) return "pdf";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "webp";
  if (ascii(0, 2) === "BM" && b.length > 26) return "bmp";
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a)) {
    return "tiff";
  }
  if (ascii(4, 4) === "ftyp") {
    const brands = ascii(8, 48);
    if (/avi[fs]/.test(brands)) return "avif";
    if (/hei[cxms]|hev[cx]|mif1|msf1/.test(brands)) return "heic";
  }
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4) {
    const s = ascii(0, 8192);
    if (s.includes("word/") || /\.docx$/i.test(fileName)) return "docx";
    if (s.includes("opendocument.text") || /\.odt$/i.test(fileName)) return "odt";
    return "zip";
  }
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "doc";
  if (ascii(0, 5) === "{\\rtf") return "rtf";
  if (looksLikeText(b)) return "txt";
  return formatFromName(fileName);
}

function looksLikeText(b: Uint8Array): boolean {
  if (b.length === 0) return false;
  const n = Math.min(b.length, 512);
  let printable = 0;
  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c >= 0xc0) printable++;
  }
  return printable / n > 0.95;
}

export function formatFromName(name: string): KnownFormat {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, KnownFormat> = {
    jpg: "jpg",
    jpeg: "jpg",
    png: "png",
    pdf: "pdf",
    webp: "webp",
    heic: "heic",
    heif: "heic",
    avif: "avif",
    gif: "gif",
    bmp: "bmp",
    tif: "tiff",
    tiff: "tiff",
    docx: "docx",
    doc: "doc",
    odt: "odt",
    rtf: "rtf",
    txt: "txt",
    zip: "zip",
  };
  return map[ext] ?? "unknown";
}

export const MIME: Record<OutputFormat, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

export const EXTENSION: Record<OutputFormat, string> = {
  jpg: "jpg",
  png: "png",
  webp: "webp",
  pdf: "pdf",
};

export const FORMAT_LABEL: Record<KnownFormat, string> = {
  jpg: "JPG",
  png: "PNG",
  webp: "WebP",
  pdf: "PDF",
  heic: "HEIC",
  avif: "AVIF",
  gif: "GIF",
  bmp: "BMP",
  tiff: "TIFF",
  docx: "Word",
  doc: "Word (old)",
  odt: "OpenDocument",
  rtf: "RTF",
  txt: "Text",
  zip: "ZIP",
  unknown: "Unknown",
};

export const IMAGE_INPUTS: KnownFormat[] = ["jpg", "png", "webp", "heic", "avif", "gif", "bmp", "tiff"];

export function isImageFormat(f: KnownFormat): boolean {
  return IMAGE_INPUTS.includes(f);
}
