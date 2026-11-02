import type { Metadata } from "next";
import { SiteFooter } from "@/components/marketing/sections";
import { SiteHeader } from "@/components/marketing/site-header";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[44rem] px-5 py-16 md:py-20">
        <h1 className="type-h2">Privacy</h1>
        <p className="mt-2 text-sm text-ink-3">How UploadReady handles your files and data.</p>
        <div className="mt-10 space-y-8 text-ink-2">
          <section>
            <h2 className="type-h3">Your documents</h2>
            <p className="mt-2">
              Photos, scans and PDFs you add are read, converted, compressed and checked inside your browser. They are not uploaded to UploadReady’s servers. Images are
              re-encoded, which also removes hidden metadata such as the location where a photo was taken.
            </p>
          </section>
          <section>
            <h2 className="type-h3">Instructions you paste</h2>
            <p className="mt-2">
              To read the rules, the text or screenshot of the instructions is sent to UploadReady’s server. When AI reading is enabled it is forwarded to Anthropic’s API for
              processing. UploadReady does not store it.
            </p>
          </section>
          <section>
            <h2 className="type-h3">Saved work</h2>
            <p className="mt-2">
              Your current packet, including your files, is saved in this browser’s storage (IndexedDB) so a refresh or a payment redirect doesn’t lose your work. Use “Start a
              new packet” in the app to delete it, or clear your browser’s site data.
            </p>
          </section>
          <section>
            <h2 className="type-h3">Payments</h2>
            <p className="mt-2">
              Payments are processed by Stripe. UploadReady receives confirmation that a packet was paid for, not your card details.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
