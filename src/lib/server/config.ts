import "server-only";
import { createHash } from "node:crypto";

/**
 * All configuration comes from environment variables so keys never reach the
 * browser. Every integration is optional: without keys the app still works
 * (built-in rule reader, free downloads).
 */
export const serverConfig = {
  anthropicKey: process.env.ANTHROPIC_API_KEY?.trim() || "",
  anthropicModel: process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5",
  anthropicBaseUrl: (process.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com").replace(/\/$/, ""),
  stripeKey: process.env.STRIPE_SECRET_KEY?.trim() || "",
  priceCents: Number.parseInt(process.env.PACKET_PRICE_CENTS ?? "490", 10) || 490,
  currency: (process.env.PACKET_CURRENCY?.trim() || "eur").toLowerCase(),
  appUrl: process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") || "",
  rateLimitPer10Min: Number.parseInt(process.env.RATE_LIMIT_PER_10_MIN ?? "20", 10) || 20,
};

export const aiEnabled = () => serverConfig.anthropicKey.length > 0;
export const paymentsEnabled = () => serverConfig.stripeKey.length > 0;

/** Secret used to sign unlock receipts. Falls back to a value derived from the Stripe key. */
export function unlockSecret(): string {
  const explicit = process.env.UNLOCK_TOKEN_SECRET?.trim();
  if (explicit) return explicit;
  return createHash("sha256").update(`uploadready-unlock:${serverConfig.stripeKey || "dev"}`).digest("hex");
}

export function formatPrice(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function publicConfig() {
  return {
    ai: { enabled: aiEnabled(), model: aiEnabled() ? serverConfig.anthropicModel : null },
    payments: {
      enabled: paymentsEnabled(),
      priceCents: serverConfig.priceCents,
      currency: serverConfig.currency,
      priceLabel: formatPrice(serverConfig.priceCents, serverConfig.currency),
    },
  };
}

export type PublicConfig = ReturnType<typeof publicConfig>;
