import { z } from "zod";
import { paymentsEnabled } from "@/lib/server/config";
import { stripeClient } from "@/lib/server/stripe";
import { signUnlock } from "@/lib/server/unlock-token";

export const runtime = "nodejs";

const bodySchema = z.object({ sessionId: z.string().regex(/^cs_[A-Za-z0-9_]+$/) });

/** Confirms a Checkout Session was paid and returns a signed unlock receipt for its packet. */
export async function POST(req: Request) {
  if (!paymentsEnabled()) return Response.json({ error: "Payments are not configured." }, { status: 404 });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Invalid session" }, { status: 400 });
  }
  try {
    const stripe = stripeClient();
    const session = await stripe.checkout.sessions.retrieve(body.sessionId);
    const packetId = session.metadata?.packetId ?? session.client_reference_id;
    if (!packetId) return Response.json({ error: "This payment isn't linked to a packet." }, { status: 400 });
    if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
      return Response.json({ paid: false, packetId }, { status: 402 });
    }
    return Response.json({ paid: true, packetId, token: signUnlock(packetId) });
  } catch (err) {
    console.error("[checkout/verify] failed", err);
    return Response.json({ error: "Could not confirm the payment. Refresh the page to try again." }, { status: 502 });
  }
}
