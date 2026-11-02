"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, LoaderCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { StatusIcon, type Status } from "@/components/ui/status";
import { checkUnlock, fetchConfig, verifyCheckout } from "@/lib/client/api";
import { formatBytes } from "@/lib/engine/units";
import { filesForSlot, slotSignature, useWorkspace, type Step } from "@/lib/store/workspace";
import type { PublicConfig } from "@/lib/server/config";
import { cn } from "@/lib/utils";
import { FilesStep } from "./files-step";
import { ReviewStep } from "./review-step";
import { RulesStep } from "./rules-step";
import { ruleChips } from "./shared";

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: "Rules" },
  { n: 2, label: "Files" },
  { n: 3, label: "Check and download" },
];

export function Workspace() {
  const hydrated = useWorkspace((s) => s.hydrated);
  const hydrate = useWorkspace((s) => s.hydrate);
  const step = useWorkspace((s) => s.step);
  const packetId = useWorkspace((s) => s.packetId);
  const unlockToken = useWorkspace((s) => s.unlockToken);
  const setUnlockToken = useWorkspace((s) => s.setUnlockToken);
  const params = useSearchParams();
  const router = useRouter();
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [sample, setSample] = useState<string | null>(null);

  useEffect(() => {
    void hydrate();
    void fetchConfig().then(setConfig);
  }, [hydrate]);

  // Query parameters: ?sample=…, and the return from Stripe Checkout.
  useEffect(() => {
    if (!hydrated) return;
    const s = params.get("sample");
    const checkout = params.get("checkout");
    const sessionId = params.get("session_id");
    if (s) {
      const st = useWorkspace.getState();
      if (!st.spec) setSample(s);
    }
    if (checkout === "cancelled") toast("Payment cancelled", { description: "Nothing was charged. Your files are still here." });
    if (checkout === "success" && sessionId) {
      void verifyCheckout(sessionId)
        .then((res) => {
          const current = useWorkspace.getState().packetId;
          if (res.paid && res.token && res.packetId === current) {
            setUnlockToken(res.token);
            setUnlocked(true);
            useWorkspace.getState().setStep(3);
            toast.success("Payment received", { description: "Your packet is unlocked. Download it whenever you’re ready." });
          } else if (res.paid) {
            toast.error("This payment is for a different packet", { description: "Contact support with your receipt if you need help." });
          } else {
            toast.error("The payment hasn’t gone through yet", { description: "Refresh this page in a moment." });
          }
        })
        .catch((err) => toast.error("Couldn’t confirm the payment", { description: (err as Error).message }));
    }
    if (s || checkout) router.replace("/app", { scroll: false });
  }, [hydrated, params, router, setUnlockToken]);

  // A stored receipt is re-checked with the server.
  useEffect(() => {
    if (!config) return;
    if (!config.payments.enabled) return setUnlocked(true);
    if (!unlockToken) return setUnlocked(false);
    void checkUnlock(packetId, unlockToken).then(setUnlocked);
  }, [config, unlockToken, packetId]);

  if (!hydrated) {
    return (
      <div className="grid min-h-dvh place-items-center text-ink-3">
        <LoaderCircle className="size-6 animate-spin" aria-label="Loading your work" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-sheet/60">
      <WorkspaceHeader />
      <Stepper />
      <div className="mx-auto grid max-w-[1320px] items-start gap-6 px-4 pt-6 pb-20 md:px-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <ChecklistRail />
        <main className="min-w-0">
          {step === 1 ? <RulesStep config={config} autoSample={sample} /> : null}
          {step === 2 ? <FilesStep demo={!!sample} /> : null}
          {step === 3 ? <ReviewStep config={config} unlocked={unlocked} /> : null}
        </main>
      </div>
    </div>
  );
}

function WorkspaceHeader() {
  const spec = useWorkspace((s) => s.spec);
  const setTitle = useWorkspace((s) => s.setTitle);
  const reset = useWorkspace((s) => s.reset);
  const [confirm, setConfirm] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-paper/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-4 px-4 md:px-6">
        <Wordmark />
        <span className="hidden h-5 w-px bg-rule sm:block" aria-hidden />
        {spec ? (
          <input
            aria-label="Packet name"
            value={spec.title}
            onChange={(e) => setTitle(e.target.value)}
            className="hidden min-w-0 flex-1 truncate rounded-[7px] border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-ink hover:border-rule focus:border-pen focus:outline-none sm:block"
          />
        ) : (
          <span className="hidden flex-1 text-sm text-ink-3 sm:block">New application packet</span>
        )}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setConfirm(true)}>
          <RotateCcw /> <span className="hidden sm:inline">Start a new packet</span>
        </Button>
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent title="Start a new packet?" description="This deletes the rules, files and results saved in this browser.">
          <p className="text-sm text-ink-2">Download anything you need first. A paid packet can’t be unlocked again after it’s deleted.</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Keep working
            </Button>
            <Button
              variant="primary"
              className="bg-fail hover:bg-[#a52622]"
              onClick={async () => {
                await reset();
                setConfirm(false);
                toast("Started a new packet");
              }}
            >
              Delete and start over
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}

