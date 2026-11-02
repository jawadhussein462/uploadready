import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/engine/units";

/**
 * A file size measured against the portal's limits: the track spans 0 → 120 %
 * of the maximum, with ticks at the minimum and maximum. The fill carries the
 * state (within limits or not); the numbers sit beside it in ink.
 */
export function SizeGauge({
  bytes,
  max,
  min,
  className,
  compact,
}: {
  bytes: number;
  max?: number;
  min?: number;
  className?: string;
  compact?: boolean;
}) {
  if (!max && !min) {
    return <span className={cn("nums text-sm font-semibold text-ink", className)}>{formatBytes(bytes)}</span>;
  }
  const scale = (max ?? min! * 2) * 1.2;
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  const ok = (!max || bytes <= max) && (!min || bytes >= min);
  const label = min && max ? `${formatBytes(min)}–${formatBytes(max)}` : max ? `max ${formatBytes(max)}` : `min ${formatBytes(min!)}`;
  return (
    <div className={cn("w-full", className)} role="meter" aria-valuenow={bytes} aria-valuemin={0} aria-valuemax={max ?? scale} aria-label={`File size ${formatBytes(bytes)}, ${label}`}>
      <div className={cn("flex items-baseline justify-between gap-3", compact ? "mb-1" : "mb-1.5")}>
        <span className={cn("nums font-semibold text-ink", compact ? "text-sm" : "text-base")}>{formatBytes(bytes)}</span>
        <span className="nums text-xs text-ink-3">{label}</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-rule-soft">
        <div className={cn("absolute inset-y-0 left-0 rounded-full", ok ? "bg-pass" : "bg-fail")} style={{ width: pct(bytes) }} />
        {min ? <span className="absolute -top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-ink-3" style={{ left: pct(min) }} aria-hidden /> : null}
        {max ? <span className="absolute -top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: pct(max) }} aria-hidden /> : null}
      </div>
    </div>
  );
}
