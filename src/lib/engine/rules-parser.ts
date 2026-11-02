/**
 * Rule-based requirements reader (English + French).
 *
 * Works without any API key. It tokenises quantities (sizes, pixel boxes, print
 * sizes, DPI, page counts), classifies each one as a minimum / maximum / exact
 * value from the qualifier words that precede it, and attaches it to the
 * document(s) mentioned in the same sentence, line or heading block.
 */
import {
  DEFAULT_NAMING,
  type DocumentKind,
  type DocumentRequirement,
  type KnownFormat,
  type NamingRules,
  type OutputFormat,
  type PacketSpec,
} from "./types";
import { mmToPx, parseNumber, toBytes, toMm, type Bound } from "./units";

const LN = "\\p{L}\\p{N}";
const B = `(?<![${LN}])`;
const E = `(?![${LN}])`;
const words = (body: string, flags = "giu") => new RegExp(`${B}(?:${body})${E}`, flags);

/* ------------------------------------------------------------------------ */
/* Document lexicon                                                          */
/* ------------------------------------------------------------------------ */

interface DocType {
  key: string;
  label: string;
  kind: DocumentKind;
  re: RegExp;
}

export const DOC_TYPES: DocType[] = [
  {
    key: "photo",
    label: "Photo",
    kind: "photo",
    re: words(
      "passport[- ]?(?:size|style|type)?[- ]?photo(?:graph)?s?|id(?:entity)?[- ]photo(?:graph)?s?|photos? d['’]identit[ée]|digital photo(?:graph)?s?|digital portrait|head ?shots?|profile (?:picture|photo)s?|portrait photo(?:graph)?s?|photo(?:graph)?s?|pictures?|selfies?",
    ),
  },
  { key: "signature", label: "Signature", kind: "signature", re: words("(?:scanned |digital |handwritten )?signatures?") },
  {
    key: "id",
    label: "ID document",
    kind: "id-document",
    re: words(
      "passport(?: bio(?:graphical)?(?: data)? page| identity page| copy)?|passeport|national id(?:entity)? cards?|id cards?|identity cards?|identity documents?|proof of identity|driver['’]?s licen[cs]e|driving licen[cs]e|residence permit|visa page|pi[èe]ces? d['’]identit[ée]|cartes? (?:nationale )?d['’]identit[ée]|titres? de s[ée]jour|permis de conduire",
    ),
  },
  { key: "cv", label: "CV", kind: "document", re: words("cv|resume|résumé|curriculum vitae") },
  {
    key: "cover",
    label: "Cover letter",
    kind: "document",
    re: words(
      "cover letters?|motivation letters?|letters? of motivation|lettres? de motivation|personal statements?|statements? of purpose|motivation statements?",
    ),
  },
  { key: "transcript", label: "Transcripts", kind: "document", re: words("transcripts?|academic records?|grade reports?|mark ?sheets?|relev[ée]s? de notes") },
  { key: "diploma", label: "Diploma", kind: "document", re: words("diplomas?|degree certificates?|dipl[ôo]mes?") },
  {
    key: "recommendation",
    label: "Recommendation letter",
    kind: "document",
    re: words("(?:recommendation|reference) letters?|letters? of (?:recommendation|reference)|lettres? de recommandation"),
  },
  { key: "address", label: "Proof of address", kind: "document", re: words("proof of (?:address|residence)|utility bills?|justificatifs? de domicile") },
  { key: "rent", label: "Rent receipts", kind: "document", re: words("rent receipts?|quittances? de loyer") },
  {
    key: "payslips",
    label: "Payslips",
    kind: "document",
    re: words("pay ?slips?|pay stubs?|salary slips?|bulletins? de (?:salaire|paie)|fiches? de paie"),
  },
  { key: "tax", label: "Tax notice", kind: "document", re: words("tax (?:returns?|notices?|assessments?)|avis d['’]imposition") },
  { key: "bank", label: "Bank statements", kind: "document", re: words("bank statements?|relev[ée]s? (?:bancaires?|de compte)|proof of funds") },
  { key: "rib", label: "Bank details (RIB)", kind: "document", re: words("rib|bank details|iban certificate") },
  {
    key: "employment",
    label: "Employment proof",
    kind: "document",
    re: words(
      "employment (?:contract|letter|certificate)s?|work contracts?|employer (?:letter|certificate)s?|contrats? de travail|attestations? (?:d['’])?employeur",
    ),
  },
  { key: "language", label: "Language test score", kind: "document", re: words("ielts|toefl|toeic|duolingo english test|language (?:test|certificate)s?") },
  { key: "portfolio", label: "Portfolio", kind: "document", re: words("portfolios?|writing samples?") },
  { key: "birth", label: "Birth certificate", kind: "document", re: words("birth certificates?|actes? de naissance") },
  {
    key: "enrolment",
    label: "Proof of enrolment",
    kind: "document",
    re: words(
      "certificates? of enrol?lment|enrol?lment (?:certificate|letter)s?|student (?:id|card)s?|certificats? de scolarit[ée]|cartes? [ée]tudiantes?",
    ),
  },
  {
    key: "insurance",
    label: "Insurance certificate",
    kind: "document",
    re: words("insurance (?:certificate|attestation)s?|attestations? d['’]assurance|health insurance"),
  },
];

