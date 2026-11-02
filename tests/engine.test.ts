import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { assignFiles, hungarian, type FileFeatures } from "@/lib/engine/assign";
import { crc32, padJpeg, padPng, readJpegInfo, readPngInfo, setJpegDpi, setPngDpi } from "@/lib/engine/image/binary";
import { ssim, laplacianVariance, isGrayscale, rgbToLab } from "@/lib/engine/image/analysis";
import { inkBox, padToAspect, centreCrop } from "@/lib/engine/image/framing";
import { sniffFormat } from "@/lib/engine/magic";
import { buildFileName, docSlug, sanitizeFileName, uniqueNames } from "@/lib/engine/naming";
import { checkOutput } from "@/lib/engine/validate";
import { DEFAULT_NAMING, emptyRequirement } from "@/lib/engine/types";
import { formatBytes, toBytes } from "@/lib/engine/units";

const jpeg = new Uint8Array(readFileSync(new URL("./fixtures/tiny.jpg", import.meta.url)));

function makePng(w: number, h: number): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = new Uint8Array(h * (1 + w * 3));
  const parts = [new Uint8Array(sig), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array())];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe("units", () => {
  it("reads ambiguous units strictly", () => {
    expect(toBytes(240, "KB", "max")).toBe(240_000);
    expect(toBytes(54, "KB", "min")).toBe(55_296);
    expect(toBytes(2, "MiB", "max")).toBe(2_097_152);
    expect(toBytes(5, "Mo", "max")).toBe(5_000_000);
  });
  it("formats sizes in decimal units", () => {
    expect(formatBytes(231_456)).toBe("231 kB");
    expect(formatBytes(1_950_000)).toBe("1.95 MB");
  });
});

describe("magic bytes", () => {
  it("identifies formats regardless of extension", () => {
    expect(sniffFormat(jpeg, "photo.png")).toBe("jpg");
    expect(sniffFormat(makePng(2, 2), "x.jpg")).toBe("png");
    expect(sniffFormat(new TextEncoder().encode("%PDF-1.7\n..."), "a.txt")).toBe("pdf");
    const heic = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic"), 0, 0, 0, 0]);
    expect(sniffFormat(heic, "IMG_1.HEIC")).toBe("heic");
  });
});

describe("JPEG metadata", () => {
  it("reads dimensions and writes DPI in place", () => {
    expect(readJpegInfo(jpeg)).toMatchObject({ width: 16, height: 8, channels: 3 });
    const patched = setJpegDpi(jpeg, 300);
    expect(patched.length).toBe(jpeg.length);
    expect(readJpegInfo(patched)).toMatchObject({ dpiX: 300, dpiY: 300 });
  });
  it("inserts a JFIF header when missing", () => {
    const len = (jpeg[4] << 8) | jpeg[5];
    const stripped = new Uint8Array([...jpeg.subarray(0, 2), ...jpeg.subarray(4 + len)]);
    const patched = setJpegDpi(stripped, 200);
    expect(readJpegInfo(patched)).toMatchObject({ width: 16, dpiX: 200 });
  });
  it("pads to an exact size and stays readable", () => {
    const padded = padJpeg(jpeg, 70_000);
    expect(padded.length).toBe(jpeg.length + 70_000);
    expect(readJpegInfo(padded)).toMatchObject({ width: 16, height: 8 });
  });
});

describe("PNG metadata", () => {
  it("writes a valid pHYs chunk", () => {
    const png = makePng(20, 10);
    const patched = setPngDpi(png, 300);
    const info = readPngInfo(patched)!;
    expect(info).toMatchObject({ width: 20, height: 10, dpiX: 300 });
    // CRC of the inserted chunk must be valid.
    const i = 8 + 25; // after signature + IHDR chunk
    const len = new DataView(patched.buffer).getUint32(i);
    expect(String.fromCharCode(...patched.subarray(i + 4, i + 8))).toBe("pHYs");
    const crc = new DataView(patched.buffer).getUint32(i + 8 + len);
    expect(crc).toBe(crc32(patched, i + 4, i + 8 + len));
  });
  it("pads with a text chunk", () => {
    const png = makePng(4, 4);
    const padded = padPng(png, 500);
    expect(padded.length).toBe(png.length + 500);
    expect(readPngInfo(padded)).toMatchObject({ width: 4 });
  });
});

function gradient(w: number, h: number, noise = 0, seed = 1): Float32Array {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = Math.max(0, Math.min(255, ((x * 7 + y * 3) % 255) + noise * rand()));
  return a;
}

describe("image analysis", () => {
  it("SSIM is 1 for identical images and drops with noise", () => {
    const a = gradient(64, 64);
    expect(ssim(a, a, 64, 64)).toBeCloseTo(1, 6);
    const lo = ssim(a, gradient(64, 64, 10), 64, 64);
    const hi = ssim(a, gradient(64, 64, 40), 64, 64);
    expect(lo).toBeLessThan(1);
    expect(hi).toBeLessThan(lo);
  });
  it("Laplacian variance is zero on flat images", () => {
    expect(laplacianVariance(new Float32Array(100).fill(128), 10, 10)).toBe(0);
  });
  it("detects greyscale pixels", () => {
    const grey = new Uint8ClampedArray(4 * 100).map((_, i) => (i % 4 === 3 ? 255 : 120));
    expect(isGrayscale({ data: grey, width: 10, height: 10 })).toBe(true);
  });
  it("converts white to L* = 100", () => {
    expect(rgbToLab(255, 255, 255)[0]).toBeCloseTo(100, 0);
  });
});

