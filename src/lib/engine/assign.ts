/**
 * Matching files to requirement slots as a minimum-cost bipartite assignment
 * (Kuhn–Munkres / Hungarian algorithm, O(n³)). Each slot is expanded into as
 * many columns as files it can take; every file also has an "unassigned"
 * column priced at the confidence threshold, so weak matches stay unassigned.
 */
import { findDocMentions } from "./rules-parser";
import type { DocumentRequirement, KnownFormat } from "./types";
import { isImageFormat } from "./magic";

export interface FileFeatures {
  id: string;
  name: string;
  format: KnownFormat;
  pages?: number;
  traits?: { portrait: number; signature: number; page: number };
}

/** Rectangular Hungarian algorithm. Returns, for each row, the chosen column. */
export function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  if (n === 0) return [];
  const m = cost[0].length;
  if (n > m) {
    const t = Array.from({ length: m }, (_, j) => cost.map((row) => row[j]));
    const colToRow = hungarian(t);
    const res = new Array(n).fill(-1);
    colToRow.forEach((row, col) => {
      if (row >= 0) res[row] = col;
    });
    return res;
  }
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0);
  const way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(INF);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const ans = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) ans[p[j] - 1] = j - 1;
  return ans;
}

/* ------------------------------ Scoring --------------------------------- */

const STOP = new Set([
  "img", "image", "scan", "scanned", "file", "doc", "document", "copy", "final", "new", "version", "v", "pdf", "jpg", "jpeg", "png", "heic",
  "of", "the", "and", "my", "your", "de", "du", "des", "la", "le", "les", "et", "a", "photo", "screenshot", "capture", "ecran", "whatsapp", "dsc", "pxl",
]);

const KEY_SYNONYMS: Record<string, string[]> = {
  photo: ["photo", "photograph", "portrait", "headshot", "selfie", "picture", "pic", "face", "identite", "passportphoto", "idphoto"],
  signature: ["signature", "sign", "signed", "sig", "autograph"],
  id: ["passport", "passeport", "id", "identity", "identite", "cni", "card", "carte", "license", "licence", "permis", "permit", "titre", "sejour"],
  cv: ["cv", "resume", "curriculum"],
  cover: ["cover", "letter", "motivation", "lettre", "statement", "sop", "purpose", "personal"],
  transcript: ["transcript", "transcripts", "grades", "notes", "releve", "marks", "marksheet", "records"],
  diploma: ["diploma", "degree", "diplome", "certificate"],
  recommendation: ["recommendation", "reference", "recommandation", "lor"],
  address: ["address", "domicile", "utility", "bill", "facture", "edf", "electricity", "justificatif"],
  rent: ["rent", "loyer", "quittance", "receipt"],
  payslips: ["payslip", "payslips", "salary", "paie", "bulletin", "bulletins", "salaire", "fiche", "paystub"],
  tax: ["tax", "impot", "impots", "imposition", "avis"],
  bank: ["bank", "statement", "releve", "funds", "banque"],
  rib: ["rib", "iban", "bank"],
  employment: ["employment", "contract", "contrat", "employer", "employeur", "attestation", "travail", "work"],
  language: ["ielts", "toefl", "toeic", "duolingo", "language", "score"],
  portfolio: ["portfolio", "sample", "writing", "work"],
  birth: ["birth", "naissance"],
  enrolment: ["enrolment", "enrollment", "scolarite", "student", "etudiant"],
  insurance: ["insurance", "assurance"],
};

export function tokens(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !/^\d+$/.test(t) && !STOP.has(t));
}

function slotKeywords(req: DocumentRequirement): Set<string> {
  const words = new Set(tokens(req.label).filter((t) => t.length > 1));
  for (const m of findDocMentions(req.label)) for (const s of KEY_SYNONYMS[m.key] ?? []) words.add(s);
  if (req.kind === "photo") KEY_SYNONYMS.photo.forEach((s) => words.add(s));
  if (req.kind === "signature") KEY_SYNONYMS.signature.forEach((s) => words.add(s));
  return words;
}

