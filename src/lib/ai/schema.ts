/**
 * The tool the model fills in, and the deterministic conversion of its output
 * into a PacketSpec. The model only extracts what the text says (numbers with
 * their units, verbatim evidence); all unit arithmetic happens here in code.
 */
import { z } from "zod";
import { finaliseRequirement, newId } from "../engine/rules-parser";
import {
  DEFAULT_NAMING,
  type DocumentRequirement,
  type KnownFormat,
  type OutputFormat,
  type PacketSpec,
} from "../engine/types";
import { toBytes, toMm } from "../engine/units";

const sizeSchema = {
  type: "object",
  properties: {
    value: { type: "number" },
    unit: { type: "string", enum: ["B", "KB", "KiB", "MB", "MiB", "GB"] },
  },
  required: ["value", "unit"],
};

export const EXTRACTION_TOOL = {
  name: "record_upload_requirements",
  description: "Record every file the applicant must upload and the technical rules each file must meet.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short name of the application, e.g. 'Graduate application — Northbridge University'." },
      documents: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Name of the upload slot as the instructions call it." },
            kind: { type: "string", enum: ["photo", "signature", "id-document", "document", "other"] },
            required: { type: "boolean" },
            formats: {
              type: "array",
              items: { type: "string", enum: ["jpg", "png", "webp", "pdf", "heic", "gif", "tiff", "bmp", "docx", "doc", "odt", "rtf", "txt"] },
            },
            maxSize: sizeSchema,
            minSize: sizeSchema,
            pixels: {
              type: "object",
              properties: {
                minWidth: { type: "integer" },
                maxWidth: { type: "integer" },
                minHeight: { type: "integer" },
                maxHeight: { type: "integer" },
                exactWidth: { type: "integer" },
                exactHeight: { type: "integer" },
              },
            },
            aspectRatio: {
              type: "object",
              properties: { width: { type: "number" }, height: { type: "number" } },
              required: ["width", "height"],
            },
            printSize: {
              type: "object",
              properties: { width: { type: "number" }, height: { type: "number" }, unit: { type: "string", enum: ["mm", "cm", "in"] } },
              required: ["width", "height", "unit"],
            },
            dpi: { type: "integer" },
            minDpi: { type: "integer" },
            colorMode: { type: "string", enum: ["color", "grayscale"] },
            background: { type: "string", enum: ["white", "light", "plain"] },
            minPages: { type: "integer" },
            maxPages: { type: "integer" },
            maxFiles: { type: "integer" },
            combine: { type: "string", enum: ["merge", "separate"] },
            evidence: { type: "array", items: { type: "string" }, description: "Short verbatim quotes supporting this entry." },
            notes: { type: "array", items: { type: "string" }, description: "Rules that don't fit the fields above." },
          },
          required: ["label", "kind", "required", "formats", "evidence"],
        },
      },
      totalMaxSize: sizeSchema,
      naming: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          allowSpaces: { type: "boolean" },
          maxLength: { type: "integer" },
          case: { type: "string", enum: ["keep", "lower", "upper"] },
        },
      },
      warnings: { type: "array", items: { type: "string" } },
      confidence: { type: "number", description: "0–1: how completely the instructions were captured." },
    },
    required: ["title", "documents"],
  },
} as const;

