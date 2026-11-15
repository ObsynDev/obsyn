import nacl from "tweetnacl";

export const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** URL-safe base64 for secrets that live in the link's #fragment (never sent to the server). */
export const toUrl = (u: Uint8Array) => b64(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const fromUrl = (s: string) => unb64(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));

export function newBoxKeys() {
  return nacl.box.keyPair();
}

export function keysFromSecret(secret: Uint8Array) {
  return nacl.box.keyPair.fromSecretKey(secret);
}

/** Encrypt an offer so only the holder of `theirPub` can read it. */
export function seal(payload: unknown, theirPub: Uint8Array) {
  const mine = nacl.box.keyPair(); // one-off key per offer: nothing links two offers to one seller
  const nonce = nacl.randomBytes(24);
  const box = nacl.box(new TextEncoder().encode(JSON.stringify(payload)), nonce, theirPub, mine.secretKey);
  return { sellerEncPubKey: b64(mine.publicKey), nonce: b64(nonce), ciphertext: b64(box) };
}

export function unseal<T>(q: { sellerEncPubKey: string; nonce: string; ciphertext: string }, mySecret: Uint8Array): T | null {
  const opened = nacl.box.open(unb64(q.ciphertext), unb64(q.nonce), unb64(q.sellerEncPubKey), mySecret);
  if (!opened) return null;
  try {
    return JSON.parse(new TextDecoder().decode(opened)) as T;
  } catch {
    return null;
  }
}

/** Secrets passed in the #fragment, e.g. #t=<manageToken>&k=<boxSecret>. */
export function hashParams(): URLSearchParams {
  return new URLSearchParams(window.location.hash.slice(1));
}

/** What a seller puts inside the sealed box. All amounts in base units. */
export interface Offer {
  amount: string;
  price: string;
  seller: string;
  sellerPayout: string;
  relayerFee: string;
  ghost: boolean;
  message?: string;
}
