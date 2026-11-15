import { encodeAbiParameters, getAddress, keccak256, zeroAddress, type Address, type Hex } from "viem";
import { z } from "zod";

/** Mirrors OtcEscrow.Terms field-for-field. Order matters: dealId = keccak256(abi.encode(terms)). */
export interface Terms {
  buyer: Address;
  seller: Address;
  token: Address;
  amount: bigint;
  payToken: Address;
  price: bigint;
  sellerPayout: Address;
  referrer: Address;
  relayerFee: bigint;
  deadline: bigint;
  salt: Hex;
}

export const TERMS_ABI = [
  {
    type: "tuple",
    components: [
      { name: "buyer", type: "address" },
      { name: "seller", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "payToken", type: "address" },
      { name: "price", type: "uint256" },
      { name: "sellerPayout", type: "address" },
      { name: "referrer", type: "address" },
      { name: "relayerFee", type: "uint256" },
      { name: "deadline", type: "uint64" },
      { name: "salt", type: "bytes32" },
    ],
  },
] as const;

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "invalid address")
  .transform((s) => getAddress(s));
const uint = z
  .union([z.string().regex(/^\d+$/, "must be a base-10 integer string"), z.number().int().nonnegative()])
  .transform((v) => BigInt(v));
const bytes32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "invalid bytes32")
  .transform((s) => s.toLowerCase() as Hex);

export const TermsSchema = z.object({
  buyer: address,
  seller: address,
  token: address,
  amount: uint,
  payToken: address,
  price: uint,
  sellerPayout: address,
  referrer: address.default(zeroAddress),
  relayerFee: uint.default(0n),
  deadline: uint,
  salt: bytes32,
});

export function dealId(t: Terms): Hex {
  return keccak256(encodeAbiParameters(TERMS_ABI, [t]));
}

/** JSON-safe form (bigints as strings) for responses and storage. */
export function termsToJson(t: Terms): Record<string, string> {
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, String(v)]));
}

export function termsFromJson(raw: unknown): Terms {
  return TermsSchema.parse(raw);
}
