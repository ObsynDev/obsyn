/**
 * BlockOTC SDK.
 *
 *   import { BlockOtc } from "./sdk/index.ts";
 *   const otc = new BlockOtc({ apiUrl: "https://…", privateKey: "0x…" });
 *   const bid = await otc.createBid({ token, amount: "25000", payWith: "USDG", replyMinutes: 60 });
 *
 * Sealed offers are encrypted and decrypted inside this client; the server only stores ciphertext.
 * Without a privateKey, deposit() and refund() return unsigned transactions.
 * Works in Node and browsers. For persistence in Node use FileStore from "./file-store.ts".
 */
export { OtcAgent as BlockOtc, MemoryStore } from "./client.ts";
export type { AgentOptions as BlockOtcOptions, Offer, State, StateStore, UnsignedTx } from "./client.ts";
export { dealId, termsFromJson, termsToJson, type Terms } from "../terms.ts";
