/**
 * Obsyn SDK.
 *
 *   import { Obsyn } from "./sdk/index.ts";
 *   const otc = new Obsyn({ apiUrl: "https://…", privateKey: "0x…" });
 *   const bid = await otc.createBid({ token, amount: "25000", payWith: "USDG", replyMinutes: 60 });
 *
 * Sealed offers are encrypted and decrypted inside this client; the server only stores ciphertext.
 * Without a privateKey, deposit() and refund() return unsigned transactions.
 * Works in Node and browsers. For persistence in Node use FileStore from "./file-store.ts".
 */
// BlockOtc / BlockOtcOptions are kept as deprecated aliases for older integrations.
export { OtcAgent as Obsyn, OtcAgent as BlockOtc, MemoryStore, answerMessage } from "./client.ts";
export type { AgentOptions as ObsynOptions, AgentOptions as BlockOtcOptions, BuyerBid, Offer, State, StateStore, UnsignedTx } from "./client.ts";
export { dealId, termsFromJson, termsToJson, type Terms } from "../terms.ts";