interface DocMention {
  key: string;
  label: string;
  kind: DocumentKind;
  index: number;
  text: string;
}

export function findDocMentions(text: string): DocMention[] {
  let work = text;
  const found: DocMention[] = [];
  for (const type of DOC_TYPES) {
    type.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    const spans: [number, number][] = [];
    while ((m = type.re.exec(work))) {
      if (!found.some((f) => f.key === type.key)) {
        found.push({ key: type.key, label: type.label, kind: type.kind, index: m.index, text: m[0] });
      }
      spans.push([m.index, m[0].length]);
    }
    for (const [i, n] of spans) work = work.slice(0, i) + " ".repeat(n) + work.slice(i + n);
  }
  return found.sort((a, b) => a.index - b.index);
}

/* ------------------------------------------------------------------------ */
/* Quantity tokens                                                           */
/* ------------------------------------------------------------------------ */

const NUM = "(\\d+(?:[.,]\\d+)?)";
const SIZE_UNIT =
  "kib|mib|gib|kilobytes?|megabytes?|gigabytes?|kbytes?|mbytes?|kbs?|mbs?|gbs?|ko|mo|go|bytes?|octets?";
const LEN_UNIT = "mm|cm|inch(?:es)?|in|\"|”|pouces?";
const SEP_RANGE = "\\s*(?:-|–|—|to|and|à|et)\\s*";
const NOT_LETTER = "(?![\\p{L}])";

type Token =
  | { type: "size"; value: number; unit: string; start: number; end: number; forced?: Bound }
  | { type: "px2"; w: number; h: number; start: number; end: number; forced?: Bound }
  | { type: "px1"; value: number; axis: "w" | "h" | "both"; start: number; end: number; forced?: Bound }
  | { type: "phys"; w: number; h: number; start: number; end: number }
  | { type: "dpi"; value: number; start: number; end: number }
  | { type: "pages"; value: number; start: number; end: number; forced?: Bound }
  | { type: "files"; value: number; start: number; end: number }
  | { type: "ratio"; value: number; start: number; end: number };

const QUALIFIERS: [string, Bound, boolean][] = [
  ["no (?:more|larger|bigger|greater|higher) than", "max", true],
  ["no (?:less|smaller|fewer|lower) than", "min", true],
  ["not (?:to )?(?:exceed|be (?:more|larger|bigger|greater) than)", "max", true],
  ["(?:must|should|may|shall|does|do|can)(?: not|n['’]t) (?:be )?exceed(?:ing)?|cannot exceed|can['’]t exceed", "max", true],
  ["exceed(?:s|ing)?", "max", true],
  ["at most|au plus", "max", true],
  ["at least|au moins|minimum of|min(?:imum|imal|imale)?\\.?", "min", true],
  [
    "max(?:imum|imal|imale)?\\.?|up to|less than|smaller than|lower than|under|below|within|limit(?:ed)?|jusqu['’][àa]|inf[ée]rieure?s?|ne (?:doit|doivent|devant|peut|peuvent) pas d[ée]passer|d[ée]passer|plafond",
    "max",
    true,
  ],
  ["more than|greater than|larger than|bigger than|over|above|sup[ée]rieure?s?", "min", true],
  ["≤|<=|<|⩽", "max", false],
  ["≥|>=|>|⩾", "min", false],
];

const QUALIFIER_RE = new RegExp(
  QUALIFIERS.map(([body, , bounded]) => (bounded ? `(${B}(?:${body})${E})` : `(${body})`)).join("|"),
  "giu",
);

/** Bound implied by the last qualifier word in a text window. */
export function lastQualifier(window: string): Bound | null {
  QUALIFIER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let bound: Bound | null = null;
  while ((m = QUALIFIER_RE.exec(window))) {
    for (let g = 1; g < m.length; g++) {
      if (m[g] !== undefined) {
        bound = QUALIFIERS[g - 1][1];
        break;
      }
    }
  }
  return bound;
}

function afterQualifier(after: string): Bound | null {
  if (/^\s*(?:\)|,)?\s*(?:max(?:imum|imal|imale)?|or (?:less|smaller|under|below)|at most|au plus)(?![\p{L}])/iu.test(after)) return "max";
  if (/^\s*(?:\)|,)?\s*(?:min(?:imum|imal|imale)?|or (?:more|larger|above|greater)|at least|au moins)(?![\p{L}])/iu.test(after)) return "min";
  return null;
}

