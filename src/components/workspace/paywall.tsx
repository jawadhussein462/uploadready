"use client";

import { useState } from "react";
import { Check, LoaderCircle, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { startCheckout } from "@/lib/client/api";
import { persistNow } from "@/lib/store/workspace";

export function Paywall({
  open,
  onOpenChange,
  packetId,
  title,
  fileCount,
  ruleCount,
  priceLabel,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  packetId: string;
  title: string;
  fileCount: number;
  ruleCount: number;
  priceLabel: string;
}) {
  const [busy, setBusy] = useState(false);
  const pay = async () => {
    setBusy(true);
    try {
      await persistNow();
      const url = await startCheckout(packetId, title, fileCount);
      window.location.assign(url);
    } catch (err) {
      toast.error("Payment couldn’t start", { description: (err as Error).message });
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Download your packet" description={title}>
        <div className="flex items-baseline justify-between gap-4 rounded-[10px] bg-sheet px-4 py-3">
          <span className="text-sm font-semibold text-ink-2">One payment for this application</span>
          <span className="text-2xl font-extrabold text-ink" style={{ fontStretch: "110%" }}>
            {priceLabel}
          </span>
        </div>
        <ul className="mt-4 space-y-2.5 text-sm text-ink-2">
          {[
            `${fileCount} file${fileCount === 1 ? "" : "s"}, named and ready to upload`,
            `Checked against ${ruleCount} rule${ruleCount === 1 ? "" : "s"} from the instructions`,
            "Download again after you change something in this application",
          ].map((t) => (
            <li key={t} className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-pass" strokeWidth={2.5} /> {t}
            </li>
          ))}
        </ul>
        <Button size="lg" className="mt-6 w-full" onClick={pay} disabled={busy}>
          {busy ? <LoaderCircle className="animate-spin" /> : <Lock />}
          {busy ? "Opening secure checkout" : `Pay ${priceLabel} and download`}
        </Button>
        <p className="mt-3 text-center text-xs text-ink-3">Payment is handled by Stripe. You’ll come back here afterwards, with your files still in this browser.</p>
      </DialogContent>
    </Dialog>
  );
}
