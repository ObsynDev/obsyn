import { verifyTypedData, zeroAddress, type Address, type Hex } from "viem";
import { OtcEscrowAbi } from "./abi/OtcEscrow.ts";
import { clients } from "./chain.ts";
import type { Config } from "./config.ts";
import { dealId, type Terms } from "./terms.ts";

export interface Permit {
  deadline: bigint;
  v: number;
  r: Hex;
  s: Hex;
}

export const NO_PERMIT: Permit = { deadline: 0n, v: 0, r: `0x${"0".repeat(64)}`, s: `0x${"0".repeat(64)}` };

export class RelayError extends Error {
  status: 400 | 409 | 503;
  constructor(status: 400 | 409 | 503, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Relayer {
  info(): { enabled: boolean; address: Address | null; problem: string | null; minFee: { eth: string; usdg: string } };
  relayDeposit(terms: Terms, permit: Permit, sellerSig: Hex): Promise<{ txHash: Hex; dealId: Hex }>;
}

/** EIP-712 typed data the seller (ghost wallet) signs so this relayer may deposit for it. */
export function depositTypedData(cfg: Config, escrow: Address, id: Hex, relayer: Address) {
  return {
    domain: { name: "BlockOTC", version: "1", chainId: cfg.chainId, verifyingContract: escrow },
    types: { Deposit: [{ name: "dealId", type: "bytes32" }, { name: "relayer", type: "address" }] },
    primaryType: "Deposit",
    message: { dealId: id, relayer },
  } as const;
}

/**
 * Gasless "ghost" deposit relayer.
 * It only relays when the buyer has already funded the deal, so the relayed deposit
 * settles in the same transaction and the relayer is paid `relayerFee` right away.
 * Otherwise a buyer who never pays would leave the relayer eating the gas.
 */
export function createRelayer(cfg: Config): Relayer {
  const { publicClient, walletClient, relayerAddress } = clients(cfg);
  const enabled = Boolean(walletClient && relayerAddress && cfg.escrow);

  return {
    info: () => ({
      enabled,
      address: relayerAddress,
      problem: cfg.relayerKeyProblem ?? (cfg.relayerKey && !cfg.escrow ? "waiting for ESCROW_ADDRESS" : null),
      minFee: { eth: cfg.relayerMinFee.eth.toString(), usdg: cfg.relayerMinFee.usdg.toString() },
    }),

    async relayDeposit(terms, permit, sellerSig) {
      if (!enabled || !walletClient || !relayerAddress || !cfg.escrow) {
        throw new RelayError(503, "relayer is not configured");
      }
      const escrow = cfg.escrow;
      const id = dealId(terms);
      const now = BigInt(Math.floor(Date.now() / 1000));
      if (terms.deadline <= now + 30n) throw new RelayError(400, "deal deadline too close");

      const minFee = terms.payToken === zeroAddress ? cfg.relayerMinFee.eth : cfg.relayerMinFee.usdg;
      if (terms.relayerFee < minFee) throw new RelayError(400, `relayerFee below minimum ${minFee}`);

      const ok = await verifyTypedData({
        address: terms.seller,
        ...depositTypedData(cfg, escrow, id, relayerAddress),
        signature: sellerSig,
      });
      if (!ok) throw new RelayError(400, "seller signature does not authorize this relayer");

      const [status, buyerFunded, sellerFunded] = await publicClient.readContract({
        address: escrow,
        abi: OtcEscrowAbi,
        functionName: "deals",
        args: [id],
      });
      if (status > 1 || sellerFunded) throw new RelayError(409, "deal already settled, refunded or seller-funded");
      if (!buyerFunded) throw new RelayError(409, "buyer has not deposited yet; relay after the buyer funds the deal");

      // Simulate first: a revert costs nothing here.
      const { request } = await publicClient.simulateContract({
        account: walletClient.account!,
        address: escrow,
        abi: OtcEscrowAbi,
        functionName: "depositTokensFor",
        args: [terms, permit, sellerSig],
      });
      const txHash = await walletClient.writeContract(request);
      return { txHash, dealId: id };
    },
  };
}
