"use client";

import { create } from "zustand";
import { del as idbDel, get as idbGet, set as idbSet } from "idb-keyval";
import { assignFiles, type FileFeatures } from "@/lib/engine/assign";
import { inspectFile } from "@/lib/engine/inspect";
import type { InputFile, SlotResult, SlotSettings } from "@/lib/engine/pipeline";
import { newId } from "@/lib/engine/rules-parser";
import { DEFAULT_NAMING, type Applicant, type DocumentRequirement, type NamingRules, type PacketSpec } from "@/lib/engine/types";

export type Step = 1 | 2 | 3;
export type Engine = "ai" | "rules" | "manual" | "sample";

const STATE_KEY = "uploadready:state:v1";
const FILE_KEY = (id: string) => `uploadready:file:${id}`;

export type ApplicantInfo = Applicant & { reference: string };
export type StoredResult = SlotResult & { signature: string };

interface Persisted {
  packetId: string;
  step: Step;
  instructions: string;
  spec: PacketSpec | null;
  engine: Engine | null;
  applicant: ApplicantInfo;
  files: InputFile[];
  assignments: Record<string, string | null>;
  manual: Record<string, boolean>;
  order: Record<string, string[]>;
  settings: Record<string, SlotSettings>;
  unlockToken: string | null;
}

interface WorkspaceState extends Persisted {
  hydrated: boolean;
  results: Record<string, StoredResult>;
  progress: Record<string, { fraction: number; label: string }>;
  hydrate: () => Promise<void>;
  setStep: (s: Step) => void;
  setInstructions: (t: string) => void;
  setSpec: (spec: PacketSpec, engine: Engine) => void;
  setTitle: (t: string) => void;
  updateRequirement: (id: string, patch: Partial<DocumentRequirement>) => void;
  replaceRequirement: (req: DocumentRequirement) => void;
  addRequirement: (req: DocumentRequirement) => void;
  removeRequirement: (id: string) => void;
  setNaming: (patch: Partial<NamingRules>) => void;
  setTotalMax: (bytes: number | undefined) => void;
  setApplicant: (patch: Partial<ApplicantInfo>) => void;
  addFiles: (files: (File | { blob: Blob; name: string })[]) => Promise<void>;
  removeFile: (id: string) => void;
  assign: (fileId: string, slotId: string | null) => void;
  moveInSlot: (slotId: string, fileId: string, dir: -1 | 1) => void;
  setSettings: (slotId: string, patch: Partial<SlotSettings>) => void;
  setResult: (slotId: string, result: StoredResult) => void;
  setProgress: (slotId: string, p: { fraction: number; label: string } | null) => void;
  setUnlockToken: (token: string | null) => void;
  reset: () => Promise<void>;
}

const emptyState = (): Persisted => ({
  packetId: newId("pk").replace(/[^A-Za-z0-9_-]/g, ""),
  step: 1,
  instructions: "",
  spec: null,
  engine: null,
  applicant: { firstName: "", lastName: "", reference: "" },
  files: [],
  assignments: {},
  manual: {},
  order: {},
  settings: {},
  unlockToken: null,
});

function features(files: InputFile[]): FileFeatures[] {
  return files.map((f) => ({ id: f.id, name: f.name, format: f.format, pages: f.pages, traits: f.traits }));
}

/** Re-run automatic matching for every file the user hasn't placed by hand. */
function reassign(state: Pick<Persisted, "files" | "spec" | "assignments" | "manual">): Record<string, string | null> {
  if (!state.spec) return Object.fromEntries(state.files.map((f) => [f.id, null]));
  const slotIds = new Set(state.spec.documents.map((d) => d.id));
  const fixed: Record<string, string | null> = {};
  for (const f of state.files) {
    if (state.manual[f.id]) {
      const s = state.assignments[f.id] ?? null;
      fixed[f.id] = s && slotIds.has(s) ? s : null;
    }
  }
  return assignFiles(features(state.files), state.spec.documents, fixed);
}

export function filesForSlot(state: Pick<Persisted, "files" | "assignments" | "order">, slotId: string): InputFile[] {
  const list = state.files.filter((f) => state.assignments[f.id] === slotId);
  const order = state.order[slotId] ?? [];
  return list.sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.addedAt - b.addedAt;
  });
}

