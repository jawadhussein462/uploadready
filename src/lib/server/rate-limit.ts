import "server-only";

/**
 * Sliding-window limiter kept in memory. On serverless platforms each instance
 * has its own window, so this is a soft guard against abuse of the AI endpoint;
 * put a shared store (e.g. Upstash Redis) behind `hit` for a hard limit.
 */
const windows = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;

export function hit(key: string, limit: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const list = (windows.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= limit) {
    windows.set(key, list);
    return { ok: false, retryAfter: Math.ceil((WINDOW_MS - (now - list[0])) / 1000) };
  }
  list.push(now);
  windows.set(key, list);
  if (windows.size > 5000) {
    for (const [k, v] of windows) if (!v.length || now - v[v.length - 1] > WINDOW_MS) windows.delete(k);
  }
  return { ok: true, retryAfter: 0 };
}

export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
}
