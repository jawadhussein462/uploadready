import type { Metadata } from "next";
import { Suspense } from "react";
import { Workspace } from "@/components/workspace/workspace";

export const metadata: Metadata = {
  title: "Prepare your files",
  robots: { index: false },
};

export default function AppPage() {
  return (
    <Suspense>
      <Workspace />
    </Suspense>
  );
}