function tokenize(sentence: string): Token[] {
  let work = sentence.toLowerCase();
  const tokens: Token[] = [];
  const take = (re: RegExp, build: (m: RegExpExecArray) => Token[] | Token | null) => {
    re.lastIndex = 0;
    const spans: [number, number][] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(work))) {
      const t = build(m);
      if (t) {
        tokens.push(...(Array.isArray(t) ? t : [t]));
        spans.push([m.index, m[0].length]);
      }
      if (m[0].length === 0) re.lastIndex++;
    }
    for (const [i, n] of spans) work = work.slice(0, i) + " ".repeat(n) + work.slice(i + n);
  };

  // Print size, e.g. "35 x 45 mm", "2 x 2 inches"
  take(new RegExp(`${NUM}\\s*(${LEN_UNIT})?\\s*(?:x|×|\\*|by|sur)\\s*${NUM}\\s*(${LEN_UNIT})${NOT_LETTER}`, "giu"), (m) => {
    const unit2 = m[4];
    const unit1 = m[2] ?? unit2;
    try {
      return { type: "phys", w: toMm(parseNumber(m[1]), unit1), h: toMm(parseNumber(m[3]), unit2), start: m.index, end: m.index + m[0].length };
    } catch {
      return null;
    }
  });

  // DPI
  take(/(\d{2,4})\s*(?:dpi|ppi|pixels? per inch|pixels?\/inch|points? par pouce|ppp)(?![\p{L}])/giu, (m) => ({
    type: "dpi",
    value: Number(m[1]),
    start: m.index,
    end: m.index + m[0].length,
  }));

  // Ratio
  take(
    /(?:aspect ratio|ratio|proportions?)\s*(?:of|:|=|is|de)?\s*(\d+(?:[.,]\d+)?)\s*[:/x×]\s*(\d+(?:[.,]\d+)?)/giu,
    (m) => {
      const a = parseNumber(m[1]);
      const b = parseNumber(m[2]);
      if (!a || !b) return null;
      return { type: "ratio", value: a / b, start: m.index, end: m.index + m[0].length };
    },
  );

  // Pixel box ranges, e.g. "600 x 600 to 1200 x 1200 pixels"
  const PX2 = "(\\d{2,5})\\s*(?:px|pixels?)?\\s*(?:x|×|\\*|by|sur)\\s*(\\d{2,5})(?:\\s*(?:px|pixels?))?";
  take(new RegExp(`${PX2}${SEP_RANGE}${PX2}(?![\\p{L}\\p{N}])`, "giu"), (m) => [
    { type: "px2", w: Number(m[1]), h: Number(m[2]), start: m.index, end: m.index + 1, forced: "min" },
    { type: "px2", w: Number(m[3]), h: Number(m[4]), start: m.index + 1, end: m.index + m[0].length, forced: "max" },
  ]);
  take(new RegExp(`${PX2}(?![\\p{L}\\p{N}])`, "giu"), (m) => ({
    type: "px2",
    w: Number(m[1]),
    h: Number(m[2]),
    start: m.index,
    end: m.index + m[0].length,
  }));

  // Single-side pixel ranges, e.g. "between 600 and 1200 pixels"
  take(new RegExp(`(\\d{2,5})(?:\\s*(?:px|pixels?))?${SEP_RANGE}(\\d{2,5})\\s*(?:px|pixels?)${NOT_LETTER}`, "giu"), (m) => [
    { type: "px1", value: Number(m[1]), axis: "both", start: m.index, end: m.index + 1, forced: "min" },
    { type: "px1", value: Number(m[2]), axis: "both", start: m.index + 1, end: m.index + m[0].length, forced: "max" },
  ]);
  // Single pixel values, optionally with an axis word after them
  take(
    /(\d{2,5})\s*(?:px|pixels?)(?:\s*(wide|in width|width|de large(?:ur)?|tall|high|in height|height|de haut(?:eur)?))?(?![\p{L}])/giu,
    (m) => {
      const word = m[2] ?? "";
      let axis: "w" | "h" | "both" = "both";
      if (/wide|width|large/.test(word)) axis = "w";
      else if (/tall|high|height|haut/.test(word)) axis = "h";
      else {
        const before = work.slice(Math.max(0, m.index - 28), m.index);
        const wi = Math.max(before.lastIndexOf("width"), before.lastIndexOf("wide"), before.lastIndexOf("largeur"));
        const hi = Math.max(before.lastIndexOf("height"), before.lastIndexOf("tall"), before.lastIndexOf("hauteur"));
        if (wi > hi) axis = "w";
        else if (hi > wi) axis = "h";
      }
      return { type: "px1", value: Number(m[1]), axis, start: m.index, end: m.index + m[0].length };
    },
  );

  // Size ranges where only the second number has a unit, e.g. "10–50 KB", "between 54 KB and 240 KB"
  take(new RegExp(`${NUM}\\s*(${SIZE_UNIT})?${SEP_RANGE}${NUM}\\s*(${SIZE_UNIT})${NOT_LETTER}`, "giu"), (m) => {
    const unit2 = m[4];
    const unit1 = m[2] ?? unit2;
    return [
      { type: "size", value: parseNumber(m[1]), unit: unit1, start: m.index, end: m.index + 1, forced: "min" },
      { type: "size", value: parseNumber(m[3]), unit: unit2, start: m.index + 1, end: m.index + m[0].length, forced: "max" },
    ];
  });
  take(new RegExp(`${NUM}\\s*(${SIZE_UNIT})${NOT_LETTER}`, "giu"), (m) => ({
    type: "size",
    value: parseNumber(m[1]),
    unit: m[2],
    start: m.index,
    end: m.index + m[0].length,
  }));

  // Pages
  take(/(\d{1,3})\s*pages?(?![\p{L}])/giu, (m) => ({ type: "pages", value: Number(m[1]), start: m.index, end: m.index + m[0].length }));
  // File count
  take(/(\d{1,2})\s*(?:files?|documents?|uploads?|fichiers?)(?![\p{L}])/giu, (m) => ({
    type: "files",
    value: Number(m[1]),
    start: m.index,
    end: m.index + m[0].length,
  }));

  return tokens.sort((a, b) => a.start - b.start);
}

