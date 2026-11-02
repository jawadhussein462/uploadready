"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardPaste, ImageUp, LoaderCircle, Pencil, Plus, Sparkles, Trash2, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Tabs } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Hint, Input, Label, Textarea } from "@/components/ui/fields";
import { Chip } from "@/components/ui/status";
import { prepareScreenshot, readRequirements } from "@/lib/client/api";
import { buildFileName, defaultPattern } from "@/lib/engine/naming";
import { emptyRequirement, type DocumentRequirement } from "@/lib/engine/types";
import { newId } from "@/lib/engine/rules-parser";
import { formatBytes } from "@/lib/engine/units";
import { SAMPLES } from "@/lib/samples";
import { useWorkspace } from "@/lib/store/workspace";
import type { PublicConfig } from "@/lib/server/config";
import { RequirementEditor } from "./requirement-editor";
import { Evidence, KindIcon, Panel, PanelHeader, ruleChips } from "./shared";

export function RulesStep({ config, autoSample }: { config: PublicConfig | null; autoSample?: string | null }) {
  const instructions = useWorkspace((s) => s.instructions);
  const setInstructions = useWorkspace((s) => s.setInstructions);
  const spec = useWorkspace((s) => s.spec);
  const engine = useWorkspace((s) => s.engine);
  const setSpec = useWorkspace((s) => s.setSpec);
  const setStep = useWorkspace((s) => s.setStep);
  const [tab, setTab] = useState<"text" | "screenshot">("text");
  const [screenshot, setScreenshot] = useState<{ mediaType: "image/jpeg"; data: string; previewUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const aiOn = !!config?.ai.enabled;

  const read = useCallback(
    async (text?: string, sampleName?: string) => {
      const useText = text ?? instructions;
      if (tab === "screenshot" && !text) {
        if (!screenshot) return toast.error("Add a screenshot of the instructions first.");
      } else if (!useText.trim()) {
        return toast.error("Paste the upload instructions first.");
      }
      setBusy(true);
      try {
        const res = await readRequirements(tab === "screenshot" && !text ? { image: screenshot! } : { text: useText });
        setSpec(res.spec, sampleName ? (res.engine === "ai" ? "ai" : "sample") : res.engine);
        const n = res.spec.documents.length;
        toast.success(`Found ${n} document${n === 1 ? "" : "s"}`, { description: "Check each rule against the portal before adding files." });
        requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      } catch (err) {
        toast.error("Couldn’t read the rules", { description: (err as Error).message });
      } finally {
        setBusy(false);
      }
    },
    [instructions, screenshot, setSpec, tab],
  );

  const applySample = useCallback(
    (id: string) => {
      const sample = SAMPLES.find((s) => s.id === id);
      if (!sample) return;
      setTab("text");
      setInstructions(sample.text);
      void read(sample.text, sample.name);
    },
    [read, setInstructions],
  );

  const autoRan = useRef(false);
  useEffect(() => {
    if (autoSample && !autoRan.current && !spec) {
      autoRan.current = true;
      applySample(autoSample);
    }
  }, [autoSample, spec, applySample]);

  const onScreenshot = async (file: Blob) => {
    try {
      setScreenshot(await prepareScreenshot(file));
      setTab("screenshot");
    } catch {
      toast.error("That image couldn’t be read.");
    }
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (file && aiOn) {
        e.preventDefault();
        void onScreenshot(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [aiOn]);

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader
          title="Upload rules"
          description="Paste what the application says about documents and file formats. Include the whole section; extra text is fine."
        />
        <div className="px-5 py-5 md:px-6">
          <Tabs.Root value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <Tabs.List className="mb-4 inline-flex rounded-[9px] bg-sheet p-1" aria-label="How to add the rules">
              {(["text", "screenshot"] as const).map((t) => (
                <Tabs.Trigger
                  key={t}
                  value={t}
                  className="rounded-[7px] px-3.5 py-1.5 text-sm font-semibold text-ink-3 transition-colors data-[state=active]:bg-paper data-[state=active]:text-ink data-[state=active]:shadow-[0_1px_2px_rgb(15_31_75/0.12)]"
                >
                  {t === "text" ? "Paste text" : "Screenshot"}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <Tabs.Content value="text" className="focus:outline-none">
              <Textarea
                aria-label="Upload instructions"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder={"For example:\nPhoto: JPG, square, at least 600 × 600 pixels, maximum 240 KB.\nCV: one PDF, up to 2 pages, under 2 MB."}
                className="min-h-48 font-[inherit] text-[0.9375rem]"
              />
            </Tabs.Content>
            <Tabs.Content value="screenshot" className="focus:outline-none">
              {!aiOn ? (
                <div className="rounded-[10px] border border-dashed border-rule bg-sheet/60 px-5 py-8 text-center text-sm text-ink-2">
                  Reading screenshots needs AI reading, which isn’t switched on for this site. Paste the instructions as text instead.
                </div>
              ) : screenshot ? (
                <div className="relative overflow-hidden rounded-[10px] border border-rule">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={screenshot.previewUrl} alt="Screenshot of the instructions" className="max-h-80 w-full bg-sheet object-contain" />
                  <Button variant="outline" size="sm" className="absolute top-3 right-3" onClick={() => setScreenshot(null)}>
                    <X /> Remove
                  </Button>
                </div>
              ) : (
                <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[10px] border-[1.5px] border-dashed border-rule bg-sheet/50 px-5 py-10 text-center hover:border-pen/50 hover:bg-pen-tint/40">
                  <ImageUp className="size-6 text-ink-3" />
                  <span className="text-sm font-semibold text-ink">Choose a screenshot of the instructions</span>
                  <span className="flex items-center gap-1.5 text-xs text-ink-3">
                    <ClipboardPaste className="size-3.5" /> or paste it with Ctrl+V / ⌘V
                  </span>
                  <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && onScreenshot(e.target.files[0])} />
                </label>
              )}
            </Tabs.Content>
          </Tabs.Root>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
            <Button onClick={() => read()} disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : null}
              {busy ? "Reading the rules" : spec ? "Read the rules again" : "Read the rules"}
            </Button>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink-3">Or try a sample:</span>
              {SAMPLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => applySample(s.id)}
                  disabled={busy}
                  className="rounded-full border border-rule px-3 py-1 text-xs font-semibold text-ink-2 transition-colors hover:border-pen/40 hover:bg-pen-tint hover:text-pen disabled:opacity-50"
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-3">
            {aiOn ? <Sparkles className="size-3.5 text-pen" /> : null}
            {aiOn
              ? "Rules are read by Claude. Your documents are never sent, only these instructions."
              : "Rules are read by UploadReady’s built-in reader. Only these instructions leave your browser."}
          </p>
        </div>
      </Panel>

      {spec ? (
        <div ref={listRef} className="scroll-mt-28 space-y-6">
          <DocumentsPanel engine={engine} />
          <NamingPanel />
          <div className="flex justify-end">
            <Button size="lg" onClick={() => setStep(2)} disabled={!spec.documents.length}>
              Continue to files
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DocumentsPanel({ engine }: { engine: string | null }) {
  const spec = useWorkspace((s) => s.spec)!;
  const replaceRequirement = useWorkspace((s) => s.replaceRequirement);
  const addRequirement = useWorkspace((s) => s.addRequirement);
  const removeRequirement = useWorkspace((s) => s.removeRequirement);
  const [editing, setEditing] = useState<DocumentRequirement | null>(null);
  const [adding, setAdding] = useState<DocumentRequirement | null>(null);

  const source = engine === "ai" ? `Read by Claude${spec.model ? ` (${spec.model})` : ""}` : engine === "manual" ? "Added by you" : "Read by the built-in reader";

  return (
    <Panel>
      <PanelHeader
        title={`${spec.documents.length} document${spec.documents.length === 1 ? "" : "s"} to upload`}
        description={`${source}. Compare each rule with the portal and edit anything that’s off.`}
        actions={
          <Button variant="outline" size="sm" onClick={() => setAdding(emptyRequirement({ id: newId(), label: "" }))}>
            <Plus /> Add a document
          </Button>
        }
      />
      {spec.warnings.length ? (
        <div className="mx-5 mt-4 space-y-2 md:mx-6">
          {spec.warnings.map((w) => (
            <p key={w} className="flex items-start gap-2 rounded-[9px] bg-warn-tint px-3 py-2 text-sm text-warn">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {w}
            </p>
          ))}
        </div>
      ) : null}
      <ul className="divide-y divide-rule-soft">
        {spec.documents.map((d) => (
          <li key={d.id} className="grid grid-cols-[auto_1fr_auto] gap-x-4 px-5 py-4 md:px-6">
            <KindIcon kind={d.kind} />
            <div className="min-w-0">
              <p className="font-semibold text-ink">
                {d.label}
                {!d.required ? <span className="ml-2 rounded-full bg-sheet px-2 py-0.5 align-middle text-xs font-semibold text-ink-3">Optional</span> : null}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ruleChips(d).map((c) => (
                  <Chip key={c}>{c}</Chip>
                ))}
              </div>
              {d.evidence[0] ? (
                <p className="mt-2.5 max-w-[60ch]">
                  <Evidence text={d.evidence.join(" ")} />
                </p>
              ) : null}
              {d.notes.length ? (
                <ul className="mt-2 space-y-1">
                  {d.notes.map((n) => (
                    <li key={n} className="flex items-start gap-1.5 text-sm text-warn">
                      <TriangleAlert className="mt-1 size-3.5 shrink-0" /> {n}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon-sm" aria-label={`Edit ${d.label}`} onClick={() => setEditing(d)}>
                <Pencil />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${d.label}`} onClick={() => removeRequirement(d.id)}>
                <Trash2 />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {editing ? (
        <RequirementEditor open requirement={editing} onOpenChange={(o) => !o && setEditing(null)} onSave={replaceRequirement} />
      ) : null}
      {adding ? (
        <RequirementEditor open isNew requirement={adding} onOpenChange={(o) => !o && setAdding(null)} onSave={addRequirement} />
      ) : null}
    </Panel>
  );
}

function NamingPanel() {
  const spec = useWorkspace((s) => s.spec)!;
  const applicant = useWorkspace((s) => s.applicant);
  const setApplicant = useWorkspace((s) => s.setApplicant);
  const setNaming = useWorkspace((s) => s.setNaming);
  const setTotalMax = useWorkspace((s) => s.setTotalMax);
  const first = spec.documents[0];
  const example = first
    ? buildFileName({ naming: spec.naming, pattern: first.namingPattern, applicant, docLabel: first.label, ext: first.acceptedFormats[0] ?? "pdf" })
    : "";
  const [total, setTotal] = useState(spec.totalMaxBytes ? String(spec.totalMaxBytes / 1_000_000) : "");
  useEffect(() => setTotal(spec.totalMaxBytes ? String(spec.totalMaxBytes / 1_000_000) : ""), [spec.totalMaxBytes]);

  return (
    <Panel>
      <PanelHeader title="File names and packet limits" description="Names follow the application’s pattern when it gives one, without spaces or accents." />
      <div className="grid gap-5 px-5 py-5 md:grid-cols-3 md:px-6">
        <div>
          <Label htmlFor="first-name">First name</Label>
          <Input id="first-name" autoComplete="given-name" value={applicant.firstName} onChange={(e) => setApplicant({ firstName: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="last-name">Last name</Label>
          <Input id="last-name" autoComplete="family-name" value={applicant.lastName} onChange={(e) => setApplicant({ lastName: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="reference">Application number</Label>
          <Input id="reference" placeholder="If the pattern uses one" value={applicant.reference} onChange={(e) => setApplicant({ reference: e.target.value })} />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="pattern">Name pattern</Label>
          <Input
            id="pattern"
            className="font-mono text-[0.8125rem]"
            value={spec.naming.pattern ?? ""}
            placeholder={defaultPattern(applicant)}
            onChange={(e) => setNaming({ pattern: e.target.value || undefined })}
          />
          <Hint>
            Use {"{LASTNAME}"}, {"{Firstname}"}, {"{Doc}"}, {"{REF}"} and {"{date}"}. Example:{" "}
            <span className="font-semibold break-all text-ink">{example}</span>
          </Hint>
        </div>
        <div>
          <Label htmlFor="total">Total upload limit</Label>
          <div className="flex items-center gap-2">
            <Input
              id="total"
              inputMode="decimal"
              placeholder="No limit"
              value={total}
              onChange={(e) => {
                setTotal(e.target.value);
                const n = Number.parseFloat(e.target.value.replace(",", "."));
                setTotalMax(Number.isFinite(n) && n > 0 ? Math.round(n * 1_000_000) : undefined);
              }}
            />
            <span className="text-sm text-ink-3">MB</span>
          </div>
          {spec.totalMaxBytes ? <Hint>All files together must stay under {formatBytes(spec.totalMaxBytes)}.</Hint> : null}
        </div>
      </div>
    </Panel>
  );
}
