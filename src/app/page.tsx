import { Faq } from "@/components/marketing/faq";
import { Hero } from "@/components/marketing/hero";
import { FinalCta, HowItWorks, Ledger, Pricing, Privacy, Rejections, SiteFooter, UnderTheHood } from "@/components/marketing/sections";
import { SiteHeader } from "@/components/marketing/site-header";
import { publicConfig } from "@/lib/server/config";

export default function LandingPage() {
  const { payments } = publicConfig();
  return (
    <>
      <SiteHeader />
      <main>
        <Hero priceLabel={payments.priceLabel} />
        <Rejections />
        <HowItWorks />
        <Ledger />
        <UnderTheHood />
        <Privacy />
        <Pricing priceLabel={payments.priceLabel} />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
