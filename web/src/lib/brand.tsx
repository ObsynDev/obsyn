/** Change the product name here; every page, the logo wordmark and the tab title follow it. */
export const BRAND = {
  name: "SLAB",
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
  symbol: "SLAB",
  address: null as `0x${string}` | null,
  ponsUrl: null as string | null,
  discountMin: null as string | null,
};

/** Logo mark: three offset slabs on a dark tile. Neon green is the brand accent. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <rect width="32" height="32" rx="8" fill="#0b0d10" />
      <rect x="6" y="20" width="20" height="5" rx="1.5" fill="#ff6a2b" />
      <rect x="8.5" y="13.5" width="17" height="5" rx="1.5" fill="#ff6a2b" opacity="0.7" />
      <rect x="11" y="7" width="14" height="5" rx="1.5" fill="#ff6a2b" opacity="0.4" />
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
