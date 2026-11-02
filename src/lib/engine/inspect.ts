/**
 * First look at an added file: identify it, make a thumbnail and measure the
 * traits used to match it to a requirement.
 */
import { classifyTraits, contentTraits } from "./image/analysis";
import { analysisPixels, canvasToObjectUrl, decodeImage, fitWithin, resize } from "./image/canvas";
import { isImageFormat, sniffFormat } from "./magic";
import { inspectPdf } from "./pdf/assemble";
import { closePdf, openPdf, renderPage } from "./pdf/pdfjs";
import type { InputFile } from "./pipeline";

let counter = 0;
export function fileId(): string {
  counter = (counter + 1) % 1_000_000;
  return `f_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function inspectFile(file: File | Blob, name: string, id = fileId()): Promise<InputFile> {
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  const format = sniffFormat(head, name);
  const base: InputFile = { id, name, size: file.size, format, blob: file, addedAt: Date.now() };

  if (isImageFormat(format)) {
    try {
      const bmp = await decodeImage(file, format);
      const [tw, th] = fitWithin(bmp.width, bmp.height, 360);
      const thumb = resize(bmp, tw, th);
      const traits = classifyTraits(contentTraits(analysisPixels(bmp, 128)));
      const result: InputFile = { ...base, width: bmp.width, height: bmp.height, traits, thumbUrl: await canvasToObjectUrl(thumb, 360) };
      bmp.close();
      return result;
    } catch {
      return base;
    }
  }

  if (format === "pdf") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const info = await inspectPdf(bytes);
    const result: InputFile = { ...base, pages: info.pages, encrypted: info.encrypted, needsPassword: info.needsPassword, traits: { portrait: 0, signature: 0, page: 0.85 } };
    if (!info.needsPassword) {
      try {
        const doc = await openPdf(bytes);
        const page = await renderPage(doc, 1, 48);
        result.thumbUrl = await canvasToObjectUrl(page.canvas, 360);
        await closePdf(doc);
      } catch {
        /* thumbnail is optional */
      }
    }
    return result;
  }

  return base;
}