export const SYSTEM_PROMPT = `You read the upload instructions of an online application (job, university, housing, visa or government) and record every file the applicant must upload, with the technical rules each file must meet, by calling the record_upload_requirements tool.

Rules:
- One entry per upload slot. When several items go into one upload ("3 payslips in one PDF", "front and back of the ID in one file"), make one entry with combine = "merge".
- Record only rules that the instructions state or clearly imply. Never invent limits. When a rule applies to all files ("All files must be PDF under 5 MB"), copy it onto every entry it applies to.
- Sizes: give the number and unit exactly as written (KB, MB…); do not convert. French "Ko"/"Mo" are KB/MB.
- Pixel dimensions go in "pixels". A bare "600 x 600 pixels" is exactWidth/exactHeight; "at least"/"minimum" → min; "at most"/"maximum"/"up to" → max; ranges → both.
- Print sizes in mm, cm or inches go in "printSize". Resolution in dpi goes in "dpi"; also set "minDpi" when it is a minimum.
- "Square" means aspectRatio 1:1.
- kind: photo = a picture of the applicant's face; signature; id-document = passport, ID card, residence permit, driving licence; document = anything else.
- formats: accepted formats in the order given ("JPEG" → "jpg"). Leave the list empty when no format is stated.
- evidence: short verbatim quotes (under 25 words each) that support the entry. For screenshots, transcribe the relevant text.
- notes: rules that can't be expressed in the fields, such as "dated within the last 3 months", "must be signed" or "certified translation".
- naming: if the instructions prescribe file names, write a pattern with the tokens {LASTNAME}, {Lastname}, {FIRSTNAME}, {Firstname}, {DOC}, {Doc}, {REF}, {date} and {n}, following the casing of the instructions' example.
- warnings: genuine ambiguities the applicant should double-check. Don't mention KB = 1000 vs 1024 bytes; that is handled.
- Write labels and notes in the language of the instructions.
If the input isn't upload instructions, return an empty documents list and explain in warnings.`;

const sizeZ = z.object({ value: z.number().positive(), unit: z.string() }).partial({ unit: true });
const intZ = z.number().int().positive().optional();

const docZ = z.object({
  label: z.string().min(1).max(120),
  kind: z.enum(["photo", "signature", "id-document", "document", "other"]).catch("document"),
  required: z.boolean().catch(true),
  formats: z.array(z.string()).catch([]),
  maxSize: sizeZ.optional().catch(undefined),
  minSize: sizeZ.optional().catch(undefined),
  pixels: z
    .object({ minWidth: intZ, maxWidth: intZ, minHeight: intZ, maxHeight: intZ, exactWidth: intZ, exactHeight: intZ })
    .partial()
    .optional()
    .catch(undefined),
  aspectRatio: z.object({ width: z.number().positive(), height: z.number().positive() }).optional().catch(undefined),
  printSize: z.object({ width: z.number().positive(), height: z.number().positive(), unit: z.string() }).optional().catch(undefined),
  dpi: z.number().positive().optional().catch(undefined),
  minDpi: z.number().positive().optional().catch(undefined),
  colorMode: z.enum(["color", "grayscale"]).optional().catch(undefined),
  background: z.enum(["white", "light", "plain"]).optional().catch(undefined),
  minPages: intZ.catch(undefined),
  maxPages: intZ.catch(undefined),
  maxFiles: intZ.catch(undefined),
  combine: z.enum(["merge", "separate"]).optional().catch(undefined),
  evidence: z.array(z.string()).catch([]),
  notes: z.array(z.string()).optional().catch([]),
});

export const extractionZ = z.object({
  title: z.string().catch("Application packet"),
  documents: z.array(z.unknown()).catch([]),
  totalMaxSize: sizeZ.optional().catch(undefined),
  naming: z
    .object({
      pattern: z.string().optional(),
      allowSpaces: z.boolean().optional(),
      maxLength: z.number().int().positive().optional(),
      case: z.enum(["keep", "lower", "upper"]).optional(),
    })
    .optional()
    .catch(undefined),
  warnings: z.array(z.string()).catch([]),
  confidence: z.number().min(0).max(1).optional().catch(undefined),
});

const PRODUCIBLE: OutputFormat[] = ["jpg", "png", "webp", "pdf"];
const FORMAT_ALIASES: Record<string, KnownFormat> = { jpeg: "jpg", jpg: "jpg", tif: "tiff", heif: "heic" };

function bytes(size: z.infer<typeof sizeZ> | undefined, bound: "max" | "min"): number | undefined {
  if (!size) return undefined;
  try {
    return toBytes(size.value, size.unit ?? "B", bound);
  } catch {
    return undefined;
  }
}