function Stepper() {
  const step = useWorkspace((s) => s.step);
  const setStep = useWorkspace((s) => s.setStep);
  const hasSpec = useWorkspace((s) => !!s.spec?.documents.length);
  const hasFiles = useWorkspace((s) => Object.values(s.assignments).some(Boolean));
  const reachable = (n: Step) => n === 1 || (n === 2 && hasSpec) || (n === 3 && hasSpec && hasFiles);
  return (
    <nav aria-label="Progress" className="border-b border-rule bg-paper">
      <ol className="mx-auto flex max-w-[1320px] items-center gap-2 overflow-x-auto px-4 py-3 md:px-6">
        {STEPS.map((s, i) => {
          const done = s.n < step;
          const current = s.n === step;
          return (
            <li key={s.n} className="flex shrink-0 items-center gap-2">
              {i > 0 ? <span className={cn("h-px w-6 md:w-12", done || current ? "bg-pen" : "bg-rule")} aria-hidden /> : null}
              <button
                type="button"
                disabled={!reachable(s.n)}
                onClick={() => setStep(s.n)}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  current ? "bg-pen-tint text-pen" : done ? "text-ink hover:bg-sheet" : "text-ink-3 hover:bg-sheet",
                )}
              >
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-full text-xs",
                    current ? "bg-pen text-white" : done ? "bg-ink text-white" : "border border-rule bg-paper text-ink-3",
                  )}
                >
                  {done ? <Check className="size-3.5" strokeWidth={3} /> : s.n}
                </span>
                {s.n === 3 ? (
                  <>
                    <span className="sm:hidden">Check</span>
                    <span className="hidden sm:inline">{s.label}</span>
                  </>
                ) : (
                  s.label
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ChecklistRail() {
  const spec = useWorkspace((s) => s.spec);
  const step = useWorkspace((s) => s.step);
  const state = useWorkspace();
  const totalBytes = useMemo(
    () => Object.values(state.results).reduce((n, r) => n + r.outputs.reduce((m, o) => m + o.bytes.length, 0), 0),
    [state.results],
  );
  if (!spec) {
    return (
      <aside className="hidden rounded-[14px] border border-dashed border-rule bg-paper/60 p-5 text-sm text-ink-3 lg:block">
        The checklist of documents appears here once the rules are read.
      </aside>
    );
  }
  return (
    <aside className="sticky top-[7.5rem] hidden max-h-[calc(100dvh-9rem)] overflow-y-auto rounded-[14px] border border-rule bg-paper lg:block" aria-label="Checklist">
      <div className="border-b border-rule-soft px-4 py-3">
        <p className="text-sm font-bold text-ink">Checklist</p>
        <p className="text-xs text-ink-3">
          {spec.documents.length} document{spec.documents.length === 1 ? "" : "s"}
          {spec.totalMaxBytes ? `, ${formatBytes(spec.totalMaxBytes)} in total` : ""}
        </p>
      </div>
      <ol className="divide-y divide-rule-soft">
        {spec.documents.map((d) => {
          const files = filesForSlot(state, d.id);
          const r = state.results[d.id];
          let status: Status = "idle";
          let line = ruleChips(d).slice(0, 3).join(", ");
          if (step === 2) {
            status = files.length ? "pass" : d.required ? "warn" : "idle";
            line = files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : d.required ? "Needs a file" : "Optional";
          }
          if (step === 3) {
            const fresh = r && r.signature === slotSignature(state, d.id) && !state.progress[d.id];
            status = !fresh ? "pending" : r.status === "ready" ? "pass" : r.status === "attention" ? "warn" : r.status === "blocked" ? "fail" : d.required ? "fail" : "idle";
            line = !fresh ? "Preparing" : r.outputs[0] ? `${formatBytes(r.outputs.reduce((n, o) => n + o.bytes.length, 0))}, ${r.outputs[0].name}` : d.required ? "No file" : "Skipped";
          }
          const anchor = step === 3 ? `slot-${d.id}` : step === 2 ? `files-${d.id}` : undefined;
          return (
            <li key={d.id}>
              <a
                href={anchor ? `#${anchor}` : undefined}
                className={cn("flex items-start gap-2.5 px-4 py-3", anchor && "hover:bg-sheet")}
                onClick={(e) => {
                  if (!anchor) return;
                  e.preventDefault();
                  document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                <StatusIcon status={status} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{d.label}</span>
                  <span className="nums block truncate text-xs text-ink-3">{line}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
      {step === 3 && spec.totalMaxBytes ? (
        <div className="border-t border-rule-soft px-4 py-3 text-xs text-ink-3">
          <span className={cn("nums font-semibold", totalBytes > spec.totalMaxBytes ? "text-fail" : "text-ink")}>{formatBytes(totalBytes)}</span> of{" "}
          {formatBytes(spec.totalMaxBytes)} used
        </div>
      ) : null}
    </aside>
  );
}