function tokenMatch(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return 0.8;
  if (a.length >= 5 && b.length >= 5 && levenshtein(a, b) <= 1) return 0.6;
  return 0;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Can UploadReady produce something this slot accepts from this file? */
export function compatible(file: FileFeatures, req: DocumentRequirement): boolean {
  if (req.passThroughFormats.includes(file.format)) return true;
  if (isImageFormat(file.format)) return req.acceptedFormats.length > 0;
  if (file.format === "pdf") return req.acceptedFormats.length > 0;
  return false;
}

export function matchScore(file: FileFeatures, req: DocumentRequirement): number {
  if (!compatible(file, req)) return -1;
  const fileTokens = tokens(file.name);
  const keys = slotKeywords(req);
  let name = 0;
  for (const t of fileTokens) for (const k of keys) name = Math.max(name, tokenMatch(t, k));

  const isImage = isImageFormat(file.format);
  const tr = file.traits ?? { portrait: 0, signature: 0, page: file.format === "pdf" ? 0.8 : 0 };
  let content = 0;
  switch (req.kind) {
    case "photo":
      content = isImage ? 0.15 + 0.85 * tr.portrait : 0.02;
      break;
    case "signature":
      content = isImage ? 0.1 + 0.9 * tr.signature : 0.05;
      break;
    case "id-document":
      content = isImage ? 0.3 + 0.2 * (1 - tr.signature) - 0.25 * tr.portrait : 0.35;
      break;
    default:
      content = file.format === "pdf" ? 0.5 : isImage ? 0.15 + 0.45 * tr.page - 0.3 * tr.portrait : 0.45;
  }
  const native = req.acceptedFormats.includes(file.format as never) || req.passThroughFormats.includes(file.format) ? 0.05 : 0;
  const multiPagePenalty = file.format === "pdf" && !req.acceptedFormats.includes("pdf") && (file.pages ?? 1) > 1 ? 0.2 : 0;
  return 0.62 * name + 0.38 * Math.max(0, content) + native - multiPagePenalty;
}

export const ASSIGN_THRESHOLD = 0.2;

/**
 * Assign files to slots. `fixed` holds manual choices that must be respected.
 * Returns fileId → slotId (or null for unassigned).
 */
export function assignFiles(
  files: FileFeatures[],
  slots: DocumentRequirement[],
  fixed: Record<string, string | null> = {},
): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  const load = new Map<string, number>();
  for (const [fileId, slotId] of Object.entries(fixed)) {
    result[fileId] = slotId;
    if (slotId) load.set(slotId, (load.get(slotId) ?? 0) + 1);
  }
  const free = files.filter((f) => !(f.id in fixed));
  if (!free.length) return result;

  const columns: { slotId: string | null; penalty: number }[] = [];
  for (const s of slots) {
    const capacity = s.combine === "merge" ? 12 : Math.max(1, s.maxFiles ?? 1);
    const used = load.get(s.id) ?? 0;
    for (let k = used; k < capacity; k++) columns.push({ slotId: s.id, penalty: k * 0.12 });
  }
  for (let i = 0; i < free.length; i++) columns.push({ slotId: null, penalty: 0 });

  const BIG = 1e6;
  const cost = free.map((f) =>
    columns.map((col) => {
      if (col.slotId === null) return -ASSIGN_THRESHOLD;
      const slot = slots.find((s) => s.id === col.slotId)!;
      const score = matchScore(f, slot);
      return score < 0 ? BIG : -(score - col.penalty);
    }),
  );
  const pick = hungarian(cost);
  free.forEach((f, i) => {
    const col = columns[pick[i]];
    result[f.id] = col && cost[i][pick[i]] < BIG ? col.slotId : null;
  });
  return result;
}
