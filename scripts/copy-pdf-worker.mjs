// Copies the pdf.js worker into /public so the browser can load it from the same
// origin. Runs automatically after `npm install` (locally and on Vercel).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// The legacy build ships polyfills for newer JS APIs, so it works in older
// Safari/Chrome versions that applicants may still be using.
const candidates = [
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
];

const source = candidates.map((p) => join(root, p)).find((p) => existsSync(p));
if (!source) {
  console.warn("[copy-pdf-worker] pdfjs-dist worker not found; PDF previews will fail until it is installed.");
  process.exit(0);
}

const targetDir = join(root, "public");
mkdirSync(targetDir, { recursive: true });
copyFileSync(source, join(targetDir, "pdf.worker.min.mjs"));
console.log("[copy-pdf-worker] copied", source.replace(root + "/", ""), "-> public/pdf.worker.min.mjs");
