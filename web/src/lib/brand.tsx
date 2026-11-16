import { useId } from "react";
/** Change the product name here; every page, the logo wordmark and the tab title follow it. */
export const BRAND = {
  name: "Obsyn",
  tagline: "Trade size. Stay private.",
  description: "Private OTC block trades and a privacy layer on Robinhood Chain",
};

/**
 * The platform token. Fill these in at launch and the site updates everywhere:
 *  - address: the token's contract address on Robinhood Chain (from Pons)
 *  - ponsUrl: its page on Pons
 *  - discountMin: the holding (whole tokens) set in BuyBurnVault.setPlatformToken
 */
export const PLATFORM_TOKEN = {
  symbol: "OBSYN",
  address: null as `0x${string}` | null,
  ponsUrl: null as string | null,
  discountMin: null as string | null,
};

/**
 * Logo mark ("Tile"): an ember tile holding a slanted "o", cut on the diagonal with the two
 * halves slid apart along the cut. Flat, so it holds up from the 16px tab to a token image.
 */
const RING =
  "M24 6 H40 A18 18 0 0 1 58 24 V40 A18 18 0 0 1 40 58 H24 A18 18 0 0 1 6 40 V24 A18 18 0 0 1 24 6 Z M28.5 21 H35.5 A7.5 7.5 0 0 1 43 28.5 V35.5 A7.5 7.5 0 0 1 35.5 43 H28.5 A7.5 7.5 0 0 1 21 35.5 V28.5 A7.5 7.5 0 0 1 28.5 21 Z";

export function LogoMark({ size = 28 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="logo-mark">
      <defs>
        <clipPath id={`${id}a`}>
          <polygon points="-10,-10 60,-10 -10,60" />
        </clipPath>
        <clipPath id={`${id}b`}>
          <polygon points="74,4 74,74 4,74" />
        </clipPath>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="#ff6a2b" />
      <g transform="translate(32 32) skewX(-10) scale(0.66) translate(-32 -32)" fill="#0c0b0a">
        <g clipPath={`url(#${id}a)`} transform="translate(-2.4,2.4)">
          <path d={RING} fillRule="evenodd" />
        </g>
        <g clipPath={`url(#${id}b)`} transform="translate(2.4,-2.4)">
          <path d={RING} fillRule="evenodd" />
        </g>
      </g>
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <LogoMark />
      <span>{BRAND.name}</span>
    </span>
  );
}
