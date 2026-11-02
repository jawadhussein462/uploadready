import { z } from "zod";
import { AiError, extractWithClaude } from "@/lib/ai/extract";
import { parseRequirementsText } from "@/lib/engine/rules-parser";
import { aiEnabled, serverConfig } from "@/lib/server/config";
import { clientKey, hit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z
  .object({
    text: z.string().max(20_000).optional(),
    image: z
      .object({
        mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
        // ~3.75 MB of binary data once decoded; the client downsizes screenshots first.
        data: z.string().max(5_000_000),
      })
      .optional(),
    engine: z.enum(["auto", "rules"]).default("auto"),
  })
  .refine((b) => (b.text && b.text.trim().length > 0) || b.image, { message: "Paste the instructions or add a screenshot." });

export async function POST(req: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? (err.issues[0]?.message ?? "Invalid request") : "Invalid request";
    return Response.json({ error: message }, { status: 400 });
  }

  const useAi = aiEnabled() && body.engine !== "rules";

  if (!useAi) {
    if (!body.text?.trim()) {
      return Response.json(
        { error: "Reading screenshots needs the AI reader, which isn't set up on this server. Paste the instructions as text instead." },
        { status: 422 },
      );
    }
    return Response.json({ spec: parseRequirementsText(body.text), engine: "rules" });
  }

  const limit = hit(`ai:${clientKey(req)}`, serverConfig.rateLimitPer10Min);
  if (!limit.ok) {
    if (body.text?.trim()) {
      const spec = parseRequirementsText(body.text);
      spec.warnings.unshift("You've used the AI reader a lot in the last few minutes, so the built-in reader was used this time.");
      return Response.json({ spec, engine: "rules" });
    }
    return Response.json({ error: "Too many requests. Try again in a few minutes." }, { status: 429, headers: { "retry-after": String(limit.retryAfter) } });
  }

  try {
    const spec = await extractWithClaude({ text: body.text, image: body.image });
    return Response.json({ spec, engine: "ai" });
  } catch (err) {
    const reason = err instanceof AiError ? err.message : "The AI reader failed.";
    if (!(err instanceof AiError)) console.error("[requirements] unexpected AI error", err);
    if (body.text?.trim()) {
      const spec = parseRequirementsText(body.text);
      spec.warnings.unshift(`${reason} The built-in reader was used instead, so double-check the rules below.`);
      return Response.json({ spec, engine: "rules" });
    }
    return Response.json({ error: reason }, { status: err instanceof AiError ? err.status : 500 });
  }
}
