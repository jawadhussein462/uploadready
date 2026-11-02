import Link from "next/link";
import { ArrowRight, Check, CircleAlert, Lock, MonitorSmartphone, ScrollText, ShieldCheck } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { RdChart } from "./rd-chart";

function Container({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`mx-auto max-w-[1200px] px-5 md:px-8 ${className}`}>{children}</div>;
}

/* --------------------------------------------------------------------------- */

const REJECTIONS = [
  { field: "Passport photo", file: "IMG_4032.HEIC", error: "This file type is not supported. Upload a JPG or PNG." },
  { field: "Transcripts", file: "Scan 14 mars.pdf (11.4 MB)", error: "The file exceeds the maximum size of 5 MB." },
  { field: "Digital photograph", file: "photo.jpg (4032 × 3024)", error: "Photo must be between 600 × 600 and 1200 × 1200 pixels." },
];

export function Rejections() {
  return (
    <section className="border-b border-rule-soft bg-sheet/70">
      <Container className="py-16 md:py-20">
        <h2 className="type-h2 max-w-[42rem]">Portals reject files for reasons that have nothing to do with your application.</h2>
        <p className="type-lead mt-4 max-w-[38rem]">
          Each portal has its own list of formats, sizes and dimensions, and usually explains it in a paragraph you read after the upload fails.
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {REJECTIONS.map((r) => (
            <div key={r.field}>
              <p className="mb-1.5 text-sm font-semibold text-ink">
                {r.field} <span className="text-fail">*</span>
              </p>
              <div className="flex h-11 items-center justify-between gap-3 rounded-[8px] border-[1.5px] border-fail bg-paper px-3">
                <span className="truncate text-sm text-ink">{r.file}</span>
                <span className="shrink-0 rounded-[6px] border border-rule bg-sheet px-2 py-0.5 text-xs font-medium text-ink-2">Browse</span>
              </div>
              <p className="mt-2 flex items-start gap-1.5 text-sm text-fail">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {r.error}
              </p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* --------------------------------------------------------------------------- */

const STEPS = [
  {
    title: "Paste the rules",
    body: "Copy the instructions from the application page or add a screenshot. UploadReady lists every document with its limits and shows the sentence each rule came from, so you can check it.",
  },
  {
    title: "Add your files",
    body: "Drop in photos, scans and PDFs, including iPhone HEIC photos. Each file is matched to the document it belongs to, and you can move it with one click.",
  },
  {
    title: "Download the packet",
    body: "Every file is converted, resized, compressed and renamed, then checked again. Anything that needs you, like a blurry photo or too many pages, comes with the fix.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-20 border-b border-rule-soft">
      <Container className="py-16 md:py-24">
        <h2 className="type-h2">Three steps, about two minutes</h2>
        <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-0">
          {STEPS.map((s, i) => (
            <li key={s.title} className="md:border-l md:border-rule md:px-8 md:first:border-l-0 md:first:pl-0">
              <span className="text-5xl font-extrabold text-pen" style={{ fontStretch: "118%" }} aria-hidden>
                {i + 1}
              </span>
              <h3 className="type-h3 mt-4">{s.title}</h3>
              <p className="mt-2 max-w-[22rem] text-ink-2">{s.body}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

/* --------------------------------------------------------------------------- */

const LEDGER: [string, string][] = [
  ["iPhone photo in HEIC, 3.8 MB", "JPG, 900 × 900 px, 231 kB, face centred"],
  ["Signature photographed on a desk", "Trimmed, on pure white, 38 kB"],
  ["Three transcripts in separate PDFs", "One PDF in your order, 4.6 MB"],
  ["11 MB scan of a passport page", "1.9 MB PDF with sharp text"],
  ["Phone photo of a payslip, with shadows", "An even, white, readable page"],
  ["“Scan 14 mars (2).pdf”", "DUPONT_Marie_Payslips.pdf"],
  ["A photo saying 72 dpi in its metadata", "300 dpi written into the file"],
  ["Location data from your phone’s camera", "Removed from every image"],
];

export function Ledger() {
  return (
    <section className="border-b border-rule-soft">
      <Container className="grid gap-10 py-16 md:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div>
          <h2 className="type-h2 max-w-[24rem]">What changes between your file and the portal</h2>
          <p className="type-lead mt-4 max-w-[26rem]">
            UploadReady only changes what the rules require. Documents keep their content; photos keep their colour unless black and white is asked for.
          </p>
        </div>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-ink/80">
              <th scope="col" className="w-1/2 pb-3 text-sm font-semibold text-ink-3">
                You add
              </th>
              <th scope="col" className="pb-3 pl-6 text-sm font-semibold text-ink-3">
                The portal receives
              </th>
            </tr>
          </thead>
          <tbody>
            {LEDGER.map(([from, to]) => (
              <tr key={from} className="border-b border-rule-soft align-top">
                <td className="py-3.5 pr-4 text-ink-2">{from}</td>
                <td className="relative py-3.5 pl-6 font-semibold text-ink">
                  <ArrowRight className="absolute top-[1.15rem] -left-2 size-4 text-pen" aria-hidden />
                  {to}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Container>
    </section>
  );
}

/* --------------------------------------------------------------------------- */

const SCIENCE = [
  {
    title: "Hitting the size limit",
    body: "For each format the portal accepts, the encoder’s quality is found by bisection: the highest setting that still fits. This is repeated at a few output sizes. Every candidate is decoded and compared with the original using SSIM, a measure of how much structure survives. The best-scoring file under the limit wins, which is sometimes a slightly smaller image at higher quality.",
  },
  {
    title: "Framing ID photos",
    body: "The face is located from skin tones that stand apart from the background colour, measured in CIELAB. The frame is then set to ID-photo proportions: the head fills about 60% of a square photo and 70% of a 35 × 45 mm one. You can always adjust the frame by hand.",
  },
  {
    title: "Matching files to documents",
    body: "File names, what an image looks like (face, signature or page) and format compatibility give every file–document pair a score. The Hungarian algorithm then picks the best overall assignment, so two similar files never compete for the same slot.",
  },
  {
    title: "Checking what the portal checks",
    body: "Each finished file is read again from its bytes: the type from its signature, dimensions and DPI from its headers, page count from the PDF. A 240 KB limit is read as 240,000 bytes, which passes whether the portal counts 1,000 or 1,024 bytes per KB.",
  },
];

export function UnderTheHood() {
  return (
    <section id="under-the-hood" className="scroll-mt-20 border-b border-rule-soft bg-sheet/70">
      <Container className="py-16 md:py-24">
        <h2 className="type-h2 max-w-[38rem]">How it reaches a limit without ruining the file</h2>
        <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {SCIENCE.map((s) => (
              <div key={s.title}>
                <h3 className="text-base font-bold text-ink">{s.title}</h3>
                <p className="mt-2 text-[0.9375rem] leading-[1.6rem] text-ink-2">{s.body}</p>
              </div>
            ))}
          </div>
          <RdChart className="self-start" />
        </div>
      </Container>
    </section>
  );
}

/* --------------------------------------------------------------------------- */

export function Privacy() {
  const rows = [
    {
      icon: <MonitorSmartphone className="size-5" />,
      what: "Your photos and documents",
      where: "Processed in this browser tab. They are never uploaded to UploadReady.",
    },
    {
      icon: <ScrollText className="size-5" />,
      what: "The instructions you paste",
      where: "Sent to read the rules, through our server and, when AI reading is on, Anthropic’s API. UploadReady doesn’t store them. Screenshots are handled the same way.",
    },
    {
      icon: <Lock className="size-5" />,
      what: "Your payment",
      where: "Handled by Stripe. UploadReady never sees your card details.",
    },
  ];
  return (
    <section id="privacy" className="scroll-mt-20 border-b border-rule-soft">
      <Container className="grid gap-10 py-16 md:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div>
          <ShieldCheck className="size-8 text-pass" aria-hidden />
          <h2 className="type-h2 mt-4 max-w-[24rem]">Your documents stay on your device</h2>
          <p className="type-lead mt-4 max-w-[26rem]">
            Passports, payslips and bank statements are exactly the files you shouldn’t hand to a stranger’s server. So the work happens where the files already are.
          </p>
        </div>
        <ul className="divide-y divide-rule-soft border-y border-rule-soft">
          {rows.map((r) => (
            <li key={r.what} className="grid grid-cols-[auto_1fr] gap-x-4 py-5 sm:grid-cols-[auto_14rem_1fr]">
              <span className="mt-0.5 text-ink-3">{r.icon}</span>
              <p className="font-semibold text-ink">{r.what}</p>
              <p className="col-start-2 text-ink-2 sm:col-start-3">{r.where}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

/* --------------------------------------------------------------------------- */

export function Pricing({ priceLabel }: { priceLabel: string }) {
  return (
    <section id="pricing" className="scroll-mt-20 border-b border-rule-soft bg-sheet/70">
      <Container className="py-16 md:py-24">
        <h2 className="type-h2">One price per application</h2>
        <p className="type-lead mt-4 max-w-[34rem]">No account and no subscription. You only pay when the packet is ready and every check has run.</p>
        <div className="mt-10 grid overflow-hidden rounded-[14px] border border-rule bg-paper md:grid-cols-2">
          <div className="p-7 md:p-9">
            <p className="text-sm font-semibold text-ink-3">Before you pay</p>
            <p className="mt-2 text-4xl font-extrabold text-ink" style={{ fontStretch: "110%" }}>
              Free
            </p>
            <ul className="mt-6 space-y-3 text-ink-2">
              {["Read the rules from text or a screenshot", "Prepare every document in the application", "See previews and every check, pass or fail"].map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <Check className="mt-1 size-4 shrink-0 text-pass" strokeWidth={2.5} aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t border-rule bg-ink p-7 text-white md:border-t-0 md:border-l md:p-9">
            <p className="text-sm font-semibold text-white/70">To download the packet</p>
            <p className="mt-2 text-4xl font-extrabold" style={{ fontStretch: "110%" }}>
              {priceLabel}
            </p>
            <ul className="mt-6 space-y-3 text-white/85">
              {["All files as one ZIP or one by one", "Download again after edits to the same application", "Paid once, through Stripe"].map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <Check className="mt-1 size-4 shrink-0 text-marker" strokeWidth={2.5} aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
            <Button size="lg" className="mt-8 bg-white text-ink shadow-none hover:bg-marker-soft" asChild>
              <Link href="/app">Prepare my files</Link>
            </Button>
          </div>
        </div>
      </Container>
    </section>
  );
}

/* --------------------------------------------------------------------------- */

export function FinalCta() {
  return (
    <section className="border-b border-rule-soft">
      <Container className="flex flex-col items-start justify-between gap-8 py-16 md:flex-row md:items-center md:py-20">
        <div>
          <h2 className="type-h2 max-w-[30rem]">Check your files before the portal does</h2>
          <p className="type-lead mt-3 max-w-[32rem]">Start with the instructions you already have open in another tab.</p>
        </div>
        <Button size="lg" asChild>
          <Link href="/app">Prepare my files</Link>
        </Button>
      </Container>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer>
      <Container className="flex flex-col gap-6 py-10 text-sm text-ink-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
          <Wordmark />
          <span>Files for applications, prepared in your browser.</span>
        </div>
        <nav aria-label="Footer" className="flex gap-5">
          <Link href="/app" className="hover:text-ink">
            Open the app
          </Link>
          <Link href="/privacy" className="hover:text-ink">
            Privacy
          </Link>
          <Link href="/#faq" className="hover:text-ink">
            FAQ
          </Link>
        </nav>
      </Container>
    </footer>
  );
}
