import { erc20Abi, getAddress, parseAbi, type Address, type PublicClient } from "viem";

/**
 * Reference prices read straight from Robinhood Chain. No third-party price API.
 *  - "v3":   a Uniswap v3 pool (Pons V1 launches trade in one of these).
 *  - "pons": a Pons V2 bonding curve before graduation.
 *            Interface from docs.ponsfamily.com/v2, NOT yet verified on-chain.
 */

const v3PoolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);

const ponsCurveAbi = parseAbi([
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)",
  "function pairToken() view returns (address)",
  "function isNativeQuote() view returns (bool)",
  "function graduated() view returns (bool)",
]);

export interface PriceQuote {
  token: Address;
  quote: Address | "ETH";
  /** price of 1 whole token in whole quote units */
  price: number;
  source: string;
  blockNumber: string;
}

export type PriceSource = { kind: "v3" | "pons"; address: Address };

export function parseSource(s: string): PriceSource {
  const m = /^(v3|pons):(0x[0-9a-fA-F]{40})$/.exec(s);
  if (!m) throw new Error("source must look like v3:0xPool or pons:0xCurve");
  return { kind: m[1] as "v3" | "pons", address: getAddress(m[2]) };
}

async function decimals(client: PublicClient, token: Address): Promise<number> {
  return client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" });
}

export async function readPrice(client: PublicClient, token: Address, src: PriceSource): Promise<PriceQuote> {
  const blockNumber = await client.getBlockNumber();
  token = getAddress(token);

  if (src.kind === "v3") {
    const [slot0, t0, t1] = await Promise.all([
      client.readContract({ address: src.address, abi: v3PoolAbi, functionName: "slot0", blockNumber }),
      client.readContract({ address: src.address, abi: v3PoolAbi, functionName: "token0", blockNumber }),
      client.readContract({ address: src.address, abi: v3PoolAbi, functionName: "token1", blockNumber }),
    ]);
    if (token !== t0 && token !== t1) throw new Error("token is not in this pool");
    const [d0, d1] = await Promise.all([decimals(client, t0), decimals(client, t1)]);
    // price of token0 in token1, adjusted for decimals
    const sqrt = Number(slot0[0]) / 2 ** 96;
    const p0in1 = sqrt * sqrt * 10 ** (d0 - d1);
    const isToken0 = token === t0;
    return {
      token,
      quote: isToken0 ? t1 : t0,
      price: isToken0 ? p0in1 : 1 / p0in1,
      source: `v3:${src.address}`,
      blockNumber: blockNumber.toString(),
    };
  }

  const [[quoteReserve, tokenReserve], native, pair, graduated] = await Promise.all([
    client.readContract({ address: src.address, abi: ponsCurveAbi, functionName: "getReserves", blockNumber }),
    client.readContract({ address: src.address, abi: ponsCurveAbi, functionName: "isNativeQuote", blockNumber }),
    client.readContract({ address: src.address, abi: ponsCurveAbi, functionName: "pairToken", blockNumber }),
    client.readContract({ address: src.address, abi: ponsCurveAbi, functionName: "graduated", blockNumber }),
  ]);
  if (graduated) throw new Error("curve has graduated; price it from its Uniswap pool instead");
  if (tokenReserve === 0n) throw new Error("curve has no token reserve");
  const [dt, dq] = await Promise.all([decimals(client, token), native ? Promise.resolve(18) : decimals(client, pair)]);
  // marginal constant-product price; Pons launch tokens are 18 decimals
  const price = (Number(quoteReserve) / 10 ** dq) / (Number(tokenReserve) / 10 ** dt);
  return { token, quote: native ? "ETH" : pair, price, source: `pons:${src.address}`, blockNumber: blockNumber.toString() };
}
