import { useId } from "react";
/** Change the product name here; every page, the logo wordmark and the tab title follow it. */
export const BRAND = {
  name: "Obsyn",
  tagline: "Trade size. Stay private.",
  description: "Private OTC block trades and a privacy layer on Robinhood Chain",
  x: "https://x.com/Obsyntrade",
  xHandle: "@Obsyntrade",
  github: "https://github.com/ObsynDev/obsyn",
};

/** The GitHub mark. */
export function GitHubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

/** The X (Twitter) logo. */
export function XIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}

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
