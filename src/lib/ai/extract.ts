import "server-only";
import { serverConfig } from "../server/config";
import type { PacketSpec } from "../engine/types";
import { EXTRACTION_TOOL, SYSTEM_PROMPT, toPacketSpec } from "./schema";

export interface ExtractionInput {
  text?: string;
  image?: { mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string };
}

export class AiError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryable: boolean,
  ) {
    super(message);
  }
}

/** Ask Claude to fill in the extraction tool, then convert its answer deterministically. */
export async function extractWithClaude(input: ExtractionInput): Promise<PacketSpec> {
  const content: unknown[] = [];
  if (input.image) {
    content.push({ type: "image", source: { type: "base64", media_type: input.image.mediaType, data: input.image.data } });
    content.push({ type: "text", text: "The screenshot above shows the upload instructions." });
  }
  if (input.text?.trim()) {
    content.push({ type: "text", text: `<instructions>\n${input.text.trim()}\n</instructions>` });
  }
  content.push({ type: "text", text: "Record the upload requirements with the tool." });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);
  let res: Response;
  try {
    res = await fetch(`${serverConfig.anthropicBaseUrl}/v1/messages`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": serverConfig.anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: serverConfig.anthropicModel,
        max_tokens: 4096,
        temperature: 0,
        system: SYSTEM_PROMPT,
        tools: [EXTRACTION_TOOL],
        tool_choice: { type: "tool", name: EXTRACTION_TOOL.name },
        messages: [{ role: "user", content }],
      }),
    });
  } catch (err) {
    throw new AiError(controller.signal.aborted ? "The AI reader took too long." : "Could not reach the AI service.", 504, true);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? "";
    } catch {
      /* ignore */
    }
    if (res.status === 401 || res.status === 403) {
      console.error("[ai] Anthropic rejected the API key (HTTP %d). Check ANTHROPIC_API_KEY.", res.status);
      throw new AiError("AI reading isn’t available right now.", 502, false);
    }
    if (res.status === 429 || res.status === 529 || res.status >= 500) throw new AiError("The AI service is busy. Try again in a moment.", 503, true);
    console.error("[ai] Anthropic error %d: %s", res.status, detail);
    throw new AiError("AI reading failed for these instructions.", 502, false);
  }

  const body = (await res.json()) as { content?: { type: string; name?: string; input?: unknown }[]; model?: string };
  const call = body.content?.find((c) => c.type === "tool_use" && c.name === EXTRACTION_TOOL.name);
  if (!call?.input) throw new AiError("The AI reader returned no structured result.", 502, true);
  return toPacketSpec(call.input, body.model ?? serverConfig.anthropicModel);
}