/* ------------------------------------------------------------------------ */
/* Constraint extraction                                                     */
/* ------------------------------------------------------------------------ */

export interface Extracted {
  formats: KnownFormat[];
  excludedFormats: KnownFormat[];
  maxBytes?: number;
  minBytes?: number;
  totalMaxBytes?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  exactWidth?: number;
  exactHeight?: number;
  physicalWidthMm?: number;
  physicalHeightMm?: number;
  dpi?: number;
  minDpi?: number;
  aspectRatio?: number;
  colorMode?: "color" | "grayscale";
  background?: "white" | "light" | "plain";
  minPages?: number;
  maxPages?: number;
  maxFiles?: number;
  combine?: "merge" | "separate";
  optional?: boolean;
  naming: Partial<NamingRules>;
  notes: string[];
  /** Number of distinct rules found. */
  count: number;
}

const FORMAT_RE = words("jpe?g|jpg|png|pdf|webp|heic|heif|gif|tiff?|docx?|odt|rtf|txt|bmp|avif");
const NEGATIVE_FORMAT_RE = words(
  "not (?:be )?(?:accepted|allowed|permitted|supported)|(?:are|is) not accepted|no longer accepted|ne sont pas accept[ée]s|n['’]est pas accept[ée]|non accept[ée]s?|refus[ée]s?|interdits?",
);
const TOTAL_RE = words("totale?s?|combined|altogether|in all|overall|au total|cumul[ée]?e?s?|globale?|ensemble");
const PER_RE = words("each|per (?:file|document|upload)|par (?:fichier|document)|chaque|individual(?:ly)?|every");
const OPTIONAL_RE = words(
  "optional|if applicable|if available|if any|facultati(?:f|ve)|le cas [ée]ch[ée]ant|si applicable|not required|not mandatory|recommended",
);
const GRAYSCALE_RE = words("black (?:and|&) white|b&w|b/w|gr[ae]y ?scale|monochrome|noir (?:et|&) blanc|niveaux de gris");
const COLOR_RE = words(
  "colou?r (?:photo(?:graph)?|image|scan|cop(?:y|ies)|print)s?|in colou?r|full[- ]colou?r|colou?red|en couleurs?|couleur",
);
const WHITE_BG_RE = words("white background|fond blanc|background (?:must|should) be white|on a white background");
const PLAIN_BG_RE = words(
  "(?:plain|uniform|neutral|light|pale|off-white|solid|light[- ]colou?red)(?: colou?red)? background|fond (?:uni|clair|neutre)",
);
const SQUARE_RE = words("square|carr[ée]e?");
const MERGE_RE = words(
  "single (?:pdf|file|document)|one (?:pdf|file|document)|(?:combined?|merged?|compiled?|scanned) (?:in)?to (?:one|a single)|in one (?:pdf|file|document)|as one (?:pdf|file|document)|un seul (?:fichier|pdf|document)|en un seul|regroup[ée]e?s?|fusionn[ée]e?s?|recto[- ]verso|front and back",
);
const SEPARATE_RE = words("separate(?:ly)?(?: files?| documents?| uploads?)?|as separate|individually|un fichier par|s[ée]par[ée]ment");
const SINGLE_PAGE_RE = words("single[- ]page|one[- ]page|1[- ]page|une (?:seule )?page");
const NO_SPACES_RE = words("no spaces|without spaces|sans espaces?|pas d['’]espaces?|ne (?:doivent|doit) pas comporter d['’]espaces?|must not contain spaces");
const LOWERCASE_RE = words("lower ?case|minuscules?");
const UPPERCASE_RE = words("upper ?case|majuscules?");
const MAX_CHARS_RE = /(?:max(?:imum)?\.?|up to|no more than|at most)\s*(\d{1,3})\s*(?:characters|chars|caract[eè]res)/iu;
const NOTE_RE = words(
  "(?:less|fewer) than \\d+ (?:months?|days?|weeks?)|within the (?:last|past)|dated|certified|translated|signed|stamped|moins de \\d+ mois|datant de|certifi[ée]e?s?|tradui(?:t|te|ts|tes)|sign[ée]e?s?|legible|lisibles?|not older than|valid",
);

