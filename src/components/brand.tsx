import Link from "next/link";
import { cn } from "@/lib/utils";

/** Crop marks around a check: a file framed to the rules. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <rect width="32" height="32" rx="7" fill="#0f1f4b" />
      <path d="M8 12V8h4M20 8h4v4M24 20v4h-4M12 24H8v-4" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.5 16.4l3.1 3.1 6-6.6" fill="none" stroke="#ffe45c" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5 rounded-md", className)} aria-label="UploadReady home">
      <BrandMark />
      <span className="text-[1.0625rem] font-bold tracking-[-0.01em] text-ink" style={{ fontStretch: "110%" }}>
        UploadReady
      </span>
    </Link>
  );
}
