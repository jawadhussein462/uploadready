/**
 * Browser pipeline: turns the files assigned to one requirement slot into
 * ready-to-upload output files, then verifies them.
 */
import { borderStats, exposureStats, isGrayscale, laplacianVariance, toLuma } from "./image/analysis";
import {
  analysisPixels,
  canvasFromPixels,
  canvasToObjectUrl,
  decodeImage,
  fitWithin,
  readPixels,
  renderRect,
  resize,
  rotate,
  type AnyCanvas,
} from "./image/canvas";
import { flattenPage, toGrayscale, whitenPaper } from "./image/enhance";
import { FULL, centreCrop, frameImage, type Framing, type Rect } from "./image/framing";
import { optimizeEncode, type TracePoint } from "./image/optimize";
import { buildPdf, type PdfPart } from "./pdf/assemble";
import { closePdf, openPdf, renderPage } from "./pdf/pdfjs";
import { EXTENSION, FORMAT_LABEL, MIME, isImageFormat } from "./magic";
import { buildFileName } from "./naming";
import { checkOutput } from "./validate";
import type {
  Applicant,
  Check,
  DocumentRequirement,
  ImageOutputFormat,
  Issue,
  KnownFormat,
  NamingRules,
  OutputFormat,
} from "./types";
import { formatBytes, mmToPx } from "./units";

export interface InputFile {
  id: string;
  name: string;
  size: number;
  format: KnownFormat;
  blob: Blob;
  width?: number;
  height?: number;
  pages?: number;
  encrypted?: boolean;
  needsPassword?: boolean;
  traits?: { portrait: number; signature: number; page: number };
  thumbUrl?: string;
  addedAt: number;
}

export interface SlotSettings {
  /** Manual framing, normalised to the rotated source. */
  crop?: Rect;
  rotation?: number;
  cleanup?: boolean;
  grayscale?: boolean;
  format?: OutputFormat;
}

export interface OutputFile {
  name: string;
  bytes: Uint8Array;
  format: KnownFormat;
  mime: string;
  width?: number;
  height?: number;
  pages?: number;
  quality?: number | null;
  fidelity?: number;
  previewUrl?: string;
  sourceIds: string[];
}

export interface SlotMetrics {
  sharpness?: number;
  sharpnessLabel?: "sharp" | "soft" | "blurry";
  backgroundL?: number;
  backgroundSpread?: number;
  exposure?: "ok" | "dark" | "bright";
  upscale?: number;
}

export interface FramingInfo {
  method: Framing["method"] | "manual";
  rect: Rect;
  aspect?: number;
  sourceUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  note?: string;
}

export interface SlotResult {
  slotId: string;
  status: "ready" | "attention" | "blocked" | "empty";
  outputs: OutputFile[];
  checks: Check[];
  issues: Issue[];
  notes: string[];
  metrics?: SlotMetrics;
  trace?: TracePoint[];
  framing?: FramingInfo;
  strategy?: string;
  durationMs: number;
}

export interface PipelineContext {
  naming: NamingRules;
  applicant: Applicant;
  onProgress?: (fraction: number, label: string) => void;
}

const PASS_THROUGH_FIX: Partial<Record<KnownFormat, string>> = {
  docx: "Open it in Word or Google Docs and choose File → Save as / Download → PDF, then add the PDF here.",
  doc: "Open it in Word and save it as PDF, then add the PDF here.",
  odt: "Open it in LibreOffice and export it as PDF, then add the PDF here.",
  rtf: "Open it and save it as PDF, then add the PDF here.",
  txt: "Save it as PDF, then add the PDF here.",
  zip: "Unzip it and add the files inside.",
};

