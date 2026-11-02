import { z } from "zod";
import { paymentsEnabled, serverConfig } from "@/lib/server/config";
import { stripeClient } from "@/lib/server/stripe";
import { clientKey, hit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const bodySchema = z.object({
  packetId: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/),
  title: z.string().max(120).default("Application packet"),
  fileCount: z.number().int().min(0).max(100).default(0),
});

function origin(req: Request): string {
  if (serverConfig.appUrl) return serverConfig.appUrl;
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

export async function POST(req: Request) {
  if (!paymentsEnabled()) return Response.json({ error: "Payments are not configured on this server." }, { status: 404 });
  if (!hit(`checkout:${clientKey(req)}`, 30).ok) return Response.json({ error: "Too many requests." }, { status: 429 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const stripe = stripeClient();
  const base = origin(req);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: body.packetId,
      metadata: { packetId: body.packetId },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: serverConfig.currency,
            unit_amount: serverConfig.priceCents,
            product_data: {
              name: "UploadReady application packet",
              description: `${body.title.slice(0, 80)}${body.fileCount ? ` — ${body.fileCount} file${body.fileCount === 1 ? "" : "s"}` : ""}, checked against the application's rules`,
            },
          },
        },
      ],
      allow_promotion_codes: true,
      success_url: `${base}/app?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/app?checkout=cancelled`,
    });
    if (!session.url) throw new Error("Stripe returned no checkout URL");
    return Response.json({ url: session.url });
  } catch (err) {
    console.error("[checkout] failed", err);
    return Response.json({ error: "Could not start the payment. Try again." }, { status: 502 });
  }
}
