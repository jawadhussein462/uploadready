"use client";

/**
 * Generates realistic stand-in files for a packet so the whole flow can be
 * tried without personal documents: an oversized portrait JPEG, a photographed
 * signature, an ID-card scan and PDFs (one of them a heavy scanned page).
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { DocumentRequirement, PacketSpec } from "@/lib/engine/types";

type Sample = { blob: Blob; name: string };

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext("2d")! };
}

function toBlob(c: HTMLCanvasElement, type: string, q?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), type, q));
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, seed = 7) {
  const img = ctx.getImageData(0, 0, w, h);
  let s = seed;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 16807) % 2147483647;
    const n = ((s / 2147483647) - 0.5) * amount;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

async function portrait(): Promise<Blob> {
  const W = 2400;
  const H = 3200;
  const { c, ctx } = canvas(W, H);
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#e9edf2");
  bg.addColorStop(1, "#d9dfe7");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const cx = W * 0.56;
  const cy = H * 0.4;
  // shoulders
  ctx.fillStyle = "#2f3b52";
  ctx.beginPath();
  ctx.ellipse(cx, H * 0.98, W * 0.42, H * 0.3, 0, Math.PI, 0);
  ctx.fill();
  // neck
  ctx.fillStyle = "#d39d7c";
  ctx.fillRect(cx - 130, cy + 300, 260, 420);
  // hair back
  ctx.fillStyle = "#3a2a20";
  ctx.beginPath();
  ctx.ellipse(cx, cy - 60, 400, 470, 0, 0, Math.PI * 2);
  ctx.fill();
  // face
  const face = ctx.createRadialGradient(cx - 80, cy - 60, 40, cx, cy, 420);
  face.addColorStop(0, "#e7b694");
  face.addColorStop(1, "#cf9a78");
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 40, 320, 420, 0, 0, Math.PI * 2);
  ctx.fill();
  // fringe
  ctx.fillStyle = "#3a2a20";
  ctx.beginPath();
  ctx.ellipse(cx, cy - 300, 340, 170, 0, Math.PI, 0);
  ctx.fill();
  // eyes, brows, mouth
  ctx.fillStyle = "#2b2420";
  for (const dx of [-120, 120]) {
    ctx.beginPath();
    ctx.ellipse(cx + dx, cy - 10, 34, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx + dx - 70, cy - 90, 140, 18);
  }
  ctx.strokeStyle = "#a45f52";
  ctx.lineWidth = 16;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy + 170, 90, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  noise(ctx, W, H, 18);
  return toBlob(c, "image/jpeg", 0.95);
}

async function signature(): Promise<Blob> {
  const W = 2000;
  const H = 1200;
  const { c, ctx } = canvas(W, H);
  const paper = ctx.createLinearGradient(0, 0, W, H);
  paper.addColorStop(0, "#f3eee4");
  paper.addColorStop(1, "#d8d1c4");
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#1d3a9b";
  ctx.lineWidth = 11;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(560, 700);
  ctx.bezierCurveTo(640, 420, 720, 380, 760, 520);
  ctx.bezierCurveTo(800, 700, 700, 760, 760, 640);
  ctx.bezierCurveTo(840, 480, 900, 520, 920, 650);
  ctx.bezierCurveTo(950, 760, 1000, 560, 1060, 600);
  ctx.bezierCurveTo(1120, 640, 1100, 720, 1180, 640);
  ctx.bezierCurveTo(1260, 560, 1300, 700, 1400, 610);
  ctx.moveTo(620, 760);
  ctx.bezierCurveTo(900, 720, 1200, 740, 1460, 700);
  ctx.stroke();
  noise(ctx, W, H, 10, 11);
  return toBlob(c, "image/png");
}

async function idCard(): Promise<Blob> {
  const W = 1700;
  const H = 1100;
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = "#5b5f66";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#eef3f7";
  ctx.beginPath();
  ctx.roundRect(70, 60, W - 140, H - 120, 40);
  ctx.fill();
  ctx.fillStyle = "#3a6ea5";
  ctx.fillRect(70, 100, W - 140, 90);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 52px sans-serif";
  ctx.fillText("SAMPLE IDENTITY CARD", 120, 162);
  ctx.fillStyle = "#c9b8a8";
  ctx.fillRect(130, 250, 380, 480);
  ctx.fillStyle = "#9aa8c4";
  ctx.beginPath();
  ctx.arc(320, 430, 110, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(170, 580, 300, 150);
  ctx.fillStyle = "#38404d";
  ctx.font = "40px sans-serif";
  const rows = ["Surname  SAMPLE", "Given names  ALEX", "Date of birth  01.01.2000", "Document no.  X0000000", "Expiry  01.01.2035"];
  rows.forEach((t, i) => ctx.fillText(t, 580, 300 + i * 90));
  ctx.font = "44px monospace";
  ctx.fillText("IDXSAMPLE<<ALEX<<<<<<<<<<<<<<<<<<<<", 130, 900);
  noise(ctx, W, H, 14, 5);
  return toBlob(c, "image/jpeg", 0.95);
}

const WIN_ANSI = (s: string) => s.replace(/[^\x20-\x7e -ÿ–—‘’“”…]/g, "");

async function scannedPage(label: string): Promise<Uint8Array> {
  const W = 2480;
  const H = 3508;
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = "#f7f5ef";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#222";
  ctx.font = "bold 90px serif";
  ctx.fillText(WIN_ANSI(label), 220, 360);
  ctx.font = "54px serif";
  for (let i = 0; i < 34; i++) {
    const y = 560 + i * 82;
    ctx.fillRect(220, y, 900 + ((i * 397) % 1100), 26);
  }
  noise(ctx, W, H, 26, 3);
  const blob = await toBlob(c, "image/jpeg", 0.96);
  const pdf = await PDFDocument.create();
  const img = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()));
  const page = pdf.addPage([595.28, 841.89]);
  page.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  return pdf.save();
}

async function textPdf(label: string, pages: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let p = 0; p < pages; p++) {
    const page = pdf.addPage([595.28, 841.89]);
    page.drawText(WIN_ANSI(label), { x: 56, y: 770, size: 22, font: bold, color: rgb(0.06, 0.12, 0.29) });
    page.drawText(`Sample document for trying UploadReady — page ${p + 1} of ${pages}`, { x: 56, y: 744, size: 10, font, color: rgb(0.4, 0.45, 0.55) });
    for (let i = 0; i < 38; i++) {
      const width = 300 + ((i * 131 + p * 57) % 180);
      page.drawRectangle({ x: 56, y: 700 - i * 17, width, height: 6, color: rgb(0.82, 0.85, 0.9) });
    }
  }
  return pdf.save();
}

const pdfBlob = (bytes: Uint8Array) => new Blob([bytes as BlobPart], { type: "application/pdf" });

async function samplesFor(req: DocumentRequirement, index: number): Promise<Sample[]> {
  const base = req.label.replace(/[\\/:*?"<>|]+/g, " ").trim() || `Document ${index + 1}`;
  if (req.kind === "photo") return [{ blob: await portrait(), name: `IMG_${2041 + index}.JPG` }];
  if (req.kind === "signature") return [{ blob: await signature(), name: "signature photo.png" }];
  if (req.kind === "id-document") {
    if (req.combine === "merge") {
      const card = await idCard();
      return [
        { blob: card, name: "ID front.jpg" },
        { blob: card, name: "ID back.jpg" },
      ];
    }
    return [{ blob: await idCard(), name: "passport scan.jpg" }];
  }
  const pageLimit = Math.max(1, Math.min(req.maxPages ?? 2, 2));
  if (req.combine === "merge") {
    return [
      { blob: pdfBlob(await scannedPage(`${base} (1)`)), name: `${base} scan 1.pdf` },
      { blob: pdfBlob(await scannedPage(`${base} (2)`)), name: `${base} scan 2.pdf` },
    ];
  }
  return [{ blob: pdfBlob(await textPdf(base, pageLimit)), name: `${base} final (2).pdf` }];
}

export async function makeSampleFiles(spec: PacketSpec): Promise<Sample[]> {
  const out: Sample[] = [];
  let i = 0;
  for (const req of spec.documents) {
    if (!req.required && req.kind !== "photo") continue;
    out.push(...(await samplesFor(req, i++)));
  }
  return out;
}
