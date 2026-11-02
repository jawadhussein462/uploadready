import type { Metadata, Viewport } from "next";
import "@fontsource-variable/archivo/wdth.css";
import "./globals.css";
import { Toaster } from "sonner";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "UploadReady — make every file fit the upload rules",
    template: "%s — UploadReady",
  },
  description:
    "Paste an application's upload rules, add your photos and documents, and download files that are converted, resized, compressed, renamed and checked against every rule. Files stay on your device.",
  openGraph: {
    title: "UploadReady — make every file fit the upload rules",
    description: "Files for job, university, housing and visa applications, prepared to pass the portal's rules on the first upload.",
    type: "website",
    siteName: "UploadReady",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        {children}
        <Toaster
          position="bottom-center"
          toastOptions={{
            classNames: {
              toast: "!rounded-[10px] !border-rule !bg-paper !text-ink !shadow-[var(--shadow-pop)] !font-sans",
              description: "!text-ink-2",
            },
          }}
        />
      </body>
    </html>
  );
}
