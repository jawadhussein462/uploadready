/**
 * Unit handling. Portals are inconsistent about "KB" (1000 or 1024 bytes), so
 * every limit is read the strict way: a maximum uses the smaller reading and a
 * minimum uses the larger one. A file that meets both readings passes any checker.
 */

export type Bound = "max" | "min";

const UNIT_ALIASES: Record<string, { base: number; ambiguous: boolean }> = {
  b: { base: 1, ambiguous: false },
  byte: { base: 1, ambiguous: false },
  bytes: { base: 1, ambiguous: false },
  octet: { base: 1, ambiguous: false },
  octets: { base: 1, ambiguous: false },
  kb: { base: 1, ambiguous: true },
  kbs: { base: 1, ambiguous: true },
  kbyte: { base: 1, ambiguous: true },
  kbytes: { base: 1, ambiguous: true },
  kilobyte: { base: 1, ambiguous: true },
  kilobytes: { base: 1, ambiguous: true },
  ko: { base: 1, ambiguous: true },
  k: { base: 1, ambiguous: true },
  kib: { base: 1024, ambiguous: false },
  mb: { base: 2, ambiguous: true },
  mbs: { base: 2, ambiguous: true },
  mbyte: { base: 2, ambiguous: true },
  mbytes: { base: 2, ambiguous: true },
  megabyte: { base: 2, ambiguous: true },
  megabytes: { base: 2, ambiguous: true },
  mo: { base: 2, ambiguous: true },
  mib: { base: 1024 * 1024, ambiguous: false },
  gb: { base: 3, ambiguous: true },
  go: { base: 3, ambiguous: true },
  gib: { base: 1024 * 1024 * 1024, ambiguous: false },
};

/** Convert a size with a unit to bytes, using the strict reading for the given bound. */
export function toBytes(value: number, unit: string, bound: Bound): number {
  const key = unit.trim().toLowerCase().replace(/\.$/, "");
  const alias = UNIT_ALIASES[key];
  if (!alias) throw new Error(`Unknown size unit: ${unit}`);
  if (!alias.ambiguous) return Math.round(value * alias.base);
  const power = alias.base; // 1 = kilo, 2 = mega, 3 = giga
  const decimal = value * Math.pow(1000, power);
  const binary = value * Math.pow(1024, power);
  return Math.round(bound === "max" ? Math.min(decimal, binary) : Math.max(decimal, binary));
}

export function isSizeUnit(unit: string): boolean {
  return unit.trim().toLowerCase().replace(/\.$/, "") in UNIT_ALIASES;
}

/** Human-readable size using decimal units (matches how limits are enforced). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "–";
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  if (bytes < 1_000_000) {
    const kb = bytes / 1000;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} kB`;
  }
  if (bytes < 1_000_000_000) {
    const mb = bytes / 1_000_000;
    return `${mb < 10 ? mb.toFixed(2) : mb.toFixed(1)} MB`;
  }
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

export type LengthUnit = "mm" | "cm" | "in";

export function toMm(value: number, unit: string): number {
  const u = unit.trim().toLowerCase();
  if (u === "mm") return value;
  if (u === "cm") return value * 10;
  if (u === "in" || u === "inch" || u === "inches" || u === '"' || u === "”" || u === "pouce" || u === "pouces") return value * 25.4;
  throw new Error(`Unknown length unit: ${unit}`);
}

export function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

export function pxToMm(px: number, dpi: number): number {
  return (px / dpi) * 25.4;
}

/** Parse "1,5" or "1.5" into 1.5. */
export function parseNumber(raw: string): number {
  return Number.parseFloat(raw.replace(",", "."));
}

export function formatDims(w?: number, h?: number): string {
  if (!w || !h) return "–";
  return `${w} × ${h} px`;
}

export function formatRatio(ratio: number): string {
  const known: [number, string][] = [
    [1, "1:1"],
    [35 / 45, "35:45"],
    [3 / 4, "3:4"],
    [4 / 3, "4:3"],
    [2 / 3, "2:3"],
    [3 / 2, "3:2"],
    [16 / 9, "16:9"],
    [3, "3:1"],
    [2, "2:1"],
    [4 / 5, "4:5"],
  ];
  for (const [value, label] of known) if (Math.abs(value - ratio) < 0.005) return label;
  return ratio >= 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`;
}
