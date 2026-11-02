"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Crop, Download, FileArchive, LoaderCircle, RotateCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { QualitySizeChart, type QualityPoint } from "@/components/charts/quality-size-chart";
import { Button } from "@/components/ui/button";
import { NativeSelect, Switch } from "@/components/ui/fields";
import { SizeGauge } from "@/components/ui/size-gauge";
import { StatusBadge, StatusIcon, type Status } from "@/components/ui/status";
import { FORMAT_LABEL } from "@/lib/engine/magic";
import { processSlot, type SlotResult, type SlotSettings } from "@/lib/engine/pipeline";
import type { DocumentRequirement, OutputFormat } from "@/lib/engine/types";
import { formatBytes } from "@/lib/engine/units";
import { zipFiles } from "@/lib/engine/zip";
import { filesForSlot, slotSignature, useWorkspace } from "@/lib/store/workspace";
import type { PublicConfig } from "@/lib/server/config";
import { cn, downloadBlob, slugify } from "@/lib/utils";
import { CropEditor } from "./crop-editor";
import { Paywall } from "./paywall";
import { KindIcon, Panel, ruleChips } from "./shared";

const NO_SETTINGS: SlotSettings = {};

/* ----------------------------- Processing loop ---------------------------- */

function useProcessor() {
  const running = useRef(false);
  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const s = useWorkspace.getState();
        if (!s.spec || s.step !== 3) break;
        const next = s.spec.documents.find((d) => {
          const r = s.results[d.id];
          return !r || r.signature !== slotSignature(s, d.id);
        });
        if (!next) break;
        const signature = slotSignature(s, next.id);
        const files = filesForSlot(s, next.id);
        s.setProgress(next.id, { fraction: 0, label: "Starting" });
        let result: SlotResult;
        try {
          result = await processSlot(next, files, s.settings[next.id] ?? {}, {
            naming: s.spec.naming,
            applicant: s.applicant,
            onProgress: (fraction, label) => useWorkspace.getState().setProgress(next.id, { fraction, label }),
          });
        } catch (err) {
          console.error(err);
          result = {
            slotId: next.id,
            status: "blocked",
            outputs: [],
            checks: [],
            notes: [],
            issues: [{ severity: "fail", message: `This document couldn’t be prepared: ${(err as Error).message}`, fix: "Try another copy of the file." }],
            durationMs: 0,
          };
        }
        const now = useWorkspace.getState();
        now.setProgress(next.id, null);
        now.setResult(next.id, { ...result, signature });
      }
    } finally {
      running.current = false;
    }
  }, []);

  const key = useWorkspace((s) => (s.step === 3 && s.spec ? s.spec.documents.map((d) => slotSignature(s, d.id)).join("\n") : ""));
  useEffect(() => {
    if (key) void run();
  }, [key, run]);
}

const STATUS_TEXT: Record<SlotResult["status"], string> = {
  ready: "Ready",
  attention: "Check this",
  blocked: "Needs a fix",
  empty: "No file",
};
const toStatus = (s: SlotResult["status"] | "pending"): Status =>
  s === "pending" ? "pending" : s === "ready" ? "pass" : s === "attention" ? "warn" : s === "blocked" ? "fail" : "idle";

/* ------------------------------ Review step ------------------------------- */