function normaliseFormat(raw: string): KnownFormat {
  const f = raw.toLowerCase();
  if (f === "jpeg" || f === "jpg") return "jpg";
  if (f === "tif" || f === "tiff") return "tiff";
  if (f === "heif") return "heic";
  return f as KnownFormat;
}

export function extractConstraints(sentence: string): Extracted {
  const out: Extracted = { formats: [], excludedFormats: [], naming: {}, notes: [], count: 0 };
  const lower = sentence.toLowerCase();

  // Formats, in the order they appear.
  const formats: KnownFormat[] = [];
  FORMAT_RE.lastIndex = 0;
  let fm: RegExpExecArray | null;
  while ((fm = FORMAT_RE.exec(lower))) {
    const f = normaliseFormat(fm[0]);
    if (!formats.includes(f)) formats.push(f);
  }
  NEGATIVE_FORMAT_RE.lastIndex = 0;
  if (formats.length && NEGATIVE_FORMAT_RE.test(lower)) out.excludedFormats = formats;
  else out.formats = formats;
  if (formats.length) out.count++;

  const tokens = tokenize(sentence);
  let prevEnd = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const window = lower.slice(Math.max(prevEnd, t.start - 48), t.start);
    const after = lower.slice(t.end, t.end + 18);
    const bound: Bound | null = ("forced" in t && t.forced) || lastQualifier(window) || afterQualifier(after);
    prevEnd = t.end;

    switch (t.type) {
      case "size": {
        let bytes: number;
        try {
          bytes = toBytes(t.value, t.unit, bound ?? "max");
        } catch {
          break;
        }
        const sentenceBefore = lower.slice(0, t.start);
        const totalIdx = lastIndexOfRe(sentenceBefore, TOTAL_RE);
        const perIdx = lastIndexOfRe(sentenceBefore, PER_RE);
        const isTotal = totalIdx >= 0 && totalIdx > perIdx && (bound ?? "max") === "max";
        if (isTotal) out.totalMaxBytes = bytes;
        else if (bound === "min") out.minBytes = bytes;
        else out.maxBytes = bytes;
        out.count++;
        break;
      }
      case "px2": {
        if (bound === "min") {
          out.minWidth = t.w;
          out.minHeight = t.h;
        } else if (bound === "max") {
          out.maxWidth = t.w;
          out.maxHeight = t.h;
        } else {
          out.exactWidth = t.w;
          out.exactHeight = t.h;
        }
        out.count++;
        break;
      }
      case "px1": {
        if (!bound && t.axis === "both") break;
        const setW = t.axis !== "h";
        const setH = t.axis !== "w";
        if (bound === "min") {
          if (setW) out.minWidth = t.value;
          if (setH) out.minHeight = t.value;
        } else if (bound === "max") {
          if (setW) out.maxWidth = t.value;
          if (setH) out.maxHeight = t.value;
        } else {
          if (setW) out.exactWidth = t.value;
          if (setH) out.exactHeight = t.value;
        }
        out.count++;
        break;
      }
      case "phys":
        out.physicalWidthMm = round2(t.w);
        out.physicalHeightMm = round2(t.h);
        out.count++;
        break;
      case "dpi":
        out.dpi = t.value;
        out.minDpi = t.value;
        out.count++;
        break;
      case "ratio":
        out.aspectRatio = t.value;
        out.count++;
        break;
      case "pages": {
        const inParens = /\(\s*$/.test(lower.slice(0, t.start)) && /^\s*\)/.test(after);
        if (bound === "min") out.minPages = t.value;
        else if (bound === "max" || inParens) out.maxPages = t.value;
        else break;
        out.count++;
        break;
      }
      case "files":
        if (bound === "max") {
          out.maxFiles = t.value;
          out.count++;
        }
        break;
    }
  }

  const test = (re: RegExp) => {
    re.lastIndex = 0;
    return re.test(lower);
  };

  if (out.maxPages === undefined && test(SINGLE_PAGE_RE)) {
    out.maxPages = 1;
    out.count++;
  }
  if (test(GRAYSCALE_RE)) {
    out.colorMode = "grayscale";
    out.count++;
  } else if (test(COLOR_RE)) {
    out.colorMode = "color";
    out.count++;
  }
  if (test(WHITE_BG_RE)) {
    out.background = "white";
    out.count++;
  } else if (test(PLAIN_BG_RE)) {
    out.background = /light|pale|clair|off-white/.test(lower) ? "light" : "plain";
    out.count++;
  }
  if (out.aspectRatio === undefined && test(SQUARE_RE)) {
    out.aspectRatio = 1;
    out.count++;
  }
  if (test(SEPARATE_RE)) {
    out.combine = "separate";
    out.count++;
  } else if (test(MERGE_RE)) {
    out.combine = "merge";
    out.count++;
  }
  if (test(OPTIONAL_RE)) out.optional = true;

  // Naming rules
  const pattern = extractNamingPattern(sentence);
  if (pattern) {
    out.naming.pattern = pattern;
    out.count++;
  }
  if (test(NO_SPACES_RE)) out.naming.allowSpaces = false;
  if (test(LOWERCASE_RE) && /name|nom/i.test(lower)) out.naming.case = "lower";
  if (test(UPPERCASE_RE) && /name|nom/i.test(lower) && !pattern) out.naming.case = "upper";
  const maxChars = MAX_CHARS_RE.exec(lower);
  if (maxChars) out.naming.maxLength = Number(maxChars[1]);

  if (test(NOTE_RE)) out.notes.push(cleanSnippet(sentence));

  return out;
}

