import Link from "next/link";
import { Check, CircleCheck, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A dimension line drawn over the headline: it reads "too wide" until the type condenses to fit. */
function Dimension() {
  return (
    <div className="fit-dimension relative hidden h-6 items-center md:flex" aria-hidden>
      <span className="h-4 w-[1.5px] bg-current" />
      <span className="h-[1.5px] flex-1 bg-current" />
      <span className="h-4 w-[1.5px] bg-current" />
      <span className="absolute left-1/2 grid -translate-x-1/2 bg-paper px-2.5 text-xs font-semibold">
        <span className="fit-state-over col-start-1 row-start-1 whitespace-nowrap text-center">Too wide</span>
        <span className="fit-state-fits col-start-1 row-start-1 inline-flex items-center justify-center gap-1 whitespace-nowrap">
          <Check className="size-3.5" strokeWidth={3} /> Fits
        </span>
      </span>
    </div>
  );
}

function PortraitThumb() {
  return (
    <svg viewBox="0 0 40 40" className="size-10 shrink-0 rounded-[7px]" aria-hidden>
      <rect width="40" height="40" fill="#dfe6f3" />
      <circle cx="20" cy="16" r="7" fill="#9aa8c4" />
      <path d="M7 40c1.5-8 6.5-12 13-12s11.5 4 13 12z" fill="#9aa8c4" />
    </svg>
  );
}

function SignatureThumb() {
  return (
    <svg viewBox="0 0 40 40" className="size-10 shrink-0 rounded-[7px] border border-rule-soft" aria-hidden>
      <rect width="40" height="40" fill="#fff" />
      <path d="M6 25c4-9 7-12 8-9s-3 9 0 9 5-10 8-10-1 9 2 9 4-5 6-4 2 3 5 2" fill="none" stroke="#1d3a9b" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PagesThumb() {
  return (
    <svg viewBox="0 0 40 40" className="size-10 shrink-0" aria-hidden>
      <rect x="11" y="5" width="22" height="28" rx="2" fill="#fff" stroke="#c9d1e1" />
      <rect x="7" y="8" width="22" height="28" rx="2" fill="#fff" stroke="#9aa8c4" />
      <path d="M11 15h14M11 19h14M11 23h10M11 27h12" stroke="#c9d1e1" strokeWidth="1.5" />
    </svg>
  );
}

const ROWS = [
  {
    thumb: <PortraitThumb />,
    input: "IMG_4032.HEIC, 3.8 MB",
    output: "DUPONT_Marie_Photo.jpg",
    size: "231 kB",
    limit: "limit 240 kB",
    to: "80%",
    min: undefined as string | undefined,
    delay: "1.5s",
  },
  {
    thumb: <SignatureThumb />,
    input: "signature scan.png, 1.9 MB",
    output: "DUPONT_Marie_Signature.jpg",
    size: "38 kB",
    limit: "range 10–50 kB",
    to: "63%",
    min: "17%",
    delay: "1.85s",
  },
  {
    thumb: <PagesThumb />,
    input: "3 files, 11.2 MB",
    output: "DUPONT_Marie_Transcripts.pdf",
    size: "4.6 MB",
    limit: "limit 5 MB",
    to: "77%",
    min: undefined,
    delay: "2.2s",
  },
];

function SpecSheetDemo() {
  return (
    <div className="relative lg:pt-2" aria-label="Example: three files prepared for a university application">
      <div className="rounded-[14px] border border-rule bg-paper shadow-[var(--shadow-sheet)]">
        <div className="flex items-center justify-between gap-3 border-b border-rule-soft px-5 py-3">
          <p className="text-sm font-semibold text-ink">Northbridge University upload rules</p>
          <span className="text-xs text-ink-3">Pasted from the portal</span>
        </div>
        <div className="space-y-1 px-5 py-4 text-[0.9375rem] leading-7 text-ink-2">
          <p>
            Photo: JPG only, square, <span className="marker">600–1200 pixels</span>, <span className="marker">maximum 240 KB</span>.
          </p>
          <p>
            Signature: <span className="marker">10–50 KB</span>, <span className="marker">black and white</span>.
          </p>
          <p>
            Transcripts: <span className="marker">a single PDF</span>, <span className="marker">no larger than 5 MB</span>.
          </p>
        </div>
        <ul className="divide-y divide-rule-soft border-t border-rule-soft">
          {ROWS.map((row) => (
            <li
              key={row.output}
              className="demo-row grid grid-cols-[auto_1fr] gap-x-3.5 px-5 py-3.5"
              style={{ ["--to" as string]: row.to, ["--delay" as string]: row.delay }}
            >
              {row.thumb}
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-xs text-ink-3">{row.input}</p>
                  <span className="text-xs font-semibold">
                    <span className="demo-status-fail items-center gap-1 text-fail">Doesn’t fit</span>
                    <span className="demo-status-pass inline-flex items-center gap-1 text-pass">
                      <Check className="size-3.5" strokeWidth={3} /> Fits
                    </span>
                  </span>
                </div>
                <p className="demo-out mt-0.5 truncate text-sm font-semibold text-ink">{row.output}</p>
                <div className="mt-2 flex items-center gap-3">
                  <div className="relative h-1.5 flex-1 rounded-full bg-rule-soft">
                    <div className="demo-fill absolute inset-y-0 left-0 rounded-full" />
                    {row.min ? <span className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-ink-3" style={{ left: row.min }} /> : null}
                    <span className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-ink" style={{ left: "83.3%" }} />
                  </div>
                  <span className="demo-out nums flex w-[9.5rem] shrink-0 justify-end gap-2 text-xs">
                    <span className="font-semibold text-ink">{row.size}</span>
                    <span className="text-ink-3">{row.limit}</span>
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 rounded-b-[14px] border-t border-rule-soft bg-pass-tint/60 px-5 py-3 text-sm font-semibold text-pass">
          <CircleCheck className="size-4" /> All three files meet the rules
        </div>
      </div>
    </div>
  );
}

export function Hero({ priceLabel }: { priceLabel: string }) {
  return (
    <section className="overflow-x-clip border-b border-rule-soft">
      <div className="mx-auto grid max-w-[1200px] items-start gap-12 px-5 pt-12 pb-16 md:px-8 lg:grid-cols-[1.08fr_1fr] lg:gap-16 lg:pt-20 lg:pb-24">
        <div className="max-w-[640px]">
          <div className="fit-frame">
            <Dimension />
            <h1 className="type-display fit-headline mt-3">
              <span className="fit-line block">Make every file fit</span>
              <span className="fit-line block">the upload rules.</span>
            </h1>
          </div>
          <p className="type-lead mt-7 max-w-[35rem]">
            Paste the instructions from a job, university, housing or visa application and add your photos and documents. UploadReady converts, resizes,
            compresses and renames each file, then checks it against every rule before you upload.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="lg" asChild>
              <Link href="/app">Prepare my files</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/app?sample=university">Try it with an example</Link>
            </Button>
          </div>
          <p className="mt-6 flex items-start gap-2 text-sm text-ink-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-pass" aria-hidden />
            <span>
              Your files are processed in your browser and never uploaded to us. Checking is free; downloading a finished packet costs {priceLabel}.
            </span>
          </p>
        </div>
        <SpecSheetDemo />
      </div>
    </section>
  );
}
