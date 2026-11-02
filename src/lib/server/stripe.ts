import "server-only";
import Stripe from "stripe";
import { serverConfig } from "./config";

/**
 * Stripe client. STRIPE_API_BASE points the SDK at another host, such as
 * stripe-mock (http://localhost:12111) for local and CI testing.
 */
export function stripeClient(): Stripe {
  const base = process.env.STRIPE_API_BASE?.trim();
  if (base) {
    const url = new URL(base);
    const protocol = url.protocol === "http:" ? "http" : "https";
    return new Stripe(serverConfig.stripeKey, {
      host: url.hostname,
      port: url.port || (protocol === "http" ? 80 : 443),
      protocol,
      maxNetworkRetries: 1,
    });
  }
  return new Stripe(serverConfig.stripeKey, { maxNetworkRetries: 2, timeout: 20_000 });
}
