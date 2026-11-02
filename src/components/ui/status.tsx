import { CircleAlert, CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type Status = "pass" | "warn" | "fail" | "pending" | "idle";

const STYLES: Record<Status, string> = {
  pass: "bg-pass-tint text-pass",
  warn: "bg-warn-tint text-warn",
  fail: "bg-fail-tint text-fail",
  pending: "bg-pen-tint text-pen",
  idle: "bg-sheet text-ink-3",
};

export function StatusIcon({ status, className }: { status: Status; className?: string }) {
  const cls = cn("size-4 shrink-0", className);
  if (status === "pass") return <CircleCheck className={cn(cls, "text-pass")} aria-hidden />;
  if (status === "warn") return <CircleAlert className={cn(cls, "text-warn")} aria-hidden />;
  if (status === "fail") return <CircleX className={cn(cls, "text-fail")} aria-hidden />;
  if (status === "pending") return <LoaderCircle className={cn(cls, "animate-spin text-pen")} aria-hidden />;
  return <span className={cn("inline-block size-2 shrink-0 rounded-full bg-rule", className)} aria-hidden />;
}

export function StatusBadge({ status, children, className }: { status: Status; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-2 text-xs font-semibold", STYLES[status], className)}>
      <StatusIcon status={status} className="size-3.5" />
      {children}
    </span>
  );
}

export function Chip({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn("nums inline-flex items-center gap-1 rounded-[6px] border border-rule bg-paper px-2 py-0.5 text-xs font-medium text-ink", className)}
    >
      {children}
    </span>
  );
}
