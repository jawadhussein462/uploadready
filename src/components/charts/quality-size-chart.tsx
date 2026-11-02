"use client";

import { useId, useMemo, useState } from "react";
import { formatBytes } from "@/lib/engine/units";
import { cn } from "@/lib/utils";

export interface QualityPoint {
  series: string;
  bytes: number;
  ssim: number;
  /** Encoder quality 0–1, or null for lossless. */
  quality: number | null;
  /** Extra context for the tooltip and table, e.g. pixel size. */
  detail?: string;
  chosen?: boolean;
}

const SERIES_COLORS = ["var(--color-series-1)", "var(--color-series-2)", "var(--color-series-3)"];
const W = 560;
const H = 320;
const M = { top: 34, right: 18, bottom: 46, left: 58 };

function niceStep(range: number, target: number) {
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
}

/**
 * File size (x) against similarity to the original (y) for every encoding the
 * optimiser tried. The limit splits the plot; the chosen file is ringed.
 */
export function QualitySizeChart({
  points,
  maxBytes,
  minBytes,
  title,
  caption,
  className,
  connect = true,
}: {
  connect?: boolean;
  points: QualityPoint[];
  maxBytes?: number;
  minBytes?: number;
  title: string;
  caption?: string;
  className?: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const series = useMemo(() => Array.from(new Set(points.map((p) => p.series))).slice(0, 3), [points]);
  const shown = points.filter((p) => series.includes(p.series) && p.ssim > 0);

  const xMaxRaw = Math.max(maxBytes ?? 0, ...shown.map((p) => p.bytes)) * 1.08 || 1;
  const xStep = niceStep(xMaxRaw, 5);
  const xMax = Math.ceil(xMaxRaw / xStep) * xStep;
  const yMinRaw = Math.min(...shown.map((p) => p.ssim), 0.99);
  const yStep = niceStep(1 - yMinRaw, 4);
  const yMin = Math.max(0, Math.floor((yMinRaw - yStep * 0.25) / yStep) * yStep);
  const x = (b: number) => M.left + (b / xMax) * (W - M.left - M.right);
  const y = (s: number) => M.top + ((1 - s) / (1 - yMin || 1)) * (H - M.top - M.bottom);
  const xTicks = Array.from({ length: Math.round(xMax / xStep) + 1 }, (_, i) => i * xStep);
  const yTicks: number[] = [];
  for (let v = yMin; v <= 1.0000001; v += yStep) yTicks.push(Math.round(v * 1000) / 1000);

  const chosen = shown.find((p) => p.chosen);
  const hovered = hover !== null ? shown[hover] : null;
  const fmtQ = (q: number | null) => (q === null ? "lossless" : `quality ${Math.round(q * 100)}`);

  return (
    <figure className={cn("rounded-[14px] border border-rule bg-paper p-5", className)}>
      <figcaption>
        <p className="text-sm font-bold text-ink">{title}</p>
        {caption ? <p className="mt-0.5 text-xs text-ink-3">{caption}</p> : null}
      </figcaption>

      {series.length > 1 ? (
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2" aria-label="Series">
          {series.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span className="inline-block h-0.5 w-4 rounded-full" style={{ background: SERIES_COLORS[i] }} aria-hidden />
              {s}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative mt-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-labelledby={`${id}-desc`}>
          <desc id={`${id}-desc`}>
            {title}. {chosen ? `Chosen file: ${formatBytes(chosen.bytes)}, similarity ${chosen.ssim.toFixed(3)}.` : ""}
          </desc>
          {maxBytes ? (
            <g>
              <rect x={x(maxBytes)} y={M.top} width={W - M.right - x(maxBytes)} height={H - M.top - M.bottom} fill="var(--color-sheet)" />
              <text x={W - M.right - 6} y={M.top + 16} textAnchor="end" className="fill-ink-3 text-[11px]">
                Over the limit
              </text>
            </g>
          ) : null}
          {yTicks.map((t) => (
            <g key={`y${t}`}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--color-rule-soft)" strokeWidth={1} />
              <text x={M.left - 8} y={y(t) + 4} textAnchor="end" className="nums fill-ink-3 text-[11px]">
                {t.toFixed(yStep < 0.01 ? 3 : 2)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={`x${t}`} x={x(t)} y={H - M.bottom + 18} textAnchor="middle" className="nums fill-ink-3 text-[11px]">
              {t === 0 ? "0" : formatBytes(t)}
            </text>
          ))}
          <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} stroke="var(--color-rule)" strokeWidth={1} />
          <text x={(M.left + W - M.right) / 2} y={H - 6} textAnchor="middle" className="fill-ink-2 text-[12px]">
            File size
          </text>
          <text transform={`translate(14 ${(M.top + H - M.bottom) / 2}) rotate(-90)`} textAnchor="middle" className="fill-ink-2 text-[12px]">
            Similarity to original (SSIM)
          </text>

          {minBytes ? <line x1={x(minBytes)} x2={x(minBytes)} y1={M.top} y2={H - M.bottom} stroke="var(--color-ink-3)" strokeWidth={1} /> : null}
          {maxBytes ? (
            <g>
              <line x1={x(maxBytes)} x2={x(maxBytes)} y1={M.top - 6} y2={H - M.bottom} stroke="var(--color-ink)" strokeWidth={1.5} />
              <text x={x(maxBytes)} y={M.top - 12} textAnchor="middle" className="nums fill-ink text-[11px] font-semibold">
                Limit {formatBytes(maxBytes)}
              </text>
            </g>
          ) : null}

          {connect && series.map((s, si) => {
            const pts = shown.filter((p) => p.series === s).sort((a, b) => a.bytes - b.bytes);
            if (pts.length < 2) return null;
            return (
              <polyline
                key={s}
                points={pts.map((p) => `${x(p.bytes)},${y(p.ssim)}`).join(" ")}
                fill="none"
                stroke={SERIES_COLORS[si]}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}

          {shown.map((p, i) => {
            const si = series.indexOf(p.series);
            return (
              <g key={i}>
                <circle cx={x(p.bytes)} cy={y(p.ssim)} r={hover === i ? 6 : 4.5} fill={SERIES_COLORS[si]} stroke="var(--color-paper)" strokeWidth={2} />
                {p.chosen ? <circle cx={x(p.bytes)} cy={y(p.ssim)} r={9.5} fill="none" stroke="var(--color-ink)" strokeWidth={1.5} /> : null}
              </g>
            );
          })}

          {chosen ? (
            <text
              x={x(chosen.bytes) - 16}
              y={y(chosen.ssim) - 18}
              textAnchor="end"
              className="nums fill-ink text-[11px] font-semibold"
            >
              Chosen: {formatBytes(chosen.bytes)}, {fmtQ(chosen.quality)}
            </text>
          ) : null}

          {/* Hit targets: larger than the marks, focusable for keyboard users. */}
          {shown.map((p, i) => (
            <circle
              key={`hit${i}`}
              cx={x(p.bytes)}
              cy={y(p.ssim)}
              r={13}
              fill="transparent"
              tabIndex={0}
              role="img"
              aria-label={`${p.series}: ${formatBytes(p.bytes)}, similarity ${p.ssim.toFixed(3)}, ${fmtQ(p.quality)}${p.chosen ? ", chosen" : ""}`}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover((h) => (h === i ? null : h))}
              onFocus={() => setHover(i)}
              onBlur={() => setHover((h) => (h === i ? null : h))}
              className="cursor-default focus:outline-none"
            />
          ))}
        </svg>
        {hovered ? (
          <div
            className="pointer-events-none absolute z-10 min-w-[10rem] -translate-x-1/2 -translate-y-full rounded-[8px] border border-rule bg-paper px-3 py-2 text-xs shadow-[var(--shadow-pop)]"
            style={{ left: `${(x(hovered.bytes) / W) * 100}%`, top: `calc(${(y(hovered.ssim) / H) * 100}% - 12px)` }}
          >
            <p className="nums text-sm font-bold text-ink">{formatBytes(hovered.bytes)}</p>
            <p className="nums text-ink-2">SSIM {hovered.ssim.toFixed(4)}</p>
            <p className="mt-1 flex items-center gap-1.5 text-ink-3">
              <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: SERIES_COLORS[series.indexOf(hovered.series)] }} aria-hidden />
              {hovered.series}, {fmtQ(hovered.quality)}
            </p>
            {hovered.detail ? <p className="text-ink-3">{hovered.detail}</p> : null}
          </div>
        ) : null}
      </div>

      <button type="button" onClick={() => setShowTable((v) => !v)} className="mt-2 text-xs font-semibold text-pen hover:underline" aria-expanded={showTable}>
        {showTable ? "Hide the table" : "Show values as a table"}
      </button>
      {showTable ? (
        <div className="mt-2 max-h-56 overflow-auto rounded-[8px] border border-rule-soft">
          <table className="nums w-full text-left text-xs">
            <thead className="sticky top-0 bg-sheet text-ink-3">
              <tr>
                <th className="px-3 py-1.5 font-semibold">Version</th>
                <th className="px-3 py-1.5 font-semibold">Quality</th>
                <th className="px-3 py-1.5 text-right font-semibold">Size</th>
                <th className="px-3 py-1.5 text-right font-semibold">SSIM</th>
              </tr>
            </thead>
            <tbody>
              {shown
                .slice()
                .sort((a, b) => a.bytes - b.bytes)
                .map((p, i) => (
                  <tr key={i} className={cn("border-t border-rule-soft text-ink-2", p.chosen && "font-semibold text-ink")}>
                    <td className="px-3 py-1.5">
                      {p.series}
                      {p.detail ? `, ${p.detail}` : ""}
                      {p.chosen ? " (chosen)" : ""}
                    </td>
                    <td className="px-3 py-1.5">{p.quality === null ? "lossless" : Math.round(p.quality * 100)}</td>
                    <td className="px-3 py-1.5 text-right">{formatBytes(p.bytes)}</td>
                    <td className="px-3 py-1.5 text-right">{p.ssim.toFixed(4)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </figure>
  );
}
