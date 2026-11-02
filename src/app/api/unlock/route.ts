import { z } from "zod";
import { paymentsEnabled } from "@/lib/server/config";
import { verifyUnlock } from "@/lib/server/unlock-token";

export const runtime = "nodejs";

const bodySchema = z.object({ packetId: z.string().max(64), token: z.string().max(256) });

/** Checks a stored unlock receipt. When payments are off, every packet is unlocked. */
export async function POST(req: Request) {
  if (!paymentsEnabled()) return Response.json({ valid: true, free: true });
  try {
    const { packetId, token } = bodySchema.parse(await req.json());
    return Response.json({ valid: verifyUnlock(token, packetId) });
  } catch {
    return Response.json({ valid: false }, { status: 400 });
  }
}
