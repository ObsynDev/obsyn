import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Random id for public URLs. */
export const newId = () => randomBytes(12).toString("base64url");

/** Capability token: whoever holds it controls the RFQ / quote. Only its hash is stored. */
export const newToken = () => randomBytes(32).toString("base64url");

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export function tokenMatches(token: string | undefined, hash: string): boolean {
  if (!token) return false;
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Validates base64 of an exact byte length (nacl public key = 32, nonce = 24). */
export function isB64(s: string, bytes?: number): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return false;
  const len = Buffer.from(s, "base64").length;
  return bytes === undefined ? len > 0 : len === bytes;
}