/** Everything that affects a slot's output. A changed signature means the result is stale. */
export function slotSignature(state: Persisted, slotId: string): string {
  const req = state.spec?.documents.find((d) => d.id === slotId);
  const files = filesForSlot(state, slotId).map((f) => f.id);
  return JSON.stringify({
    req,
    files,
    settings: state.settings[slotId] ?? {},
    naming: state.spec?.naming,
    applicant: state.applicant,
  });
}

function revokeResult(r?: SlotResult) {
  if (!r) return;
  for (const o of r.outputs) if (o.previewUrl) URL.revokeObjectURL(o.previewUrl);
  if (r.framing?.sourceUrl) URL.revokeObjectURL(r.framing.sourceUrl);
}

export const useWorkspace = create<WorkspaceState>()((set, get) => ({
  ...emptyState(),
  hydrated: false,
  results: {},
  progress: {},

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const saved = (await idbGet(STATE_KEY)) as (Omit<Persisted, "files"> & { files: Omit<InputFile, "blob" | "thumbUrl">[] }) | undefined;
      if (saved && saved.packetId) {
        const files: InputFile[] = [];
        for (const meta of saved.files ?? []) {
          const blob = (await idbGet(FILE_KEY(meta.id))) as Blob | undefined;
          if (!blob) continue;
          try {
            const inspected = await inspectFile(blob, meta.name, meta.id);
            files.push({ ...inspected, addedAt: meta.addedAt });
          } catch {
            files.push({ ...meta, blob });
          }
        }
        set({ ...emptyState(), ...saved, files, hydrated: true });
        return;
      }
    } catch (err) {
      console.warn("Could not restore saved work", err);
    }
    set({ hydrated: true });
  },

  setStep: (step) => set({ step }),
  setInstructions: (instructions) => set({ instructions }),

  setSpec: (spec, engine) =>
    set((s) => {
      const next = { ...s, spec, engine };
      for (const r of Object.values(s.results)) revokeResult(r);
      return { spec, engine, assignments: reassign(next), results: {}, progress: {} };
    }),

  setTitle: (title) => set((s) => (s.spec ? { spec: { ...s.spec, title } } : {})),

  updateRequirement: (id, patch) =>
    set((s) => {
      if (!s.spec) return {};
      const documents = s.spec.documents.map((d) => (d.id === id ? { ...d, ...patch } : d));
      const spec = { ...s.spec, documents };
      return { spec, assignments: reassign({ ...s, spec }) };
    }),

  replaceRequirement: (req) =>
    set((s) => {
      if (!s.spec) return {};
      const documents = s.spec.documents.map((d) => (d.id === req.id ? req : d));
      const spec = { ...s.spec, documents };
      return { spec, assignments: reassign({ ...s, spec }) };
    }),

  addRequirement: (req) =>
    set((s) => {
      const spec: PacketSpec = s.spec
        ? { ...s.spec, documents: [...s.spec.documents, req] }
        : { title: "Application packet", documents: [req], naming: DEFAULT_NAMING, warnings: [], source: "manual", confidence: 1 };
      return { spec, engine: s.engine ?? "manual", assignments: reassign({ ...s, spec }) };
    }),

  removeRequirement: (id) =>
    set((s) => {
      if (!s.spec) return {};
      const spec = { ...s.spec, documents: s.spec.documents.filter((d) => d.id !== id) };
      const manual = { ...s.manual };
      for (const [fid, sid] of Object.entries(s.assignments)) if (sid === id) delete manual[fid];
      revokeResult(s.results[id]);
      const results = { ...s.results };
      delete results[id];
      return { spec, manual, results, assignments: reassign({ ...s, spec, manual }) };
    }),

  setNaming: (patch) => set((s) => (s.spec ? { spec: { ...s.spec, naming: { ...s.spec.naming, ...patch } } } : {})),
  setTotalMax: (bytes) => set((s) => (s.spec ? { spec: { ...s.spec, totalMaxBytes: bytes } } : {})),
  setApplicant: (patch) => set((s) => ({ applicant: { ...s.applicant, ...patch } })),

  addFiles: async (incoming) => {
    const added: InputFile[] = [];
    for (const item of incoming) {
      const blob = item instanceof File ? item : item.blob;
      const name = item instanceof File ? item.name : item.name;
      try {
        const f = await inspectFile(blob, name);
        added.push(f);
        await idbSet(FILE_KEY(f.id), blob).catch(() => undefined);
      } catch (err) {
        console.warn("Could not read", name, err);
      }
    }
    set((s) => {
      const files = [...s.files, ...added];
      return { files, assignments: reassign({ ...s, files }) };
    });
  },

  removeFile: (id) => {
    idbDel(FILE_KEY(id)).catch(() => undefined);
    set((s) => {
      const file = s.files.find((f) => f.id === id);
      if (file?.thumbUrl) URL.revokeObjectURL(file.thumbUrl);
      const files = s.files.filter((f) => f.id !== id);
      const assignments = { ...s.assignments };
      delete assignments[id];
      const manual = { ...s.manual };
      delete manual[id];
      return { files, manual, assignments: reassign({ ...s, files, assignments, manual }) };
    });
  },

  assign: (fileId, slotId) =>
    set((s) => {
      const manual = { ...s.manual, [fileId]: true };
      const assignments = { ...s.assignments, [fileId]: slotId };
      const order = { ...s.order };
      if (slotId) order[slotId] = [...(order[slotId] ?? []).filter((x) => x !== fileId), fileId];
      return { manual, order, assignments: reassign({ ...s, manual, assignments }) };
    }),

  moveInSlot: (slotId, fileId, dir) =>
    set((s) => {
      const ids = filesForSlot(s, slotId).map((f) => f.id);
      const i = ids.indexOf(fileId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return {};
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return { order: { ...s.order, [slotId]: ids } };
    }),

  setSettings: (slotId, patch) => set((s) => ({ settings: { ...s.settings, [slotId]: { ...(s.settings[slotId] ?? {}), ...patch } } })),

  setResult: (slotId, result) =>
    set((s) => {
      if (s.results[slotId] && s.results[slotId] !== result) revokeResult(s.results[slotId]);
      return { results: { ...s.results, [slotId]: result } };
    }),

  setProgress: (slotId, p) =>
    set((s) => {
      const progress = { ...s.progress };
      if (p) progress[slotId] = p;
      else delete progress[slotId];
      return { progress };
    }),

  setUnlockToken: (unlockToken) => set({ unlockToken }),

  reset: async () => {
    const s = get();
    for (const f of s.files) {
      if (f.thumbUrl) URL.revokeObjectURL(f.thumbUrl);
      await idbDel(FILE_KEY(f.id)).catch(() => undefined);
    }
    for (const r of Object.values(s.results)) revokeResult(r);
    await idbDel(STATE_KEY).catch(() => undefined);
    set({ ...emptyState(), results: {}, progress: {}, hydrated: true });
  },
}));

/* ------------------------------ Persistence ------------------------------ */

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function persistNow(): Promise<void> {
  const s = useWorkspace.getState();
  if (!s.hydrated) return Promise.resolve();
  const data = {
    packetId: s.packetId,
    step: s.step,
    instructions: s.instructions,
    spec: s.spec,
    engine: s.engine,
    applicant: s.applicant,
    files: s.files.map(({ blob: _blob, thumbUrl: _thumb, ...meta }) => meta),
    assignments: s.assignments,
    manual: s.manual,
    order: s.order,
    settings: s.settings,
    unlockToken: s.unlockToken,
  };
  return idbSet(STATE_KEY, data).catch((err) => console.warn("Could not save work", err));
}

const PERSISTED_KEYS: (keyof Persisted)[] = [
  "packetId",
  "step",
  "instructions",
  "spec",
  "engine",
  "applicant",
  "files",
  "assignments",
  "manual",
  "order",
  "settings",
  "unlockToken",
];

if (typeof window !== "undefined") {
  useWorkspace.subscribe((state, prev) => {
    if (!state.hydrated || !PERSISTED_KEYS.some((k) => state[k] !== prev[k])) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void persistNow(), 350);
  });
}