describe("framing geometry", () => {
  it("pads to an aspect ratio without shrinking", () => {
    const r = padToAspect({ x: 0, y: 0, w: 1, h: 1 }, 1, 200, 100);
    expect(r.w * 200).toBeCloseTo(200);
    expect(r.h * 100).toBeCloseTo(200);
    expect(r.y).toBeCloseTo(-0.5);
  });
  it("centre-crops to an aspect ratio", () => {
    const r = centreCrop(1, 200, 100);
    expect(r).toMatchObject({ y: 0, h: 1 });
    expect(r.w).toBeCloseTo(0.5);
  });
  it("finds the ink box of a signature", () => {
    const w = 100;
    const h = 50;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 20; y < 30; y++) for (let x = 30; x < 70; x++) data.set([20, 20, 60, 255], (y * w + x) * 4);
    const box = inkBox({ data, width: w, height: h })!;
    expect(box.x * w).toBeLessThan(30);
    expect((box.x + box.w) * w).toBeGreaterThan(70);
    expect(box.w).toBeLessThan(0.6);
  });
});

describe("Hungarian assignment", () => {
  it("finds the optimal assignment", () => {
    const cost = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    const a = hungarian(cost);
    const total = a.reduce((s, j, i) => s + cost[i][j], 0);
    expect(total).toBe(5);
  });
  it("handles rectangular matrices", () => {
    const a = hungarian([
      [1, 9],
      [9, 1],
      [5, 5],
    ]);
    expect(a.filter((j) => j >= 0)).toHaveLength(2);
    expect(a[0]).toBe(0);
    expect(a[1]).toBe(1);
  });
  it("matches files to slots by name and content", () => {
    const slots = [
      emptyRequirement({ id: "photo", label: "Passport-style photo", kind: "photo", acceptedFormats: ["jpg"] }),
      emptyRequirement({ id: "sig", label: "Scanned signature", kind: "signature", acceptedFormats: ["jpg", "png"] }),
      emptyRequirement({ id: "cv", label: "CV / résumé", acceptedFormats: ["pdf"] }),
      emptyRequirement({ id: "tr", label: "Academic transcripts", acceptedFormats: ["pdf"], combine: "merge" }),
    ];
    const files: FileFeatures[] = [
      { id: "a", name: "IMG_4032.HEIC", format: "heic", traits: { portrait: 0.9, signature: 0, page: 0 } },
      { id: "b", name: "my signature.png", format: "png", traits: { portrait: 0, signature: 0.8, page: 0.2 } },
      { id: "c", name: "Resume_2026_final.pdf", format: "pdf", pages: 2 },
      { id: "d", name: "transcript-year1.pdf", format: "pdf", pages: 1 },
      { id: "e", name: "transcript-year2.pdf", format: "pdf", pages: 1 },
      { id: "f", name: "notes.docx", format: "docx" },
    ];
    const res = assignFiles(files, slots);
    expect(res).toMatchObject({ a: "photo", b: "sig", c: "cv", d: "tr", e: "tr", f: null });
  });
});

describe("naming", () => {
  it("builds names from patterns", () => {
    const name = buildFileName({
      naming: { ...DEFAULT_NAMING, pattern: "{LASTNAME}_{Firstname}_{Doc}" },
      applicant: { firstName: "marie-hélène", lastName: "Dupont" },
      docLabel: "Passport-style photo",
      ext: "jpg",
    });
    expect(name).toBe("DUPONT_Marie-Helene_Passport-style-photo.jpg");
  });
  it("drops empty tokens cleanly", () => {
    const name = buildFileName({ naming: DEFAULT_NAMING, pattern: "{Lastname}_{Firstname}_{Doc}", applicant: { firstName: "", lastName: "" }, docLabel: "CV / résumé", ext: "pdf" });
    expect(name).toBe("CV-resume.pdf");
  });
  it("sanitises and de-duplicates", () => {
    expect(sanitizeFileName("Scan 14 Mar (2)", "pdf", DEFAULT_NAMING)).toBe("Scan_14_Mar_2.pdf");
    expect(uniqueNames(["a.pdf", "A.pdf", "b.pdf"])).toEqual(["a.pdf", "A-2.pdf", "b.pdf"]);
    expect(docSlug("Pièce d'identité (recto-verso)")).toBe("Piece-d-identite");
    expect(docSlug("Contrat de travail ou attestation employeur")).toBe("Contrat-de-travail-ou-attestation");
    expect(docSlug("Copy of the passport of")).toBe("Copy-of-the-passport");
  });
});

describe("validation", () => {
  it("reports pass and fail from the bytes", () => {
    const req = emptyRequirement({
      id: "p",
      label: "Photo",
      kind: "photo",
      acceptedFormats: ["jpg"],
      maxBytes: 240_000,
      exactWidth: 16,
      exactHeight: 8,
      aspectRatio: 2,
      dpi: 300,
    });
    const good = checkOutput({ name: "Photo.jpg", bytes: setJpegDpi(jpeg, 300) }, req, DEFAULT_NAMING);
    expect(good.every((c) => c.status === "pass")).toBe(true);
    const bad = checkOutput({ name: "My Photo.png", bytes: jpeg }, { ...req, exactWidth: 600 }, DEFAULT_NAMING);
    const failed = bad.filter((c) => c.status === "fail").map((c) => c.id);
    expect(failed).toEqual(expect.arrayContaining(["extension", "dimensions", "dpi", "name"]));
  });
});
