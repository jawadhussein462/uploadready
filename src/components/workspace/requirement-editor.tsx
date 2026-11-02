"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Hint, Input, Label, NativeSelect, Switch, Textarea } from "@/components/ui/fields";
import { finaliseRequirement } from "@/lib/engine/rules-parser";
import type { DocumentKind, DocumentRequirement, KnownFormat, OutputFormat } from "@/lib/engine/types";
import { KIND_LABEL } from "./shared";

type SizeUnit = "kB" | "MB";
const toInput = (bytes?: number): { value: string; unit: SizeUnit } => {
  if (!bytes) return { value: "", unit: "kB" };
  if (bytes >= 1_000_000 && bytes % 100_000 === 0) return { value: String(bytes / 1_000_000), unit: "MB" };
  return { value: String(Math.round((bytes / 1000) * 100) / 100), unit: "kB" };
};
const fromInput = (v: { value: string; unit: SizeUnit }) => {
  const n = Number.parseFloat(v.value.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * (v.unit === "MB" ? 1_000_000 : 1000));
};
const num = (s: string) => {
  const n = Number.parseFloat(s.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const str = (n?: number) => (n === undefined ? "" : String(n));

const OUTPUTS: OutputFormat[] = ["jpg", "png", "webp", "pdf"];
const PASS: KnownFormat[] = ["docx", "doc", "odt"];

function SizeField({ label, value, onChange, id }: { label: string; id: string; value: { value: string; unit: SizeUnit }; onChange: (v: { value: string; unit: SizeUnit }) => void }) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input id={id} inputMode="decimal" value={value.value} placeholder="No limit" onChange={(e) => onChange({ ...value, value: e.target.value })} />
        <NativeSelect aria-label={`${label} unit`} className="h-10 w-24" value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value as SizeUnit })}>
          <option value="kB">kB</option>
          <option value="MB">MB</option>
        </NativeSelect>
      </div>
    </div>
  );
}