/** Target pixel size for an image slot. */
export function targetSize(req: DocumentRequirement, cw: number, ch: number) {
  let w = cw;
  let h = ch;
  let lock = false;
  const exactW = req.exactWidth ?? (req.physicalWidthMm && req.dpi && !req.minWidth && !req.maxWidth ? mmToPx(req.physicalWidthMm, req.dpi) : undefined);
  const exactH = req.exactHeight ?? (req.physicalHeightMm && req.dpi && !req.minHeight && !req.maxHeight ? mmToPx(req.physicalHeightMm, req.dpi) : undefined);
  if (exactW && exactH) {
    w = exactW;
    h = exactH;
    lock = true;
  } else if (exactW) {
    w = exactW;
    h = Math.round((exactW * ch) / cw);
    lock = true;
  } else if (exactH) {
    h = exactH;
    w = Math.round((exactH * cw) / ch);
    lock = true;
  } else {
    const cap = req.kind === "photo" ? 2400 : req.kind === "signature" ? 1600 : 3200;
    const s = Math.min(1, (req.maxWidth ?? Infinity) / w, (req.maxHeight ?? Infinity) / h, cap / Math.max(w, h));
    w *= s;
    h *= s;
    const minW = req.minWidth ?? (req.physicalWidthMm && req.minDpi ? mmToPx(req.physicalWidthMm, req.minDpi) : undefined);
    const minH = req.minHeight ?? (req.physicalHeightMm && req.minDpi ? mmToPx(req.physicalHeightMm, req.minDpi) : undefined);
    const up = Math.max(minW ? minW / w : 1, minH ? minH / h : 1, 1);
    w *= up;
    h *= up;
    // Re-apply maxima after rounding so limits are never crossed.
    w = Math.min(Math.round(w), req.maxWidth ?? Infinity);
    h = Math.min(Math.round(h), req.maxHeight ?? Infinity);
  }
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), lock, upscale: Math.max(w / cw, h / ch) };
}

function aspectFor(req: DocumentRequirement): number | undefined {
  if (req.aspectRatio) return req.aspectRatio;
  if (req.exactWidth && req.exactHeight) return req.exactWidth / req.exactHeight;
  if (req.physicalWidthMm && req.physicalHeightMm) return req.physicalWidthMm / req.physicalHeightMm;
  return undefined;
}

function statusFrom(checks: Check[], issues: Issue[]): SlotResult["status"] {
  if (checks.some((c) => c.status === "fail") || issues.some((i) => i.severity === "fail")) return "blocked";
  if (checks.some((c) => c.status === "warn") || issues.some((i) => i.severity === "warn")) return "attention";
  return "ready";
}

async function loadSource(file: InputFile, rotation = 0): Promise<AnyCanvas | ImageBitmap> {
  let src: AnyCanvas | ImageBitmap;
  if (file.format === "pdf") {
    const doc = await openPdf(new Uint8Array(await file.blob.arrayBuffer()));
    src = (await renderPage(doc, 1, 220)).canvas;
    await closePdf(doc);
  } else {
    src = await decodeImage(file.blob, file.format);
  }
  return rotation ? rotate(src, rotation) : src;
}

/* ------------------------------------------------------------------------ */