function lastIndexOfRe(text: string, re: RegExp): number {
  re.lastIndex = 0;
  let last = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    last = m.index;
    if (m[0].length === 0) re.lastIndex++;
  }
  return last;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------------ */
/* Naming pattern                                                            */
/* ------------------------------------------------------------------------ */

const NAME_PART_TOKENS: [RegExp, (orig: string) => string][] = [
  [/^(?:last ?name|lastname|surname|family ?name|nom(?: de famille)?|name)$/i, (o) => caseToken("LASTNAME", o)],
  [/^(?:first ?name|firstname|given ?name|forename|pr[ée]nom)$/i, (o) => caseToken("FIRSTNAME", o)],
  [
    /^(?:document(?: ?type| ?name| ?title)?|doc(?:type)?|type|title|file ?type|pi[èe]ce|type ?de ?(?:document|pi[èe]ce)|nom ?du ?document)$/i,
    (o) => caseToken("DOC", o),
  ],
  [/^(?:date|yyyy(?:mm(?:dd)?)?|ddmmyyyy|yyyymmdd)$/i, () => "{date}"],
  [/^(?:application ?(?:id|number|no)|candidate ?(?:id|number|no)|ref(?:erence)?|dossier|numero|num[ée]ro)$/i, (o) => caseToken("REF", o)],
];

function caseToken(base: string, original: string): string {
  const letters = original.replace(/[^\p{L}]/gu, "");
  if (letters && letters === letters.toUpperCase()) return `{${base}}`;
  if (letters && letters[0] === letters[0].toUpperCase()) return `{${base[0]}${base.slice(1).toLowerCase()}}`;
  return `{${base.toLowerCase()}}`;
}

