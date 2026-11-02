import type { Applicant, NamingRules } from "./types";

const SPECIAL: Record<string, string> = { ß: "ss", æ: "ae", Æ: "AE", ø: "o", Ø: "O", œ: "oe", Œ: "OE", ł: "l", Ł: "L", đ: "d", Đ: "D", þ: "th" };

export function toAscii(s: string): string {
  return s
    .replace(/[ßæÆøØœŒłŁđĐþ]/g, (c) => SPECIAL[c] ?? c)
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

const FILLER = new Set(["de", "du", "des", "d", "la", "le", "les", "l", "et", "ou", "of", "the", "and", "or", "a", "an", "to", "for", "with", "moins", "plus"]);

/** "Passport-style photo (colour)" → "Passport-style-photo" */
export function docSlug(label: string): string {
  const base = toAscii(label)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[\/&+]/g, " ")
    .replace(/[^A-Za-z0-9\s-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  while (base.length > 1 && FILLER.has(base[base.length - 1].toLowerCase())) base.pop();
  const slug = base.join("-");
  if (!slug) return "Document";
  return slug[0].toUpperCase() + slug.slice(1);
}

export interface NameOptions {
  naming: NamingRules;
  /** A per-document pattern, if the instructions gave one. */
  pattern?: string;
  applicant: Applicant & { reference?: string };
  docLabel: string;
  ext: string;
  index?: number;
  total?: number;
  date?: Date;
}

export function defaultPattern(applicant: Applicant): string {
  return applicant.lastName.trim() || applicant.firstName.trim() ? "{Lastname}_{Firstname}_{Doc}" : "{Doc}";
}

export function buildFileName(o: NameOptions): string {
  const pattern = o.pattern || o.naming.pattern || defaultPattern(o.applicant);
  const last = o.applicant.lastName.trim();
  const first = o.applicant.firstName.trim();
  const slug = docSlug(o.docLabel);
  const ref = o.applicant.reference?.trim() ?? "";
  const date = (o.date ?? new Date()).toISOString().slice(0, 10);
  const values: Record<string, string> = {
    LASTNAME: last.toUpperCase(),
    Lastname: titleCase(last),
    lastname: last.toLowerCase(),
    FIRSTNAME: first.toUpperCase(),
    Firstname: titleCase(first),
    firstname: first.toLowerCase(),
    DOC: slug.toUpperCase(),
    Doc: slug,
    doc: slug.toLowerCase(),
    REF: ref.toUpperCase(),
    Ref: ref,
    ref,
    date,
    n: o.total && o.total > 1 ? String(o.index ?? 1) : "",
  };
  let base = pattern.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
  if (o.total && o.total > 1 && !/\{n\}/.test(pattern)) base += `-${o.index ?? 1}`;
  return sanitizeFileName(base, o.ext, o.naming, pattern);
}

export function sanitizeFileName(base: string, ext: string, naming: NamingRules, pattern = ""): string {
  const sep = pattern.includes("-") && !pattern.includes("_") ? "-" : "_";
  let s = toAscii(base);
  s = naming.allowSpaces ? s.replace(/[^A-Za-z0-9 ._-]/g, sep) : s.replace(/\s+/g, sep).replace(/[^A-Za-z0-9._-]/g, sep);
  s = s.replace(/([_.\- ])[_.\- ]+/g, "$1").replace(/^[_.\- ]+|[_.\- ]+$/g, "");
  if (naming.case === "lower") s = s.toLowerCase();
  if (naming.case === "upper") s = s.toUpperCase();
  const extension = ext.replace(/^\./, "").toLowerCase();
  const maxBase = Math.max(8, naming.maxLength - extension.length - 1);
  if (s.length > maxBase) s = s.slice(0, maxBase).replace(/[_.\- ]+$/g, "");
  if (!s) s = "file";
  return `${s}.${extension}`;
}

/** Make names unique within a packet by appending -2, -3, … */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const key = n.toLowerCase();
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    if (count === 0) return n;
    const dot = n.lastIndexOf(".");
    return `${n.slice(0, dot)}-${count + 1}${n.slice(dot)}`;
  });
}

/** Problems with a name relative to the naming rules (empty when fine). */
export function nameProblems(name: string, naming: NamingRules): string[] {
  const problems: string[] = [];
  if (!naming.allowSpaces && /\s/.test(name)) problems.push("contains spaces");
  if (/[^A-Za-z0-9 ._-]/.test(name)) problems.push("contains accents or special characters");
  if (name.length > naming.maxLength) problems.push(`is longer than ${naming.maxLength} characters`);
  if (naming.case === "lower" && name !== name.toLowerCase()) problems.push("is not lowercase");
  return problems;
}
