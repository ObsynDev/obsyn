import { decodeEventLog, decodeFunctionData, getAddress, type Address, type Hex, type PublicClient } from "viem";
import { OtcEscrowAbi } from "./abi/OtcEscrow.ts";
import { dealId, termsToJson, type Terms } from "./terms.ts";

/**
 * A public receipt for a settled deal, rebuilt from the chain alone: the settlement transaction's input
 * carries the full deal terms, and its Settled event carries the fee split. Nothing comes from our database.
 */
export interface DealReceipt {
  txHash: Hex;
  dealId: Hex;
  block: string;
  timestamp: number;
  /** which deposit completed the deal */
  settledBy: "depositPayment" | "depositTokens" | "depositTokensFor";
  terms: ReturnType<typeof termsToJson>;
  protocolFee: string;
  referrerFee: string;
  relayerFee: string;
  sellerProceeds: string;
}

type TxLike = { to: Address | null; input: Hex };
type ReceiptLike = { status: "success" | "reverted"; blockNumber: bigint; logs: { address: Address; data: Hex; topics: Hex[] }[] };

/** Pure part, so it can be tested without a chain. Throws when the tx isn't an Obsyn settlement. */
export function parseReceipt(opts: { escrow: Address; txHash: Hex; tx: TxLike; receipt: ReceiptLike; timestamp: number }): DealReceipt {
  const { escrow, txHash, tx, receipt, timestamp } = opts;
  if (receipt.status !== "success") throw new Error("this transaction failed");
  if (!tx.to || getAddress(tx.to) !== getAddress(escrow)) throw new Error("not a transaction to the Obsyn escrow");

  type Settled = { dealId: Hex; protocolFee: bigint; referrerFee: bigint; relayerFee: bigint; sellerProceeds: bigint };
  let settled = null as Settled | null;
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== getAddress(escrow)) continue;
    try {
      const ev = decodeEventLog({ abi: OtcEscrowAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "Settled") settled = ev.args as unknown as Settled;
    } catch {
      /* other events */
    }
  }
  if (!settled) throw new Error("this transaction didn't settle a deal");

  const call = decodeFunctionData({ abi: OtcEscrowAbi, data: tx.input });
  if (call.functionName !== "depositPayment" && call.functionName !== "depositTokens" && call.functionName !== "depositTokensFor")
    throw new Error("unexpected escrow call");
  const terms = (call.args as readonly unknown[])[0] as Terms;
  if (dealId(terms) !== settled.dealId) throw new Error("deal terms don't match the settlement event");

  return {
    txHash,
    dealId: settled.dealId,
    block: receipt.blockNumber.toString(),
    timestamp,
    settledBy: call.functionName,
    terms: termsToJson(terms),
    protocolFee: settled.protocolFee.toString(),
    referrerFee: settled.referrerFee.toString(),
    relayerFee: settled.relayerFee.toString(),
    sellerProceeds: settled.sellerProceeds.toString(),
  };
}

export async function readReceipt(client: PublicClient, escrow: Address, txHash: Hex): Promise<DealReceipt> {
  const [tx, receipt] = await Promise.all([client.getTransaction({ hash: txHash }), client.getTransactionReceipt({ hash: txHash })]);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  return parseReceipt({ escrow, txHash, tx, receipt, timestamp: Number(block.timestamp) });
}
