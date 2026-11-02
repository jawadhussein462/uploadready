"use client";

import type { PacketSpec } from "@/lib/engine/types";
import type { PublicConfig } from "@/lib/server/config";

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

let configPromise: Promise<PublicConfig> | null = null;
export function fetchConfig(): Promise<PublicConfig> {
  if (!configPromise) {
    configPromise = fetch("/api/config", { cache: "no-store" })
      .then((r) => json<PublicConfig>(r))
      .catch(() => ({
        ai: { enabled: false, model: null },
        payments: { enabled: false, priceCents: 0, currency: "eur", priceLabel: "" },
      }));
  }
  return configPromise;
}

export interface ParseResponse {
  spec: PacketSpec;
  engine: "ai" | "rules";
}

export async function readRequirements(input: { text?: string; image?: { mediaType: string; data: string } }): Promise<ParseResponse> {
  const res = await fetch("/api/requirements", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return json<ParseResponse>(res);
}

export async function startCheckout(packetId: string, title: string, fileCount: number): Promise<string> {
  const res = await fetch("/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ packetId, title, fileCount }),
  });
  const body = await json<{ url: string }>(res);
  return body.url;
}

export async function verifyCheckout(sessionId: string): Promise<{ paid: boolean; packetId: string; token?: string }> {
  const res = await fetch("/api/checkout/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (res.status === 402) return { paid: false, packetId: "" };
  return json(res);
}

export async function checkUnlock(packetId: string, token: string): Promise<boolean> {
  try {
    const res = await fetch("/api/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ packetId, token }),
    });
    const body = await json<{ valid: boolean }>(res);
    return body.valid;
  } catch {
    return false;
  }
}

/** Downscale a screenshot before sending it: smaller payload, same legibility. */
export async function prepareScreenshot(file: Blob): Promise<{ mediaType: "image/jpeg"; data: string; previewUrl: string }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
  return { mediaType: "image/jpeg", data: dataUrl.split(",")[1], previewUrl: dataUrl };
}
