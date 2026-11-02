"use client";

import { QualitySizeChart, type QualityPoint } from "@/components/charts/quality-size-chart";
import { EXAMPLE_TRACE } from "./example-trace";

export function RdChart({ className }: { className?: string }) {
  const points: QualityPoint[] = EXAMPLE_TRACE.points;
  return (
    <QualitySizeChart
      points={points}
      maxBytes={EXAMPLE_TRACE.maxBytes}
      title="Every JPEG version tried for one photo"
      caption={EXAMPLE_TRACE.caption}
      className={className}
    />
  );
}