export async function processSlot(
  req: DocumentRequirement,
  files: InputFile[],
  settings: SlotSettings,
  ctx: PipelineContext,
): Promise<SlotResult> {
  const started = performance.now();
  const base = { slotId: req.id, outputs: [], checks: [], notes: [], durationMs: 0 };
  if (files.length === 0) {
    return {
      ...base,
      status: "empty",
      issues: req.required ? [{ severity: "fail", message: `No file added for “${req.label}”.`, fix: "Add a file and assign it to this document." }] : [],
    };
  }

  const issues: Issue[] = [];
  const passThrough = files.filter((f) => req.passThroughFormats.includes(f.format));
  const processable = files.filter((f) => !req.passThroughFormats.includes(f.format) && (isImageFormat(f.format) || f.format === "pdf"));
  for (const f of files) {
    if (passThrough.includes(f) || processable.includes(f)) continue;
    issues.push({
      severity: "fail",
      message: `${f.name} is a ${FORMAT_LABEL[f.format]} file, which this document doesn't accept.`,
      fix: PASS_THROUGH_FIX[f.format] ?? "Convert it to PDF or JPG and add it again.",
    });
  }
  for (const f of processable) {
    if (f.needsPassword) {
      issues.push({
        severity: "fail",
        message: `${f.name} needs a password to open.`,
        fix: "Open it, print it to PDF (or remove the password), and add the new file.",
      });
    }
  }
  const usable = processable.filter((f) => !f.needsPassword);

  let result: Omit<SlotResult, "durationMs">;
  if (passThrough.length && !usable.length) {
    result = await passThroughSlot(req, passThrough, issues, ctx);
  } else if (!usable.length) {
    result = { ...base, status: "blocked", issues };
  } else {
    const imageFormats = req.acceptedFormats.filter((f): f is ImageOutputFormat => f !== "pdf");
    const wantsPdf = req.acceptedFormats.includes("pdf");
    let mode: "image" | "pdf";
    const chosen = settings.format && req.acceptedFormats.includes(settings.format) ? settings.format : undefined;
    if (chosen) mode = chosen === "pdf" ? "pdf" : "image";
    else if (!imageFormats.length) mode = "pdf";
    else if (!wantsPdf) mode = "image";
    else if (req.kind === "photo" || req.kind === "signature") mode = "image";
    else if (usable.some((f) => f.format === "pdf")) mode = "pdf";
    else mode = req.acceptedFormats[0] === "pdf" ? "pdf" : "image";

    const separate = req.combine === "separate" || (req.maxFiles ?? 1) > 1;
    if (mode === "image" && usable.length > 1 && !separate && wantsPdf) mode = "pdf";

    if (mode === "pdf") {
      result = await pdfSlot(req, usable, settings, issues, ctx);
    } else {
      const formats = chosen && chosen !== "pdf" ? [chosen as ImageOutputFormat, ...imageFormats.filter((f) => f !== chosen)] : imageFormats;
      let inputs = usable;
      if (usable.length > 1 && !separate) {
        issues.push({
          severity: "warn",
          message: `This document takes one file, so only ${usable[0].name} was used.`,
          fix: "Remove the extra files or move them to another document.",
        });
        inputs = usable.slice(0, 1);
      }
      if (req.maxFiles && inputs.length > req.maxFiles) {
        issues.push({ severity: "fail", message: `Up to ${req.maxFiles} files are allowed here; ${inputs.length} were added.` });
      }
      result = await imageSlot(req, inputs, formats, settings, issues, ctx);
    }
    if (passThrough.length) {
      issues.push({ severity: "warn", message: "Some files could not be combined with the others and were left out.", fix: "Use one file type per document." });
    }
  }
  return { ...result, durationMs: Math.round(performance.now() - started) };
}

/* ------------------------------- Images --------------------------------- */

