import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { unlockSecret } from "./config";

/**
 * Signed receipt proving that a packet was paid for:
 *   <packetId>.<expiry>.<HMAC-SHA256(packetId.expiry)>
 */
const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function signUnlock(packetId: string, ttlSeconds = 60 * 60 * 24 * 30): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${packetId}.${exp}`;
  const sig = b64url(createHmac("sha256", unlockSecret()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyUnlock(token: string, packetId: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [id, expRaw, sig] = parts;
  if (id !== packetId) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const expected = b64url(createHmac("sha256", unlockSecret()).update(`${id}.${expRaw}`).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