export function extractNamingPattern(sentence: string): string | undefined {
  if (!/(?:name|naming|rename|nomm|intitul|format|save)/i.test(sentence)) return undefined;
  const re = /[\p{L}\[\]{}<>]+(?:[ ]?[_\-][ ]?[\p{L}\[\]{}<>]+){1,5}(?:\.(?:pdf|jpe?g|png))?/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence))) {
    const raw = m[0].replace(/\.(?:pdf|jpe?g|png)$/i, "");
    const parts = raw.split(/([_\-])/);
    let recognised = 0;
    const out = parts.map((part) => {
      if (part === "_" || part === "-") return part;
      const clean = part.trim().replace(/^[\[{<]|[\]}>]$/g, "");
      for (const [test, make] of NAME_PART_TOKENS) {
        if (test.test(clean)) {
          recognised++;
          return make(clean);
        }
      }
      return clean;
    });
    if (recognised >= 2 || (recognised === 1 && parts.length >= 3 && /[\[{<]/.test(raw))) return out.join("").replace(/\s+/g, "");
  }
  return undefined;
}

/* ------------------------------------------------------------------------ */
/* Segmentation and assembly                                                 */
/* ------------------------------------------------------------------------ */

const BULLET_RE = /^\s*(?:[-*•·–—▪●○◦►✓✔☐□]|\(?\d{1,2}[.)]|\(?[a-z][.)])\s+/i;
const GLOBAL_RE = words(
  "all (?:files|documents|uploads|attachments)|each (?:file|document|upload)|every (?:file|document)|(?:files|documents|uploads) must|accepted (?:file )?formats?|file formats? accepted|allowed formats?|per file|tous les (?:fichiers|documents)|chaque (?:fichier|document)|les fichiers|par fichier|formats? accept[ée]s|total",
);

function splitSentences(line: string): string[] {
  return line
    .split(/(?<=[.;!?])\s+(?=[A-ZÀ-ÝÉ"“(])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

function cleanSnippet(s: string): string {
  const t = s.replace(BULLET_RE, "").replace(/\s+/g, " ").trim();
  return t.length > 220 ? `${t.slice(0, 217)}…` : t;
}

function capitalise(s: string): string {
  const t = s.trim();
  if (!t) return t;
  if (/^cv$/i.test(t)) return "CV";
  return t[0].toUpperCase() + t.slice(1);
}

interface Draft {
  key: string;
  sourceLine: string;
  label: string;
  kind: DocumentKind;
  ex: Extracted[];
  evidence: string[];
  order: number;
}

const LABEL_PREFIX_RE = /^(?:optional|facultati(?:f|ve)|obligatoire|required|mandatory)\s*[:\-–]\s*/i;
const OPTIONAL_WORD_RE = /optional|facultati|if applicable|le cas/i;

function labelFor(line: string, mention: DocMention, mentionsInLine: number): string {
  const stripped = line.replace(BULLET_RE, "").replace(LABEL_PREFIX_RE, "").trim();
  if (mentionsInLine === 1) {
    const colon = stripped.indexOf(":");
    if (colon > 0 && colon <= 60) {
      const head = stripped
        .slice(0, colon)
        .replace(/\s*\([^)]*\)/g, (p) => (p.length <= 28 && !OPTIONAL_WORD_RE.test(p) ? p : ""))
        .trim();
      if (head.toLowerCase().includes(mention.text.toLowerCase()) || findDocMentions(head).some((d) => d.key === mention.key)) {
        return capitalise(head);
      }
    }
    let noParens = stripped.replace(/\s*\([^)]*\)\s*/g, " ").replace(/[.:;]+$/, "").trim();
    NOTE_RE.lastIndex = 0;
    const note = NOTE_RE.exec(noParens);
    if (note && note.index > 0) noParens = noParens.slice(0, note.index).replace(/[\s,;:–-]+(?:de|du|des|of|from|dated|issued|that is|qui|datant)?\s*$/i, "").trim();
    if (noParens.length <= 48 && extractConstraints(noParens).count === 0) return capitalise(noParens);
  }
  if (mention.text.length <= 3) return mention.label;
  return capitalise(mention.text);
}

const KIND_DEFAULT_FORMATS: Record<DocumentKind, OutputFormat[]> = {
  photo: ["jpg", "png"],
  signature: ["jpg", "png"],
  "id-document": ["pdf", "jpg"],
  document: ["pdf"],
  other: ["pdf", "jpg"],
};

const PRODUCIBLE: OutputFormat[] = ["jpg", "png", "webp", "pdf"];
const PASS_THROUGH: KnownFormat[] = ["docx", "doc", "odt", "rtf", "txt", "gif", "tiff", "bmp", "avif"];

function mergeExtracted(list: Extracted[]): Extracted {
  const out: Extracted = { formats: [], excludedFormats: [], naming: {}, notes: [], count: 0 };
  for (const e of list) {
    for (const f of e.formats) if (!out.formats.includes(f)) out.formats.push(f);
    for (const f of e.excludedFormats) if (!out.excludedFormats.includes(f)) out.excludedFormats.push(f);
    for (const key of Object.keys(e) as (keyof Extracted)[]) {
      if (key === "formats" || key === "excludedFormats" || key === "naming" || key === "notes" || key === "count") continue;
      const v = e[key];
      if (v !== undefined) (out as unknown as Record<string, unknown>)[key] = v;
    }
    out.naming = { ...out.naming, ...e.naming };
    out.notes.push(...e.notes);
    out.count += e.count;
  }
  return out;
}

let idCounter = 0;
export function newId(prefix = "doc"): string {
  idCounter = (idCounter + 1) % 1_000_000;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${rand}${idCounter.toString(36)}`;
}

export function buildRequirement(draft: { label: string; kind: DocumentKind; evidence: string[] }, own: Extracted, global: Extracted): DocumentRequirement {
  const formats = (own.formats.length ? own.formats : global.formats).filter(
    (f) => !own.excludedFormats.includes(f) && !global.excludedFormats.includes(f),
  );
  let accepted = formats.filter((f): f is OutputFormat => PRODUCIBLE.includes(f as OutputFormat));
  const passThrough = formats.filter((f) => PASS_THROUGH.includes(f));
  if (!formats.length) accepted = KIND_DEFAULT_FORMATS[draft.kind];

  const pick = <K extends keyof Extracted>(k: K): Extracted[K] => (own[k] !== undefined ? own[k] : global[k]);

  const req: DocumentRequirement = {
    id: newId(),
    label: draft.label,
    kind: draft.kind,
    required: !own.optional,
    acceptedFormats: accepted,
    passThroughFormats: passThrough,
    maxBytes: pick("maxBytes"),
    minBytes: pick("minBytes"),
    minWidth: pick("minWidth"),
    maxWidth: pick("maxWidth"),
    minHeight: pick("minHeight"),
    maxHeight: pick("maxHeight"),
    exactWidth: pick("exactWidth"),
    exactHeight: pick("exactHeight"),
    aspectRatio: pick("aspectRatio"),
    physicalWidthMm: pick("physicalWidthMm"),
    physicalHeightMm: pick("physicalHeightMm"),
    dpi: pick("dpi"),
    minDpi: pick("minDpi"),
    colorMode: pick("colorMode"),
    background: own.background,
    minPages: pick("minPages"),
    maxPages: pick("maxPages"),
    maxFiles: pick("maxFiles"),
    combine: pick("combine"),
    namingPattern: own.naming.pattern,
    evidence: draft.evidence.slice(0, 6),
    notes: Array.from(new Set(own.notes)).slice(0, 4),
  };
  return finaliseRequirement(req);
}

/** Derive implied values (pixel size from print size and DPI, ratio from print size) and fix contradictions. */
export function finaliseRequirement(req: DocumentRequirement): DocumentRequirement {
  const r = { ...req };
  if (r.physicalWidthMm && r.physicalHeightMm) {
    if (!r.aspectRatio) r.aspectRatio = r.physicalWidthMm / r.physicalHeightMm;
    if (r.dpi && !r.exactWidth && !r.exactHeight && !r.minWidth && !r.maxWidth) {
      r.exactWidth = mmToPx(r.physicalWidthMm, r.dpi);
      r.exactHeight = mmToPx(r.physicalHeightMm, r.dpi);
    }
  }
  if (r.exactWidth && r.exactHeight && !r.aspectRatio) r.aspectRatio = r.exactWidth / r.exactHeight;
  if (!r.aspectRatio && r.minWidth && r.minHeight && r.maxWidth && r.maxHeight) {
    const a = r.minWidth / r.minHeight;
    const b = r.maxWidth / r.maxHeight;
    if (Math.abs(a - b) < 0.01) r.aspectRatio = a;
  }
  if (r.minBytes && r.maxBytes && r.minBytes > r.maxBytes) [r.minBytes, r.maxBytes] = [r.maxBytes, r.minBytes];
  if (r.minPages && r.maxPages && r.minPages > r.maxPages) [r.minPages, r.maxPages] = [r.maxPages, r.minPages];
  if (r.kind === "photo" && r.acceptedFormats.length === 0 && r.passThroughFormats.length === 0) r.acceptedFormats = ["jpg"];
  return r;
}

export function parseRequirementsText(text: string): PacketSpec {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const drafts = new Map<string, Draft>();
  const globals: Extracted[] = [];
  const globalEvidence: string[] = [];
  let context: string[] = [];
  let title: string | undefined;
  let order = 0;

  const ensureDraft = (line: string, mention: DocMention, count: number) => {
    let d = drafts.get(mention.key);
    if (!d) {
      d = { key: mention.key, sourceLine: cleanSnippet(line), label: labelFor(line, mention, count), kind: mention.kind, ex: [], evidence: [], order: order++ };
      drafts.set(mention.key, d);
    }
    return d;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line) {
      context = [];
      continue;
    }
    const lineMentions = findDocMentions(line);
    const sentences = splitSentences(line.replace(BULLET_RE, ""));

    if (!title && !BULLET_RE.test(rawLine) && line.length <= 90) {
      const ex = extractConstraints(line);
      if (ex.count === 0 && (lineMentions.length === 0 || /application|candidature|dossier|portal|careers|upload/i.test(line))) {
        if (!/^(?:please|merci|veuillez|upload|attach|submit)/i.test(line)) {
          title = line.replace(/[:.]+$/, "");
          continue;
        }
      }
    }

    if (lineMentions.length) {
      for (const m of lineMentions) ensureDraft(line, m, lineMentions.length);
      context = lineMentions.map((m) => m.key);
    }

    for (const sentence of sentences) {
      const ex = extractConstraints(sentence);
      const sentenceMentions = findDocMentions(sentence);
      const hasRules = ex.count > 0 || ex.notes.length > 0 || ex.optional;
      if (!hasRules) continue;

      GLOBAL_RE.lastIndex = 0;
      const isGlobal = GLOBAL_RE.test(sentence) && sentenceMentions.length === 0;
      if (isGlobal || (sentenceMentions.length === 0 && context.length === 0)) {
        globals.push(ex);
        globalEvidence.push(cleanSnippet(sentence));
        continue;
      }
      const targets = sentenceMentions.length ? sentenceMentions.map((m) => m.key) : context;
      for (const key of targets) {
        const d = drafts.get(key);
        if (!d) continue;
        d.ex.push(ex);
        const snippet = cleanSnippet(sentence);
        if (!d.evidence.includes(snippet)) d.evidence.push(snippet);
      }
    }
  }

  const global = mergeExtracted(globals);
  const warnings: string[] = [];
  let documents = Array.from(drafts.values())
    .sort((a, b) => a.order - b.order)
    .map((d) => buildRequirement({ ...d, evidence: d.evidence.length ? d.evidence : [d.sourceLine] }, mergeExtracted(d.ex), global));

  if (documents.length === 0) {
    documents = [buildRequirement({ label: "Document", kind: "document", evidence: globalEvidence.slice(0, 3) }, mergeExtracted([]), global)];
    warnings.push("No specific documents were named. Add each document the application asks for.");
  }

  for (const d of documents) {
    if (d.acceptedFormats.length === 0 && d.passThroughFormats.length > 0) {
      warnings.push(
        `${d.label} only accepts ${d.passThroughFormats.map((f) => f.toUpperCase()).join(" or ")}. UploadReady checks and renames these files but cannot create them.`,
      );
    }
  }

  const naming: NamingRules = { ...DEFAULT_NAMING, ...global.naming };
  const ruleCount = documents.reduce((n, d) => n + d.evidence.length, 0) + global.count;
  const confidence = Math.min(0.92, 0.3 + Math.min(0.3, drafts.size * 0.07) + Math.min(0.32, ruleCount * 0.03));

  return {
    title: title ?? "Application packet",
    documents,
    totalMaxBytes: global.totalMaxBytes,
    naming,
    warnings,
    source: "rules",
    confidence: Math.round(confidence * 100) / 100,
  };
}