export function RequirementEditor({
  open,
  onOpenChange,
  requirement,
  onSave,
  isNew,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  requirement: DocumentRequirement;
  onSave: (r: DocumentRequirement) => void;
  isNew?: boolean;
}) {
  const [r, setR] = useState(requirement);
  const [maxSize, setMaxSize] = useState(toInput(requirement.maxBytes));
  const [minSize, setMinSize] = useState(toInput(requirement.minBytes));
  const [dimMode, setDimMode] = useState<"none" | "exact" | "range">("none");
  const [ratioMode, setRatioMode] = useState<"none" | "square" | "custom">("none");
  const [ratio, setRatio] = useState({ w: "", h: "" });
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setR(requirement);
    setMaxSize(toInput(requirement.maxBytes));
    setMinSize(toInput(requirement.minBytes));
    setDimMode(requirement.exactWidth || requirement.exactHeight ? "exact" : requirement.minWidth || requirement.maxWidth || requirement.minHeight || requirement.maxHeight ? "range" : "none");
    const a = requirement.aspectRatio;
    setRatioMode(!a ? "none" : Math.abs(a - 1) < 0.005 ? "square" : "custom");
    setRatio(a && Math.abs(a - 1) >= 0.005 ? { w: String(Math.round(a * 1000) / 1000), h: "1" } : { w: "", h: "" });
    setNotes(requirement.notes.join("\n"));
  }, [open, requirement]);

  const set = <K extends keyof DocumentRequirement>(k: K, v: DocumentRequirement[K]) => setR((prev) => ({ ...prev, [k]: v }));
  const toggleFormat = (f: KnownFormat) => {
    if (OUTPUTS.includes(f as OutputFormat)) {
      const list = r.acceptedFormats.includes(f as OutputFormat) ? r.acceptedFormats.filter((x) => x !== f) : [...r.acceptedFormats, f as OutputFormat];
      set("acceptedFormats", list);
    } else {
      const list = r.passThroughFormats.includes(f) ? r.passThroughFormats.filter((x) => x !== f) : [...r.passThroughFormats, f];
      set("passThroughFormats", list);
    }
  };

  const save = () => {
    const next: DocumentRequirement = {
      ...r,
      label: r.label.trim() || "Document",
      maxBytes: fromInput(maxSize),
      minBytes: fromInput(minSize),
      notes: notes
        .split("\n")
        .map((n) => n.trim())
        .filter(Boolean),
    };
    if (dimMode !== "exact") {
      next.exactWidth = undefined;
      next.exactHeight = undefined;
    }
    if (dimMode !== "range") {
      next.minWidth = next.maxWidth = next.minHeight = next.maxHeight = undefined;
    }
    next.aspectRatio =
      ratioMode === "square" ? 1 : ratioMode === "custom" && num(ratio.w) && num(ratio.h) ? num(ratio.w)! / num(ratio.h)! : undefined;
    onSave(finaliseRequirement(next));
    onOpenChange(false);
  };

  const isImageSlot = r.acceptedFormats.some((f) => f !== "pdf");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={isNew ? "Add a document" : `Edit “${requirement.label}”`} description="Use the exact limits from the application’s instructions." wide>
        <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
          <div className="md:col-span-2 grid gap-4 sm:grid-cols-[1fr_200px]">
            <div>
              <Label htmlFor="req-label">Document name</Label>
              <Input id="req-label" value={r.label} onChange={(e) => set("label", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="req-kind">Type</Label>
              <NativeSelect id="req-kind" className="h-10" value={r.kind} onChange={(e) => set("kind", e.target.value as DocumentKind)}>
                {(Object.keys(KIND_LABEL) as DocumentKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <fieldset className="md:col-span-2">
            <legend className="mb-1.5 text-sm font-semibold text-ink">Accepted formats</legend>
            <div className="flex flex-wrap gap-2">
              {[...OUTPUTS, ...PASS].map((f) => {
                const on = r.acceptedFormats.includes(f as OutputFormat) || r.passThroughFormats.includes(f);
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleFormat(f)}
                    className={`h-8 rounded-[7px] border px-3 text-sm font-semibold transition-colors ${on ? "border-pen bg-pen-tint text-pen" : "border-rule text-ink-2 hover:bg-sheet"}`}
                  >
                    {f === "jpg" ? "JPG" : f === "docx" ? "Word (.docx)" : f === "doc" ? "Word (.doc)" : f === "odt" ? "ODT" : f.toUpperCase()}
                  </button>
                );
              })}
            </div>
            <Hint>UploadReady creates JPG, PNG, WebP and PDF files. Word files are checked and renamed but not edited.</Hint>
          </fieldset>

          <SizeField id="req-max" label="Maximum size" value={maxSize} onChange={setMaxSize} />
          <SizeField id="req-min" label="Minimum size" value={minSize} onChange={setMinSize} />

          {isImageSlot ? (
            <>
              <div className="md:col-span-2">
                <Label htmlFor="req-dims">Pixel dimensions</Label>
                <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                  <NativeSelect id="req-dims" className="h-10" value={dimMode} onChange={(e) => setDimMode(e.target.value as typeof dimMode)}>
                    <option value="none">No rule</option>
                    <option value="exact">Exactly</option>
                    <option value="range">Between</option>
                  </NativeSelect>
                  {dimMode === "exact" ? (
                    <div className="flex items-center gap-2">
                      <Input aria-label="Width in pixels" inputMode="numeric" placeholder="Width" value={str(r.exactWidth)} onChange={(e) => set("exactWidth", num(e.target.value))} />
                      <span className="text-ink-3">×</span>
                      <Input aria-label="Height in pixels" inputMode="numeric" placeholder="Height" value={str(r.exactHeight)} onChange={(e) => set("exactHeight", num(e.target.value))} />
                      <span className="text-sm text-ink-3">px</span>
                    </div>
                  ) : dimMode === "range" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Input aria-label="Minimum width" inputMode="numeric" placeholder="Min width" value={str(r.minWidth)} onChange={(e) => set("minWidth", num(e.target.value))} />
                      <Input aria-label="Maximum width" inputMode="numeric" placeholder="Max width" value={str(r.maxWidth)} onChange={(e) => set("maxWidth", num(e.target.value))} />
                      <Input aria-label="Minimum height" inputMode="numeric" placeholder="Min height" value={str(r.minHeight)} onChange={(e) => set("minHeight", num(e.target.value))} />
                      <Input aria-label="Maximum height" inputMode="numeric" placeholder="Max height" value={str(r.maxHeight)} onChange={(e) => set("maxHeight", num(e.target.value))} />
                    </div>
                  ) : (
                    <p className="self-center text-sm text-ink-3">Keeps the original size, within sensible limits.</p>
                  )}
                </div>
              </div>

              <div>
                <Label htmlFor="req-ratio">Proportions</Label>
                <div className="flex gap-2">
                  <NativeSelect id="req-ratio" className="h-10" value={ratioMode} onChange={(e) => setRatioMode(e.target.value as typeof ratioMode)}>
                    <option value="none">Any</option>
                    <option value="square">Square</option>
                    <option value="custom">Width : height</option>
                  </NativeSelect>
                  {ratioMode === "custom" ? (
                    <>
                      <Input aria-label="Ratio width" inputMode="decimal" value={ratio.w} onChange={(e) => setRatio({ ...ratio, w: e.target.value })} />
                      <Input aria-label="Ratio height" inputMode="decimal" value={ratio.h} onChange={(e) => setRatio({ ...ratio, h: e.target.value })} />
                    </>
                  ) : null}
                </div>
              </div>

              <div>
                <Label htmlFor="req-dpi">DPI in the file</Label>
                <Input id="req-dpi" inputMode="numeric" placeholder="Not required" value={str(r.dpi)} onChange={(e) => set("dpi", num(e.target.value))} />
              </div>

              <div>
                <Label htmlFor="req-print">Print size (mm)</Label>
                <div className="flex items-center gap-2">
                  <Input id="req-print" aria-label="Print width in mm" inputMode="decimal" placeholder="Width" value={str(r.physicalWidthMm)} onChange={(e) => set("physicalWidthMm", num(e.target.value))} />
                  <span className="text-ink-3">×</span>
                  <Input aria-label="Print height in mm" inputMode="decimal" placeholder="Height" value={str(r.physicalHeightMm)} onChange={(e) => set("physicalHeightMm", num(e.target.value))} />
                </div>
              </div>

              <div>
                <Label htmlFor="req-bg">Background</Label>
                <NativeSelect id="req-bg" className="h-10" value={r.background ?? ""} onChange={(e) => set("background", (e.target.value || undefined) as DocumentRequirement["background"])}>
                  <option value="">No rule</option>
                  <option value="white">White</option>
                  <option value="light">Light</option>
                  <option value="plain">Plain</option>
                </NativeSelect>
              </div>
            </>
          ) : null}

          <div>
            <Label htmlFor="req-colour">Colour</Label>
            <NativeSelect id="req-colour" className="h-10" value={r.colorMode ?? ""} onChange={(e) => set("colorMode", (e.target.value || undefined) as DocumentRequirement["colorMode"])}>
              <option value="">No rule</option>
              <option value="color">In colour</option>
              <option value="grayscale">Black and white</option>
            </NativeSelect>
          </div>

          {r.acceptedFormats.includes("pdf") ? (
            <div>
              <Label htmlFor="req-pages">Maximum pages</Label>
              <Input id="req-pages" inputMode="numeric" placeholder="No limit" value={str(r.maxPages)} onChange={(e) => set("maxPages", num(e.target.value))} />
            </div>
          ) : null}

          <div>
            <Label htmlFor="req-combine">Several files for this document</Label>
            <NativeSelect id="req-combine" className="h-10" value={r.combine ?? ""} onChange={(e) => set("combine", (e.target.value || undefined) as DocumentRequirement["combine"])}>
              <option value="">Not expected</option>
              <option value="merge">Combine into one file</option>
              <option value="separate">Keep as separate files</option>
            </NativeSelect>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-[10px] border border-rule-soft px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-ink">Required</p>
              <p className="text-xs text-ink-3">Optional documents can be left empty.</p>
            </div>
            <Switch checked={r.required} onCheckedChange={(v) => set("required", v)} aria-label="Required" />
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="req-notes">Other rules to remember</Label>
            <Textarea id="req-notes" className="min-h-20" placeholder="One per line, e.g. Dated within the last 3 months" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save}>{isNew ? "Add document" : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