async function imageSlot(
  req: DocumentRequirement,
  inputs: InputFile[],
  formats: ImageOutputFormat[],
  settings: SlotSettings,
  issues: Issue[],
  ctx: PipelineContext,
): Promise<Omit<SlotResult, "durationMs">> {
  const outputs: OutputFile[] = [];
  const checks: Check[] = [];
  const notes: string[] = [];
  let metrics: SlotMetrics | undefined;
  let trace: TracePoint[] | undefined;
  let framingInfo: FramingInfo | undefined;
  const aspect = aspectFor(req);
  const grayscale = req.colorMode === "grayscale" || !!settings.grayscale;

  for (let i = 0; i < inputs.length; i++) {
    const file = inputs[i];
    const report = (f: number, label: string) => ctx.onProgress?.((i + f) / inputs.length, label);
    report(0.02, `Reading ${file.name}`);
    const source = await loadSource(file, settings.rotation);
    if (file.format === "pdf" && (file.pages ?? 1) > 1) {
      issues.push({ severity: "warn", message: `${file.name} has ${file.pages} pages; only the first page was used for this image.` });
    }

    // Framing
    report(0.12, "Framing");
    const small = analysisPixels(source, 320);
    let framing: Framing;
    let method: FramingInfo["method"];
    if (settings.crop) {
      framing = { rect: settings.crop, method: "none", confidence: 1, padColor: borderStats(small).median };
      method = "manual";
    } else {
      framing = frameImage(small, req.kind, aspect);
      method = framing.method;
    }
    if (aspect && method !== "manual") {
      const r = framing.rect;
      const rectAspect = (r.w * source.width) / (r.h * source.height);
      if (Math.abs(rectAspect - aspect) / aspect > 0.01) framing.rect = centreCrop(aspect, source.width, source.height);
    }
    if (framing.note) notes.push(framing.note);
    if (i === 0) {
      const [pw, ph] = fitWithin(source.width, source.height, 900);
      framingInfo = {
        method,
        rect: framing.rect,
        aspect,
        sourceUrl: await canvasToObjectUrl(resize(source, pw, ph), 900),
        sourceWidth: source.width,
        sourceHeight: source.height,
        note: framing.note,
      };
    }

    // Size
    const cropW = framing.rect.w * source.width;
    const cropH = framing.rect.h * source.height;
    const size = targetSize(req, cropW, cropH);
    let canvas = renderRect(source, framing.rect, size.w, size.h, framing.padColor);
    if ("close" in source && typeof source.close === "function") source.close();
    if (size.upscale > 1.25) {
      issues.push({
        severity: "warn",
        message: `${file.name} is smaller than required and was enlarged ${Math.round((size.upscale - 1) * 100)}%. It may look soft.`,
        fix: "Use a higher-resolution original if you have one.",
      });
    }

    // Pixel clean-up
    report(0.25, "Cleaning up");
    const wantsCleanup = settings.cleanup ?? req.kind === "signature";
    if (wantsCleanup || grayscale) {
      const px = readPixels(canvas);
      if (wantsCleanup) {
        if (req.kind === "signature") whitenPaper(px);
        else flattenPage(px);
      }
      if (grayscale) toGrayscale(px);
      canvas = canvasFromPixels(px);
      if (wantsCleanup) notes.push(req.kind === "signature" ? "Made the paper behind the signature pure white." : "Evened out shadows and paper colour.");
    }

    // Encode under the limits
    report(0.35, "Finding the best quality under the size limit");
    const opt = await optimizeEncode({
      canvas,
      formats,
      kind: req.kind,
      maxBytes: req.maxBytes,
      minBytes: req.minBytes,
      minWidth: req.minWidth ?? req.exactWidth,
      minHeight: req.minHeight ?? req.exactHeight,
      lockDimensions: size.lock,
      dpi: req.dpi,
      onProgress: (f) => report(0.35 + f * 0.55, "Finding the best quality under the size limit"),
    });
    if (opt.overLimit && req.maxBytes) {
      issues.push({
        severity: "fail",
        message: `Even the smallest version is ${formatBytes(opt.bytes.length)}, over the ${formatBytes(req.maxBytes)} limit.`,
        fix: "Allow a smaller size in the rules (if the portal does) or crop the image tighter.",
      });
    }
    if (opt.padded) notes.push(`Added ${formatBytes(opt.padded)} of neutral metadata to meet the minimum size.`);
    if (opt.width !== size.w) notes.push(`Reduced to ${opt.width} × ${opt.height} px, which kept more detail than heavier compression.`);

    // Measurements on the final pixels
    const finalPx = readPixels(opt.width === canvas.width ? canvas : resize(canvas, opt.width, opt.height));
    const [mw, mh] = fitWithin(finalPx.width, finalPx.height, 1024);
    const measure = mw === finalPx.width ? finalPx : readPixels(resize(canvasFromPixels(finalPx), mw, mh));
    const luma = toLuma(measure);
    const sharpness = laplacianVariance(luma, measure.width, measure.height);
    const exp = exposureStats(luma);
    const border = borderStats(measure);
    if (i === 0) {
      metrics = {
        sharpness,
        sharpnessLabel: sharpness < 35 ? "blurry" : sharpness < 90 ? "soft" : "sharp",
        backgroundL: border.meanL,
        backgroundSpread: border.spread,
        exposure: exp.mean < 60 ? "dark" : exp.clippedHighlights > 0.12 && req.kind === "photo" ? "bright" : "ok",
        upscale: size.upscale,
      };
      trace = opt.trace;
    }

    const name = buildFileName({
      naming: ctx.naming,
      pattern: req.namingPattern,
      applicant: ctx.applicant,
      docLabel: req.label,
      ext: EXTENSION[opt.format],
      index: i + 1,
      total: inputs.length,
    });
    const blob = new Blob([opt.bytes as BlobPart], { type: MIME[opt.format] });
    outputs.push({
      name,
      bytes: opt.bytes,
      format: opt.format,
      mime: MIME[opt.format],
      width: opt.width,
      height: opt.height,
      quality: opt.quality,
      fidelity: opt.ssim,
      previewUrl: URL.createObjectURL(blob),
      sourceIds: [file.id],
    });
    const outChecks = checkOutput({ name, bytes: opt.bytes, grayscale: isGrayscale(measure) }, req, ctx.naming);
    checks.push(...(inputs.length > 1 ? outChecks.map((c) => ({ ...c, id: `${c.id}-${i}`, label: `${c.label} (${i + 1})` })) : outChecks));
    report(1, "Done");
  }

  // Judgement checks (warnings, never blocking).
  if (metrics && req.kind === "photo") {
    if (metrics.sharpnessLabel === "blurry") checks.push({ id: "sharpness", label: "Sharpness", status: "warn", detail: "The photo looks blurry. Portals often reject unsharp photos." });
    else checks.push({ id: "sharpness", label: "Sharpness", status: "pass", detail: metrics.sharpnessLabel === "sharp" ? "In focus" : "Slightly soft but usable" });
    if (req.background) {
      const L = metrics.backgroundL ?? 0;
      const spread = metrics.backgroundSpread ?? 99;
      const ok = req.background === "white" ? L >= 86 && spread <= 9 : req.background === "light" ? L >= 68 && spread <= 12 : spread <= 12;
      checks.push({
        id: "background",
        label: "Background",
        status: ok ? "pass" : "warn",
        detail: ok
          ? `Plain${req.background === "white" ? " and white" : req.background === "light" ? " and light" : ""}`
          : `Looks ${L < 68 ? "dark" : "uneven"} near the edges; ${req.background === "white" ? "a plain white" : "a plain light"} background is required`,
      });
    }
    if (metrics.exposure !== "ok") {
      checks.push({ id: "exposure", label: "Lighting", status: "warn", detail: metrics.exposure === "dark" ? "The photo is quite dark" : "Parts of the photo are overexposed" });
    }
  }

  return {
    slotId: req.id,
    status: statusFrom(checks, issues),
    outputs,
    checks,
    issues,
    notes: Array.from(new Set(notes)),
    metrics,
    trace,
    framing: framingInfo,
    strategy: "image",
  };
}