export function ReviewStep({ config, unlocked }: { config: PublicConfig | null; unlocked: boolean }) {
  useProcessor();
  const spec = useWorkspace((s) => s.spec);
  const results = useWorkspace((s) => s.results);
  const progress = useWorkspace((s) => s.progress);
  const packetId = useWorkspace((s) => s.packetId);
  const setStep = useWorkspace((s) => s.setStep);
  const [paywall, setPaywall] = useState(false);

  const summary = useMemo(() => {
    const docs = spec?.documents ?? [];
    const st = useWorkspace.getState();
    let ready = 0;
    let attention = 0;
    let blocked = 0;
    let pending = 0;
    let skipped = 0;
    let bytes = 0;
    let files = 0;
    let rules = 0;
    for (const d of docs) {
      const r = results[d.id];
      const fresh = r && r.signature === slotSignature(st, d.id);
      if (!fresh || progress[d.id]) pending++;
      else if (r.status === "ready") ready++;
      else if (r.status === "attention") attention++;
      else if (r.status === "blocked" || (r.status === "empty" && d.required)) blocked++;
      else skipped++;
      if (r) {
        for (const o of r.outputs) bytes += o.bytes.length;
        files += r.outputs.length;
        rules += r.checks.length;
      }
    }
    return { total: docs.length, ready, attention, blocked, pending, skipped, bytes, files, rules };
  }, [spec, results, progress]);

  if (!spec) return null;
  const busy = summary.pending > 0;
  const priceLabel = config?.payments.priceLabel ?? "";
  const paymentsOn = !!config?.payments.enabled;
  const overTotal = spec.totalMaxBytes !== undefined && summary.bytes > spec.totalMaxBytes;

  const downloadAll = () => {
    if (paymentsOn && !unlocked) return setPaywall(true);
    const st = useWorkspace.getState();
    const outputs = spec.documents.flatMap((d) => st.results[d.id]?.outputs ?? []);
    if (!outputs.length) return toast.error("There are no files to download yet.");
    downloadBlob(zipFiles(outputs.map((o) => ({ name: o.name, bytes: o.bytes }))), `${slugify(spec.title)}.zip`);
    toast.success("Packet downloaded", { description: `${outputs.length} files in one ZIP. Unzip it before uploading.` });
  };

  const headline = busy
    ? "Preparing your files"
    : summary.blocked + summary.attention === 0
      ? "Every document meets the rules"
      : `${summary.ready} of ${summary.total - summary.skipped} documents ready`;

  return (
    <div className="space-y-6">
      <Panel className="overflow-hidden">
        <div className="grid gap-6 px-5 py-5 md:grid-cols-[1fr_auto] md:items-center md:px-6">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2.5 text-xl font-bold text-ink">
              {busy ? <LoaderCircle className="size-5 animate-spin text-pen" /> : <StatusIcon status={summary.blocked ? "fail" : summary.attention ? "warn" : "pass"} className="size-5" />}
              {headline}
            </h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {summary.ready ? <StatusBadge status="pass">{summary.ready} ready</StatusBadge> : null}
              {summary.attention ? <StatusBadge status="warn">{summary.attention} to check</StatusBadge> : null}
              {summary.blocked ? <StatusBadge status="fail">{summary.blocked} need a fix</StatusBadge> : null}
              {summary.pending ? <StatusBadge status="pending">{summary.pending} in progress</StatusBadge> : null}
            </div>
            {spec.totalMaxBytes ? (
              <div className="mt-4 max-w-sm">
                <SizeGauge bytes={summary.bytes} max={spec.totalMaxBytes} compact />
                <p className="mt-1 text-xs text-ink-3">Total of all files{overTotal ? ": over the packet limit, so tighten the largest file’s size limit" : ""}</p>
              </div>
            ) : null}
          </div>
          <div className="flex flex-col items-stretch gap-2 md:items-end">
            <Button size="lg" onClick={downloadAll} disabled={busy || !summary.files}>
              <FileArchive />
              {paymentsOn && !unlocked ? `Download packet, ${priceLabel}` : "Download packet (.zip)"}
            </Button>
            {summary.blocked && !busy ? <p className="text-xs text-fail md:text-right">Some files don’t meet the rules yet. Fix them below first.</p> : null}
          </div>
        </div>
      </Panel>

      {spec.documents.map((d) => (
        <SlotCard key={d.id} req={d} canDownload={!paymentsOn || unlocked} onLocked={() => setPaywall(true)} />
      ))}

      <div className="flex justify-between">
        <Button variant="ghost" onClick={() => setStep(2)}>
          Back to files
        </Button>
      </div>

      {paymentsOn ? (
        <Paywall
          open={paywall}
          onOpenChange={setPaywall}
          packetId={packetId}
          title={spec.title}
          fileCount={summary.files}
          ruleCount={summary.rules}
          priceLabel={priceLabel}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------- Slot card ------------------------------- */

function SlotCard({ req, canDownload, onLocked }: { req: DocumentRequirement; canDownload: boolean; onLocked: () => void }) {
  const result = useWorkspace((s) => s.results[req.id]);
  const progress = useWorkspace((s) => s.progress[req.id]);
  const settings = useWorkspace((s) => s.settings[req.id] ?? NO_SETTINGS);
  const setSettings = useWorkspace((s) => s.setSettings);
  const sources = useWorkspace(useShallow((s) => filesForSlot(s, req.id)));
  const fresh = useWorkspace((s) => !!s.results[req.id] && s.results[req.id].signature === slotSignature(s, req.id));
  const [cropOpen, setCropOpen] = useState(false);
  const pending = !!progress || !fresh;
  const status = pending ? "pending" : result?.status ?? "empty";
  const out = result?.outputs[0];
  const isImage = out && out.format !== "pdf" && ["jpg", "png", "webp"].includes(out.format);
  const formats = [...req.acceptedFormats];

  const download = (i: number) => {
    if (!canDownload) return onLocked();
    const o = result?.outputs[i];
    if (!o) return;
    downloadBlob(new Blob([o.bytes as BlobPart], { type: o.mime }), o.name);
  };

  return (
    <Panel id={`slot-${req.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule-soft px-5 py-3.5 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <KindIcon kind={req.kind} className="size-8" />
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-ink">{req.label}</h3>
            <p className="truncate text-xs text-ink-3">{ruleChips(req).join(", ")}</p>
          </div>
        </div>
        <StatusBadge status={toStatus(status)}>{pending ? "Preparing" : STATUS_TEXT[result?.status ?? "empty"]}</StatusBadge>
      </div>

      {pending && progress ? (
        <div className="px-5 py-5 md:px-6" aria-live="polite">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-2">{progress.label}</span>
            <span className="nums text-ink-3">{Math.round(progress.fraction * 100)}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-pen-tint">
            <div className="h-full rounded-full bg-pen transition-[width] duration-300" style={{ width: `${Math.max(4, progress.fraction * 100)}%` }} />
          </div>
        </div>
      ) : null}

      {!pending && result?.status === "empty" ? (
        <p className="px-5 py-4 text-sm text-ink-3 md:px-6">
          {req.required ? "No file was added for this document. Go back to Files to add one." : "Optional, and no file was added. It will be left out of the packet."}
        </p>
      ) : null}

      {result && result.status !== "empty" ? (
        <div className={cn("grid gap-6 px-5 py-5 md:px-6 lg:grid-cols-[minmax(0,260px)_1fr]", pending && "opacity-60")}>
          {/* Preview */}
          <div>
            <div className="grid aspect-[4/5] place-items-center overflow-hidden rounded-[10px] border border-rule bg-sheet p-3">
              {out?.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={out.previewUrl}
                  alt={`Prepared ${req.label}`}
                  className={cn("max-h-full max-w-full object-contain", out.format === "pdf" && "shadow-[0_1px_6px_rgb(15_31_75/0.18)]")}
                />
              ) : (
                <span className="px-4 text-center text-xs text-ink-3">{out ? "No preview for this file type" : "No file produced"}</span>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-3">
              <span className="nums">
                {out?.width && out.height ? `${out.width} × ${out.height} px` : out?.pages ? `${out.pages} page${out.pages === 1 ? "" : "s"}` : ""}
              </span>
              {sources[0]?.thumbUrl ? (
                <span className="flex items-center gap-1.5">
                  Before
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sources[0].thumbUrl} alt="Original file" className="size-7 rounded-[5px] border border-rule object-cover" />
                </span>
              ) : null}
            </div>
            {result.framing && isImage ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {req.kind === "photo" || req.kind === "signature" || req.aspectRatio ? (
                  <Button variant="outline" size="sm" onClick={() => setCropOpen(true)}>
                    <Crop /> Adjust framing
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" onClick={() => setSettings(req.id, { rotation: ((settings.rotation ?? 0) + 1) % 4, crop: undefined })}>
                  <RotateCw /> Rotate
                </Button>
              </div>
            ) : null}
          </div>

          {/* Details */}
          <div className="min-w-0 space-y-5">
            {result.outputs.map((o, i) => (
              <div key={o.name} className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-ink-3">{result.outputs.length > 1 ? `File ${i + 1}` : "File to upload"}</p>
                  <p className="truncate font-semibold text-ink" title={o.name}>
                    {o.name}
                  </p>
                  <div className="mt-2 max-w-md">
                    <SizeGauge bytes={o.bytes.length} max={req.maxBytes} min={req.minBytes} compact />
                  </div>
                  <p className="nums mt-2 text-xs text-ink-3">
                    {[
                      FORMAT_LABEL[o.format],
                      o.quality ? `quality ${Math.round(o.quality * 100)}` : null,
                      o.fidelity !== undefined && o.fidelity < 0.99995 ? `${(o.fidelity * 100).toFixed(1)}% similar to the original (SSIM)` : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => download(i)}>
                  <Download /> Download
                </Button>
              </div>
            ))}

            {result.issues.length ? (
              <ul className="space-y-2">
                {result.issues.map((issue, i) => (
                  <li key={i} className={cn("rounded-[10px] px-3.5 py-2.5 text-sm", issue.severity === "fail" ? "bg-fail-tint" : "bg-warn-tint")}>
                    <p className={cn("flex items-start gap-2 font-semibold", issue.severity === "fail" ? "text-fail" : "text-warn")}>
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {issue.message}
                    </p>
                    {issue.fix ? <p className="mt-0.5 pl-6 text-ink-2">{issue.fix}</p> : null}
                  </li>
                ))}
              </ul>
            ) : null}

            {result.checks.length ? (
              <div>
                <p className="mb-2 text-sm font-semibold text-ink">Checks</p>
                <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  {result.checks.map((c) => (
                    <li key={c.id} className="flex items-start gap-2 text-sm">
                      <StatusIcon status={c.status} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="font-semibold text-ink">{c.label}</span>
                        {c.detail ? <span className="block break-words text-xs text-ink-3">{c.detail}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {result.notes.length ? (
              <div>
                <p className="mb-1.5 text-sm font-semibold text-ink">What changed</p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2 marker:text-ink-3">
                  {result.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Options req={req} formats={formats} />

            {result.trace && result.trace.length > 1 ? <TraceDetails result={result} req={req} /> : null}
          </div>
        </div>
      ) : null}

      {result?.framing && cropOpen ? (
        <CropEditor
          open={cropOpen}
          onOpenChange={setCropOpen}
          framing={result.framing}
          kind={req.kind}
          onApply={(rect) => setSettings(req.id, { crop: rect })}
          onAuto={() => setSettings(req.id, { crop: undefined })}
        />
      ) : null}
    </Panel>
  );
}

function Options({ req, formats }: { req: DocumentRequirement; formats: OutputFormat[] }) {
  const settings = useWorkspace((s) => s.settings[req.id] ?? NO_SETTINGS);
  const setSettings = useWorkspace((s) => s.setSettings);
  const hasPhotoSources = useWorkspace((s) => filesForSlot(s, req.id).some((f) => f.format !== "pdf"));
  const cleanupLabel = req.kind === "signature" ? "Make the paper white" : "Clean up photographed pages";
  const cleanupOn = settings.cleanup ?? req.kind === "signature";
  const showCleanup = req.kind !== "photo" && hasPhotoSources;
  const showGray = req.colorMode !== "grayscale" && req.colorMode !== "color" && req.kind !== "photo";
  if (!showCleanup && !showGray && formats.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[10px] bg-sheet px-4 py-3">
      {showCleanup ? (
        <label className="flex items-center gap-2.5 text-sm font-medium text-ink">
          <Switch checked={cleanupOn} onCheckedChange={(v) => setSettings(req.id, { cleanup: v })} />
          {cleanupLabel}
        </label>
      ) : null}
      {showGray ? (
        <label className="flex items-center gap-2.5 text-sm font-medium text-ink">
          <Switch checked={!!settings.grayscale} onCheckedChange={(v) => setSettings(req.id, { grayscale: v })} />
          Black and white
        </label>
      ) : null}
      {formats.length > 1 ? (
        <label className="flex items-center gap-2.5 text-sm font-medium text-ink">
          Format
          <NativeSelect
            className="h-8 w-28 bg-paper"
            value={settings.format ?? ""}
            onChange={(e) => setSettings(req.id, { format: (e.target.value || undefined) as OutputFormat | undefined })}
          >
            <option value="">Best fit</option>
            {formats.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABEL[f]}
              </option>
            ))}
          </NativeSelect>
        </label>
      ) : null}
    </div>
  );
}

function TraceDetails({ result, req }: { result: SlotResult; req: DocumentRequirement }) {
  const trace = result.trace ?? [];
  const formats = Array.from(new Set(trace.map((t) => t.format)));
  const bySize = formats.length === 1;
  const sizes = Array.from(new Set(trace.map((t) => `${t.width} × ${t.height} px`))).slice(0, 3);
  const points: QualityPoint[] = trace
    .filter((t) => (bySize ? sizes.includes(`${t.width} × ${t.height} px`) : true))
    .map((t) => ({
      series: bySize ? `${t.width} × ${t.height} px` : FORMAT_LABEL[t.format],
      detail: bySize ? FORMAT_LABEL[t.format] : `${t.width} × ${t.height} px`,
      bytes: t.bytes,
      ssim: t.ssim,
      quality: t.quality,
      chosen: t.chosen,
    }));
  return (
    <details className="group rounded-[10px] border border-rule-soft">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 text-ink-3 transition-transform group-open:rotate-90" />
        How the size was chosen
        <span className="font-normal text-ink-3">({trace.length} versions tested)</span>
      </summary>
      <div className="px-4 pb-4">
        <p className="mb-3 text-sm text-ink-2">
          Each dot is a full version of this file, decoded and compared with the original. Higher is closer to the original. UploadReady kept the closest version
          under the limit.
        </p>
        <QualitySizeChart points={points} maxBytes={req.maxBytes} minBytes={req.minBytes} title={`Versions tried for “${req.label}”`} connect={bySize} className="border-rule-soft" />
      </div>
    </details>
  );
}