const clean = (list: string[] | undefined, max: number) =>
  Array.from(new Set((list ?? []).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean))).slice(0, max);

export function toPacketSpec(raw: unknown, model: string): PacketSpec {
  const parsed = extractionZ.parse(raw);
  const documents: DocumentRequirement[] = [];
  for (const item of parsed.documents) {
    const result = docZ.safeParse(item);
    if (!result.success) continue;
    const d = result.data;
    const formats = d.formats.map((f) => FORMAT_ALIASES[f.toLowerCase()] ?? (f.toLowerCase() as KnownFormat));
    const accepted = formats.filter((f): f is OutputFormat => PRODUCIBLE.includes(f as OutputFormat));
    const passThrough = formats.filter((f) => !PRODUCIBLE.includes(f as OutputFormat) && f !== "heic");
    const defaults: Record<string, OutputFormat[]> = {
      photo: ["jpg", "png"],
      signature: ["jpg", "png"],
      "id-document": ["pdf", "jpg"],
      document: ["pdf"],
      other: ["pdf", "jpg"],
    };
    let physW: number | undefined;
    let physH: number | undefined;
    if (d.printSize) {
      try {
        physW = Math.round(toMm(d.printSize.width, d.printSize.unit) * 100) / 100;
        physH = Math.round(toMm(d.printSize.height, d.printSize.unit) * 100) / 100;
      } catch {
        /* unknown unit */
      }
    }
    documents.push(
      finaliseRequirement({
        id: newId(),
        label: d.label.trim(),
        kind: d.kind,
        required: d.required,
        acceptedFormats: formats.length ? accepted : defaults[d.kind],
        passThroughFormats: passThrough,
        maxBytes: bytes(d.maxSize, "max"),
        minBytes: bytes(d.minSize, "min"),
        minWidth: d.pixels?.minWidth,
        maxWidth: d.pixels?.maxWidth,
        minHeight: d.pixels?.minHeight,
        maxHeight: d.pixels?.maxHeight,
        exactWidth: d.pixels?.exactWidth,
        exactHeight: d.pixels?.exactHeight,
        aspectRatio: d.aspectRatio ? d.aspectRatio.width / d.aspectRatio.height : undefined,
        physicalWidthMm: physW,
        physicalHeightMm: physH,
        dpi: d.dpi ? Math.round(d.dpi) : undefined,
        minDpi: d.minDpi ? Math.round(d.minDpi) : d.dpi ? Math.round(d.dpi) : undefined,
        colorMode: d.colorMode,
        background: d.background,
        minPages: d.minPages,
        maxPages: d.maxPages,
        maxFiles: d.maxFiles,
        combine: d.combine,
        evidence: clean(d.evidence, 6),
        notes: clean(d.notes, 4),
      }),
    );
  }

  const naming = { ...DEFAULT_NAMING };
  if (parsed.naming?.pattern && /\{(?:LASTNAME|Lastname|lastname|FIRSTNAME|Firstname|firstname|DOC|Doc|doc|REF|Ref|ref|date|n)\}/.test(parsed.naming.pattern)) {
    naming.pattern = parsed.naming.pattern.replace(/\.(pdf|jpe?g|png)$/i, "");
  }
  if (parsed.naming?.allowSpaces !== undefined) naming.allowSpaces = parsed.naming.allowSpaces;
  if (parsed.naming?.maxLength) naming.maxLength = Math.max(12, Math.min(255, parsed.naming.maxLength));
  if (parsed.naming?.case) naming.case = parsed.naming.case;

  const warnings = clean(parsed.warnings, 6);
  if (!documents.length && !warnings.length) warnings.push("No documents were found in these instructions. Add them manually.");

  return {
    title: parsed.title.trim().slice(0, 120) || "Application packet",
    documents,
    totalMaxBytes: bytes(parsed.totalMaxSize, "max"),
    naming,
    warnings,
    source: "ai",
    model,
    confidence: Math.min(0.97, parsed.confidence ?? 0.9),
  };
}
