import { FileText, IdCard, Image as ImageIcon, PenLine, File as FileIcon } from "lucide-react";
import type { DocumentKind, DocumentRequirement } from "@/lib/engine/types";
import { FORMAT_LABEL } from "@/lib/engine/magic";
import { formatBytes, formatRatio } from "@/lib/engine/units";
import { cn } from "@/lib/utils";

export function Panel({ className, children, id }: { className?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-28 rounded-[14px] border border-rule bg-paper", className)}>
      {children}
    </section>
  );
}

export function PanelHeader({ title, description, actions }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-rule-soft px-5 py-4 md:px-6">
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-ink-3">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

const KIND_ICON: Record<DocumentKind, typeof FileText> = {
  photo: ImageIcon,
  signature: PenLine,
  "id-document": IdCard,
  document: FileText,
  other: FileIcon,
};

export const KIND_LABEL: Record<DocumentKind, string> = {
  photo: "Photo of you",
  signature: "Signature",
  "id-document": "ID document",
  document: "Document",
  other: "Other",
};

export function KindIcon({ kind, className }: { kind: DocumentKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className={cn("grid size-9 shrink-0 place-items-center rounded-[9px] bg-sheet text-ink-2", className)} aria-hidden>
      <Icon className="size-[18px]" />
    </span>
  );
}

/** Short human-readable rules for a requirement, in the order applicants think about them. */
export function ruleChips(r: DocumentRequirement): string[] {
  const chips: string[] = [];
  const formats = [...r.acceptedFormats, ...r.passThroughFormats];
  if (formats.length) chips.push(formats.map((f) => FORMAT_LABEL[f]).join(" or "));
  if (r.minBytes && r.maxBytes) chips.push(`${formatBytes(r.minBytes)}–${formatBytes(r.maxBytes)}`);
  else if (r.maxBytes) chips.push(`Up to ${formatBytes(r.maxBytes)}`);
  else if (r.minBytes) chips.push(`At least ${formatBytes(r.minBytes)}`);
  if (r.exactWidth && r.exactHeight) chips.push(`${r.exactWidth} × ${r.exactHeight} px`);
  else if (r.minWidth && r.maxWidth && r.minWidth === r.minHeight && r.maxWidth === r.maxHeight) chips.push(`${r.minWidth}–${r.maxWidth} px`);
  else {
    if (r.minWidth || r.minHeight) chips.push(`At least ${r.minWidth ?? "any"} × ${r.minHeight ?? "any"} px`);
    if (r.maxWidth || r.maxHeight) chips.push(`At most ${r.maxWidth ?? "any"} × ${r.maxHeight ?? "any"} px`);
  }
  if (r.physicalWidthMm && r.physicalHeightMm) chips.push(`${round1(r.physicalWidthMm)} × ${round1(r.physicalHeightMm)} mm`);
  if (r.aspectRatio && !(r.exactWidth && r.exactHeight)) chips.push(Math.abs(r.aspectRatio - 1) < 0.005 ? "Square" : `Ratio ${formatRatio(r.aspectRatio)}`);
  if (r.dpi) chips.push(`${r.dpi} dpi`);
  if (r.colorMode === "grayscale") chips.push("Black and white");
  if (r.colorMode === "color") chips.push("In colour");
  if (r.background) chips.push(r.background === "white" ? "White background" : r.background === "light" ? "Light background" : "Plain background");
  if (r.minPages && r.maxPages) chips.push(`${r.minPages}–${r.maxPages} pages`);
  else if (r.maxPages) chips.push(r.maxPages === 1 ? "1 page" : `Up to ${r.maxPages} pages`);
  else if (r.minPages) chips.push(`At least ${r.minPages} pages`);
  if (r.combine === "merge") chips.push("One combined file");
  if (r.combine === "separate") chips.push("Separate files");
  if (r.maxFiles && r.maxFiles > 1) chips.push(`Up to ${r.maxFiles} files`);
  return chips;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const UNIT = "(?:kb|kib|mb|mib|gb|ko|mo|px|pixels?|mm|cm|dpi|pages?|inch(?:es)?)";
const NUMBER = "\\d+(?:[.,]\\d+)?";
const RULE_TOKEN = new RegExp(
  [
    // ranges sharing a unit: "10–50 KB", "between 54 KB and 240 KB"
    `${NUMBER}\\s*(?:${UNIT}\\s*)?(?:-|–|to|and)\\s*${NUMBER}\\s*${UNIT}\\b`,
    // pixel or print boxes: "600 x 600", "35 x 45 mm"
    `\\d{1,5}(?:[.,]\\d+)?\\s*(?:mm|cm|px)?\\s*[x×]\\s*\\d{1,5}(?:[.,]\\d+)?(?:\\s*(?:px|pixels?|mm|cm|inch(?:es)?))?`,
    // single values: "240 KB", "300 dpi", "2 pages"
    `${NUMBER}\\s*${UNIT}\\b`,
    // words that are rules on their own
    "\\b(?:jpe?g|png|pdf|webp|heic|docx?)\\b|\\bsquare\\b|black and white|white background|single pdf|one file|un seul (?:fichier|pdf)",
  ].join("|"),
  "gi",
);

/** Highlights the measurable parts of a rule, the way you'd mark them with a highlighter. */
export function Evidence({ text, className }: { text: string; className?: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  RULE_TOKEN.lastIndex = 0;
  while ((m = RULE_TOKEN.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <span key={m.index} className="marker">
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <span className={cn("text-sm leading-6 text-ink-2", className)}>“{parts}”</span>;
}
