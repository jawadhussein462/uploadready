"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FileText, FileUp, LoaderCircle, Trash2, TriangleAlert, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/fields";
import { StatusIcon } from "@/components/ui/status";
import { makeSampleFiles } from "@/lib/client/sample-files";
import { compatible } from "@/lib/engine/assign";
import { FORMAT_LABEL } from "@/lib/engine/magic";
import type { InputFile } from "@/lib/engine/pipeline";
import { formatBytes } from "@/lib/engine/units";
import { useShallow } from "zustand/react/shallow";
import { filesForSlot, useWorkspace } from "@/lib/store/workspace";
import { cn } from "@/lib/utils";
import { KindIcon, Panel, PanelHeader, ruleChips } from "./shared";

const ACCEPT = "image/*,.heic,.heif,application/pdf,.pdf,.doc,.docx,.odt";

export function FilesStep({ demo }: { demo?: boolean }) {
  const spec = useWorkspace((s) => s.spec);
  const files = useWorkspace((s) => s.files);
  const assignments = useWorkspace((s) => s.assignments);
  const addFiles = useWorkspace((s) => s.addFiles);
  const setStep = useWorkspace((s) => s.setStep);
  const [busy, setBusy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const add = async (list: (File | { blob: Blob; name: string })[]) => {
    if (!list.length) return;
    setBusy((n) => n + list.length);
    try {
      await addFiles(list);
    } finally {
      setBusy((n) => Math.max(0, n - list.length));
    }
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = Array.from(e.clipboardData?.files ?? []);
      if (pasted.length) {
        e.preventDefault();
        void add(pasted);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addSamples = async () => {
    if (!spec) return;
    setBusy((n) => n + 1);
    try {
      const samples = await makeSampleFiles(spec);
      await addFiles(samples);
      toast.success(`Added ${samples.length} sample files`, { description: "They were matched to the documents automatically." });
    } finally {
      setBusy((n) => Math.max(0, n - 1));
    }
  };

  if (!spec) return null;
  const unassigned = files.filter((f) => !assignments[f.id]);
  const assignedCount = files.length - unassigned.length;

  return (
    <div className="space-y-6">
      <Panel>
        <div
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            setDragging(false);
            void add(Array.from(e.dataTransfer.files));
          }}
          className={cn(
            "m-2 flex flex-col items-center justify-center gap-3 rounded-[10px] border-[1.5px] border-dashed px-6 py-10 text-center transition-colors md:py-12",
            dragging ? "border-pen bg-pen-tint/60" : "border-rule bg-sheet/40",
          )}
        >
          {busy ? <LoaderCircle className="size-7 animate-spin text-pen" /> : <FileUp className="size-7 text-ink-3" />}
          <div>
            <p className="text-base font-semibold text-ink">{busy ? "Reading your files" : "Drop photos, scans and PDFs here"}</p>
            <p className="mt-1 text-sm text-ink-3">JPG, PNG, HEIC from iPhones, WebP, PDF. Word files are accepted where the portal takes them.</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={() => inputRef.current?.click()} disabled={!!busy}>
              Choose files
            </Button>
            {demo || files.length === 0 ? (
              <Button variant="outline" onClick={addSamples} disabled={!!busy}>
                <Wand2 /> Use sample files
              </Button>
            ) : null}
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            aria-label="Choose files"
            onChange={(e) => {
              void add(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>
      </Panel>

      {unassigned.length ? (
        <Panel className="border-warn/40">
          <PanelHeader
            title={`${unassigned.length} file${unassigned.length === 1 ? "" : "s"} not matched`}
            description="Choose which document each one is for, or remove it."
          />
          <ul className="divide-y divide-rule-soft">
            {unassigned.map((f) => (
              <FileRow key={f.id} file={f} />
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="space-y-4">
        {spec.documents.map((d) => (
          <SlotFiles key={d.id} slotId={d.id} />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={() => setStep(1)}>
          Back to the rules
        </Button>
        <Button size="lg" onClick={() => setStep(3)} disabled={!assignedCount || !!busy}>
          Prepare and check files
        </Button>
      </div>
    </div>
  );
}

function SlotFiles({ slotId }: { slotId: string }) {
  const req = useWorkspace((s) => s.spec?.documents.find((d) => d.id === slotId));
  const files = useWorkspace(useShallow((s) => filesForSlot(s, slotId)));
  const assign = useWorkspace((s) => s.assign);
  const [over, setOver] = useState(false);
  if (!req) return null;
  const multi = req.combine === "merge" || (req.maxFiles ?? 1) > 1;
  const status = files.length ? "pass" : req.required ? "warn" : "idle";

  return (
    <Panel id={`files-${slotId}`} className={cn("transition-colors", over && "border-pen bg-pen-tint/30")}>
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("text/x-uploadready-file")) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          const id = e.dataTransfer.getData("text/x-uploadready-file");
          setOver(false);
          if (id) {
            e.preventDefault();
            assign(id, slotId);
          }
        }}
      >
        <div className="flex items-start gap-4 px-5 py-4 md:px-6">
          <KindIcon kind={req.kind} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="font-semibold text-ink">{req.label}</h3>
              <span className="flex items-center gap-1.5 text-xs font-medium text-ink-3">
                <StatusIcon status={status} className="size-3.5" />
                {files.length
                  ? `${files.length} file${files.length === 1 ? "" : "s"}${multi && files.length > 1 ? ", combined in this order" : ""}`
                  : req.required
                    ? "Needs a file"
                    : "Optional"}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-ink-3">{ruleChips(req).join(", ")}</p>
          </div>
        </div>
        {files.length ? (
          <ul className="divide-y divide-rule-soft border-t border-rule-soft">
            {files.map((f, i) => (
              <FileRow key={f.id} file={f} slotId={slotId} index={i} count={files.length} reorder={multi} />
            ))}
          </ul>
        ) : (
          <p className="border-t border-rule-soft px-5 py-3 text-sm text-ink-3 md:px-6">Drag a file here, or pick this document from a file’s menu.</p>
        )}
      </div>
    </Panel>
  );
}

function fileMeta(f: InputFile): string {
  const parts = [FORMAT_LABEL[f.format], formatBytes(f.size)];
  if (f.width && f.height) parts.push(`${f.width} × ${f.height} px`);
  if (f.pages) parts.push(`${f.pages} page${f.pages === 1 ? "" : "s"}`);
  return parts.join(", ");
}

function FileRow({ file, slotId, index = 0, count = 1, reorder }: { file: InputFile; slotId?: string; index?: number; count?: number; reorder?: boolean }) {
  const spec = useWorkspace((s) => s.spec)!;
  const assign = useWorkspace((s) => s.assign);
  const removeFile = useWorkspace((s) => s.removeFile);
  const moveInSlot = useWorkspace((s) => s.moveInSlot);
  const options = spec.documents.filter((d) => compatible({ id: file.id, name: file.name, format: file.format }, d));
  const unsupported = options.length === 0;

  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/x-uploadready-file", file.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="grid cursor-grab grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 px-5 py-3 active:cursor-grabbing sm:grid-cols-[auto_1fr_auto] md:px-6"
    >
      <div className="grid size-12 place-items-center overflow-hidden rounded-[8px] border border-rule-soft bg-sheet">
        {file.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file.thumbUrl} alt="" className="size-full object-cover" draggable={false} />
        ) : (
          <FileText className="size-5 text-ink-3" />
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink" title={file.name}>
          {file.name}
        </p>
        <p className="nums truncate text-xs text-ink-3">{fileMeta(file)}</p>
        {unsupported ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-warn">
            <TriangleAlert className="size-3.5" /> No document in this application accepts {FORMAT_LABEL[file.format]} files.
          </p>
        ) : null}
        {file.needsPassword ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-fail">
            <TriangleAlert className="size-3.5" /> Password-protected. Remove the password and add it again.
          </p>
        ) : null}
      </div>
      <div className="col-span-2 flex items-center gap-1.5 sm:col-span-1">
        {reorder && slotId ? (
          <>
            <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={index === 0} onClick={() => moveInSlot(slotId, file.id, -1)}>
              <ArrowUp />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={index === count - 1} onClick={() => moveInSlot(slotId, file.id, 1)}>
              <ArrowDown />
            </Button>
          </>
        ) : null}
        <NativeSelect
          aria-label={`Document for ${file.name}`}
          className="w-full min-w-0 sm:w-56"
          value={slotId ?? ""}
          onChange={(e) => assign(file.id, e.target.value || null)}
        >
          <option value="">Not used</option>
          {options.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </NativeSelect>
        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${file.name}`} onClick={() => removeFile(file.id)}>
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}
