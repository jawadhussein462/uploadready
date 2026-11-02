/**
 * Core data model shared by the browser engine, the API routes and the UI.
 * Units are always normalised: bytes, pixels, millimetres, dots-per-inch.
 */

/** Formats UploadReady can produce. */
export type OutputFormat = "jpg" | "png" | "webp" | "pdf";
export const OUTPUT_FORMATS: OutputFormat[] = ["jpg", "png", "webp", "pdf"];
export const IMAGE_OUTPUT_FORMATS = ["jpg", "png", "webp"] as const;
export type ImageOutputFormat = (typeof IMAGE_OUTPUT_FORMATS)[number];

/** Formats UploadReady can recognise (by magic bytes) on input. */
export type KnownFormat =
  | OutputFormat
  | "heic"
  | "avif"
  | "gif"
  | "bmp"
  | "tiff"
  | "docx"
  | "doc"
  | "odt"
  | "rtf"
  | "txt"
  | "zip"
  | "unknown";

export type DocumentKind = "photo" | "signature" | "id-document" | "document" | "other";

export interface DocumentRequirement {
  id: string;
  label: string;
  kind: DocumentKind;
  required: boolean;
  /** Formats the portal accepts that UploadReady can produce, in the order the instructions list them. */
  acceptedFormats: OutputFormat[];
  /** Formats the portal accepts that UploadReady cannot produce (e.g. docx). Inputs in these formats pass through. */
  passThroughFormats: KnownFormat[];
  maxBytes?: number;
  minBytes?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  exactWidth?: number;
  exactHeight?: number;
  /** width / height */
  aspectRatio?: number;
  physicalWidthMm?: number;
  physicalHeightMm?: number;
  /** DPI value to write into the file metadata. */
  dpi?: number;
  /** Minimum effective resolution at the physical print size. */
  minDpi?: number;
  colorMode?: "color" | "grayscale";
  background?: "white" | "light" | "plain";
  minPages?: number;
  maxPages?: number;
  /** How many files the portal accepts for this slot. */
  maxFiles?: number;
  /** What to do when several files are added to one slot. */
  combine?: "merge" | "separate";
  namingPattern?: string;
  /** Verbatim snippets from the instructions that justify the rules above. */
  evidence: string[];
  /** Rules that cannot be checked automatically (e.g. "dated within 3 months"). */
  notes: string[];
}

export interface NamingRules {
  /** Template with tokens such as {LASTNAME}, {Firstname}, {doc}, {n}. */
  pattern?: string;
  allowSpaces: boolean;
  maxLength: number;
  case: "keep" | "lower" | "upper";
}

export type SpecSource = "ai" | "rules" | "manual" | "sample";

export interface PacketSpec {
  title: string;
  documents: DocumentRequirement[];
  totalMaxBytes?: number;
  naming: NamingRules;
  /** Ambiguities the applicant should double-check. */
  warnings: string[];
  source: SpecSource;
  model?: string;
  /** 0..1 — how sure the reader is that it captured the rules. */
  confidence: number;
}

export interface Applicant {
  firstName: string;
  lastName: string;
}

export type CheckStatus = "pass" | "warn" | "fail";

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
}

/** Problems UploadReady found but could not fix on its own. */
export interface Issue {
  severity: "warn" | "fail";
  message: string;
  fix?: string;
}

export const DEFAULT_NAMING: NamingRules = {
  allowSpaces: false,
  maxLength: 80,
  case: "keep",
};

export function emptyRequirement(partial: Partial<DocumentRequirement> & { id: string; label: string }): DocumentRequirement {
  return {
    kind: "document",
    required: true,
    acceptedFormats: ["pdf"],
    passThroughFormats: [],
    evidence: [],
    notes: [],
    ...partial,
  };
}
