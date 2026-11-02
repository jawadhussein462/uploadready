import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#under-the-hood", label: "Under the hood" },
  { href: "/#privacy", label: "Privacy" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-rule-soft bg-paper/85 backdrop-blur-md supports-[backdrop-filter]:bg-paper/75">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-6 px-5 md:px-8">
        <Wordmark />
        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="rounded-[8px] px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-sheet hover:text-ink">
              {item.label}
            </Link>
          ))}
        </nav>
        <Button asChild size="sm" className="h-9 px-4">
          <Link href="/app">Prepare my files</Link>
        </Button>
      </div>
    </header>
  );
}
