/**
 * Final verification. Every check reads the produced bytes again (format from
 * magic bytes, dimensions and DPI from headers) instead of trusting what the
 * pipeline intended to write.
 */
import { FORMAT_LABEL, sniffFormat } from "./magic";
import { nameProblems } from "./naming";
import type { Check, DocumentRequirement, KnownFormat, NamingRules } from "./types";
import { formatBytes, formatRatio, pxToMm } from "./units";
import { readImageInfo } from "./image/binary";

export interface OutputFacts {
  name: string;
  bytes: Uint8Array;
  pages?: number;
  /** Measured on the final pixels by the pipeline. */
  grayscale?: boolean;
}

export function checkOutput(facts: OutputFacts, req: DocumentRequirement, naming: NamingRules): Check[] {
  const checks: Check[] = [];
  const format: KnownFormat = sniffFormat(facts.bytes, facts.name);
  const accepted: KnownFormat[] = [...req.acceptedFormats, ...req.passThroughFormats];
  const size = facts.bytes.length;

  checks.push({
    id: "format",
    label: "File type",
    status: accepted.includes(format) ? "pass" : "fail",
    detail: accepted.includes(format)
      ? `${FORMAT_LABEL[format]}, confirmed from the file's contents`
      : `${FORMAT_LABEL[format]} is not accepted. Accepted: ${accepted.map((f) => FORMAT_LABEL[f]).join(", ")}`,
  });

  const ext = facts.name.split(".").pop()?.toLowerCase() ?? "";
  const extOk = ext === format || (format === "jpg" && ext === "jpeg") || (format === "tiff" && ext === "tif");
  checks.push({
    id: "extension",
    label: "Extension",
    status: extOk ? "pass" : "fail",
    detail: extOk ? `.${ext} matches the contents` : `.${ext} does not match a ${FORMAT_LABEL[format]} file`,
  });

  if (req.maxBytes !== undefined || req.minBytes !== undefined) {
    const overMax = req.maxBytes !== undefined && size > req.maxBytes;
    const underMin = req.minBytes !== undefined && size < req.minBytes;
    const range =
      req.minBytes !== undefined && req.maxBytes !== undefined
        ? `between ${formatBytes(req.minBytes)} and ${formatBytes(req.maxBytes)}`
        : req.maxBytes !== undefined
          ? `up to ${formatBytes(req.maxBytes)}`
          : `at least ${formatBytes(req.minBytes!)}`;
    checks.push({
      id: "size",
      label: "File size",
      status: overMax || underMin ? "fail" : "pass",
      detail: `${formatBytes(size)} (${size.toLocaleString("en-US")} bytes); allowed ${range}`,
    });
  }

  const info = readImageInfo(facts.bytes, format);
  if (info) {
    const { width: w, height: h } = info;
    const dimIssues: string[] = [];
    if (req.exactWidth && w !== req.exactWidth) dimIssues.push(`width must be exactly ${req.exactWidth} px`);
    if (req.exactHeight && h !== req.exactHeight) dimIssues.push(`height must be exactly ${req.exactHeight} px`);
    if (req.minWidth && w < req.minWidth) dimIssues.push(`width must be at least ${req.minWidth} px`);
    if (req.minHeight && h < req.minHeight) dimIssues.push(`height must be at least ${req.minHeight} px`);
    if (req.maxWidth && w > req.maxWidth) dimIssues.push(`width must be at most ${req.maxWidth} px`);
    if (req.maxHeight && h > req.maxHeight) dimIssues.push(`height must be at most ${req.maxHeight} px`);
    const hasDimRule = req.exactWidth || req.exactHeight || req.minWidth || req.minHeight || req.maxWidth || req.maxHeight;
    checks.push({
      id: "dimensions",
      label: "Dimensions",
      status: dimIssues.length ? "fail" : "pass",
      detail: `${w} × ${h} px${dimIssues.length ? `; ${dimIssues.join(", ")}` : hasDimRule ? ", within the limits" : ""}`,
    });

    if (req.aspectRatio) {
      const ratio = w / h;
      const off = Math.abs(ratio - req.aspectRatio) / req.aspectRatio;
      checks.push({
        id: "ratio",
        label: "Proportions",
        status: off <= 0.01 ? "pass" : "fail",
        detail: `${formatRatio(ratio)}; required ${formatRatio(req.aspectRatio)}`,
      });
    }

    if (req.dpi) {
      if (format === "webp") {
        checks.push({ id: "dpi", label: "DPI metadata", status: "warn", detail: "WebP files can't store DPI. Choose JPG or PNG if the portal checks it." });
      } else {
        const ok = info.dpiX === req.dpi && info.dpiY === req.dpi;
        checks.push({
          id: "dpi",
          label: "DPI metadata",
          status: ok ? "pass" : "fail",
          detail: ok ? `${req.dpi} dpi written into the file` : `File says ${info.dpiX ?? "no"} dpi; required ${req.dpi}`,
        });
      }
    }

    if (req.physicalWidthMm && req.physicalHeightMm && req.minDpi) {
      const effective = Math.min(w / (req.physicalWidthMm / 25.4), h / (req.physicalHeightMm / 25.4));
      checks.push({
        id: "resolution",
        label: "Print resolution",
        status: effective + 0.5 >= req.minDpi ? "pass" : "warn",
        detail: `${Math.round(effective)} dpi at ${round1(req.physicalWidthMm)} × ${round1(req.physicalHeightMm)} mm (needs ${req.minDpi})`,
      });
    } else if (req.physicalWidthMm && req.physicalHeightMm) {
      checks.push({
        id: "resolution",
        label: "Print size",
        status: "pass",
        detail: `Prints at ${round1(req.physicalWidthMm)} × ${round1(req.physicalHeightMm)} mm (${Math.round(w / (req.physicalWidthMm / 25.4))} dpi)`,
      });
    }

    if (req.colorMode === "grayscale") {
      checks.push({
        id: "colour",
        label: "Black and white",
        status: facts.grayscale ? "pass" : "fail",
        detail: facts.grayscale ? "Converted to greyscale" : "The image still contains colour",
      });
    } else if (req.colorMode === "color" && facts.grayscale) {
      checks.push({ id: "colour", label: "Colour", status: "warn", detail: "This image has no colour, but a colour copy is requested" });
    }
  }

  if (format === "pdf" && facts.pages !== undefined) {
    const over = req.maxPages !== undefined && facts.pages > req.maxPages;
    const under = req.minPages !== undefined && facts.pages < req.minPages;
    const rule =
      req.maxPages !== undefined && req.minPages !== undefined
        ? `; allowed ${req.minPages}–${req.maxPages}`
        : req.maxPages !== undefined
          ? `; limit ${req.maxPages}`
          : req.minPages !== undefined
            ? `; at least ${req.minPages}`
            : "";
    checks.push({
      id: "pages",
      label: "Pages",
      status: over || under ? "fail" : "pass",
      detail: `${facts.pages} page${facts.pages === 1 ? "" : "s"}${rule}`,
    });
  }

  const problems = nameProblems(facts.name, naming);
  checks.push({
    id: "name",
    label: "File name",
    status: problems.length ? "fail" : "pass",
    detail: problems.length ? `The name ${problems.join(" and ")}` : facts.name,
  });

  return checks;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export { pxToMm };