/* -------------------------------- PDFs ---------------------------------- */

async function pdfSlot(
  req: DocumentRequirement,
  inputs: InputFile[],
  settings: SlotSettings,
  issues: Issue[],
  ctx: PipelineContext,
): Promise<Omit<SlotResult, "durationMs">> {
  const parts: PdfPart[] = [];
  const notes: string[] = [];
  const grayscale = req.colorMode === "grayscale" || !!settings.grayscale;
  ctx.onProgress?.(0.02, "Reading files");
  for (const f of inputs) {
    if (f.format === "pdf") {
      parts.push({ kind: "pdf", bytes: new Uint8Array(await f.blob.arrayBuffer()), name: f.name, encrypted: f.encrypted });
      continue;
    }
    let src: AnyCanvas | ImageBitmap = await decodeImage(f.blob, f.format);
    if (settings.rotation) src = rotate(src, settings.rotation);
    let canvas = renderRect(src, FULL, src.width, src.height);
    if ("close" in src && typeof src.close === "function") src.close();
    if (settings.cleanup || grayscale) {
      const px = readPixels(canvas);
      if (settings.cleanup) flattenPage(px);
      if (grayscale) toGrayscale(px);
      canvas = canvasFromPixels(px);
    }
    parts.push({ kind: "image", canvas, name: f.name });
  }
  if (settings.cleanup && inputs.some((f) => isImageFormat(f.format))) notes.push("Evened out shadows and paper colour on photographed pages.");
  if (grayscale && inputs.some((f) => f.format === "pdf")) {
    issues.push({ severity: "warn", message: "PDF pages were kept in their original colours.", fix: "If the portal insists on black and white, export the PDF in greyscale first." });
  }
  if (inputs.length > 1) notes.push(`Combined ${inputs.length} files into one PDF, in the order shown.`);

  ctx.onProgress?.(0.1, "Building the PDF");
  const built = await buildPdf(parts, req.maxBytes, (f) => ctx.onProgress?.(0.1 + f * 0.8, "Fitting the PDF under the size limit"), {
    imageDpi: req.minDpi ?? req.dpi,
  });
  notes.push(...built.notes);
  if (built.overLimit && req.maxBytes) {
    issues.push({
      severity: "fail",
      message: `The smallest readable version is ${formatBytes(built.bytes.length)}, over the ${formatBytes(req.maxBytes)} limit.`,
      fix: "Remove pages that aren't required, or split the document if the portal allows several files.",
    });
  }
  if (req.maxPages && built.pages > req.maxPages) {
    issues.push({
      severity: "fail",
      message: `The PDF has ${built.pages} pages; the limit is ${req.maxPages}.`,
      fix: "Remove the pages that aren't needed before adding the file.",
    });
  }

  const name = buildFileName({ naming: ctx.naming, pattern: req.namingPattern, applicant: ctx.applicant, docLabel: req.label, ext: "pdf" });
  ctx.onProgress?.(0.92, "Rendering a preview");
  let previewUrl: string | undefined;
  try {
    const doc = await openPdf(built.bytes);
    const page = await renderPage(doc, 1, 110);
    previewUrl = await canvasToObjectUrl(page.canvas, 1100);
    await closePdf(doc);
  } catch {
    previewUrl = undefined;
  }
  const checks = checkOutput({ name, bytes: built.bytes, pages: built.pages }, req, ctx.naming);
  ctx.onProgress?.(1, "Done");
  return {
    slotId: req.id,
    status: statusFrom(checks, issues),
    outputs: [
      {
        name,
        bytes: built.bytes,
        format: "pdf",
        mime: MIME.pdf,
        pages: built.pages,
        quality: built.quality ?? null,
        fidelity: built.fidelity,
        previewUrl,
        sourceIds: inputs.map((f) => f.id),
      },
    ],
    checks,
    issues,
    notes: Array.from(new Set(notes)),
    strategy: built.strategy,
  };
}

/* ---------------------------- Pass-through ------------------------------ */

async function passThroughSlot(req: DocumentRequirement, files: InputFile[], issues: Issue[], ctx: PipelineContext): Promise<Omit<SlotResult, "durationMs">> {
  const outputs: OutputFile[] = [];
  const checks: Check[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const bytes = new Uint8Array(await f.blob.arrayBuffer());
    const ext = f.format === "unknown" ? (f.name.split(".").pop() ?? "bin") : f.format;
    const name = buildFileName({
      naming: ctx.naming,
      pattern: req.namingPattern,
      applicant: ctx.applicant,
      docLabel: req.label,
      ext,
      index: i + 1,
      total: files.length,
    });
    outputs.push({ name, bytes, format: f.format, mime: f.blob.type || "application/octet-stream", sourceIds: [f.id], fidelity: 1 });
    checks.push(...checkOutput({ name, bytes }, req, ctx.naming));
  }
  return {
    slotId: req.id,
    status: statusFrom(checks, issues),
    outputs,
    checks,
    issues,
    notes: ["Kept your original file and renamed it. UploadReady can't edit this file type."],
    strategy: "pass-through",
  };
}
