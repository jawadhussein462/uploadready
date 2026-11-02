"use client";

import { Accordion } from "radix-ui";
import { Plus } from "lucide-react";

const QUESTIONS = [
  {
    q: "Which applications does it work with?",
    a: "Any portal that tells you what to upload: job sites, university applications, rental dossiers, visa and government forms. If the rules are in an image or a PDF, add a screenshot instead of pasting text.",
  },
  {
    q: "Are my documents uploaded anywhere?",
    a: "No. Conversion, compression and checks run inside your browser. Only the instructions you paste or screenshot are sent, so the rules can be read. Your work is saved in this browser so you can come back later; “Start a new packet” deletes it.",
  },
  {
    q: "What can’t it fix?",
    a: "It can’t change what a document says, take a new photo or decide which pages you need. When a file can’t meet a rule, such as a 30-page PDF with a 10-page limit or a blurry photo, UploadReady says what to change before you try again.",
  },
  {
    q: "Is 240 KB 240,000 bytes or 245,760?",
    a: "Portals disagree, so UploadReady stays under the smaller number for maximums and above the larger one for minimums. The file passes either way.",
  },
  {
    q: "Can I correct the rules it found?",
    a: "Yes. Every limit can be edited, documents can be added or removed, and each rule shows the sentence it came from so you can check it against the portal.",
  },
  {
    q: "What exactly do I pay for?",
    a: "Reading the rules, preparing files and seeing every check is free. You pay once per application to download the finished files, and you can download them again after changing something in the same application.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="scroll-mt-20 border-b border-rule-soft">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <h2 className="type-h2">Questions applicants ask</h2>
        <Accordion.Root type="single" collapsible className="border-t border-rule">
          {QUESTIONS.map((item, i) => (
            <Accordion.Item key={item.q} value={`q${i}`} className="border-b border-rule">
              <Accordion.Header>
                <Accordion.Trigger className="group flex w-full items-center justify-between gap-6 py-5 text-left text-base font-semibold text-ink hover:text-pen">
                  {item.q}
                  <Plus className="size-4 shrink-0 text-ink-3 transition-transform duration-200 group-data-[state=open]:rotate-45" aria-hidden />
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content className="overflow-hidden data-[state=closed]:animate-[collapse_180ms_ease-out] data-[state=open]:animate-[expand_200ms_ease-out]">
                <p className="max-w-[40rem] pb-5 text-ink-2">{item.a}</p>
              </Accordion.Content>
            </Accordion.Item>
          ))}
        </Accordion.Root>
      </div>
    </section>
  );
}
