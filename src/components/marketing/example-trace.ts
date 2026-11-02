import type { QualityPoint } from "@/components/charts/quality-size-chart";

/**
 * A real optimiser trace: the built-in sample portrait (Try it with an example →
 * University application → Use sample files) against a 240 kB limit. Sizes are
 * rounded to the nearest kB as shown in the app's table view.
 */
const RAW: [string, number, number, number, boolean?][] = [
  ["1032 × 1032 px", 30, 15, 0.9146],
  ["1200 × 1200 px", 30, 20, 0.9166],
  ["1032 × 1032 px", 63, 38, 0.9304],
  ["1200 × 1200 px", 63, 64, 0.9408],
  ["1032 × 1032 px", 79, 73, 0.9439],
  ["1032 × 1032 px", 87, 113, 0.9527],
  ["1200 × 1200 px", 79, 122, 0.957],
  ["1032 × 1032 px", 91, 156, 0.9588],
  ["1200 × 1200 px", 87, 193, 0.9677],
  ["1032 × 1032 px", 93, 193, 0.9627],
  ["1032 × 1032 px", 94, 222, 0.9653],
  ["1200 × 1200 px", 89, 228, 0.9714, true],
  ["1200 × 1200 px", 90, 253, 0.9737],
  ["1032 × 1032 px", 95, 258, 0.968],
  ["1200 × 1200 px", 91, 275, 0.9759],
  ["1200 × 1200 px", 95, 446, 0.9874],
];

export const EXAMPLE_TRACE: { maxBytes: number; caption: string; points: QualityPoint[] } = {
  maxBytes: 240_000,
  caption: "The built-in test portrait against a 240 kB limit. Each dot is a complete JPEG, decoded and scored.",
  // The full-size series (which holds the chosen file) is listed first so it takes the brand colour.
  points: [...RAW]
    .sort((a, b) => Number(b[0].startsWith("1200")) - Number(a[0].startsWith("1200")))
    .map(([series, q, kb, ssim, chosen]) => ({ series, quality: q / 100, bytes: kb * 1000, ssim, chosen })),
};
