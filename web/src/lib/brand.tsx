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

/** Logo mark: a faceted obsidian crystal on a dark tile; one facet catches the ember light. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <rect width="32" height="32" rx="8" fill="#0c0b0a" />
      <polygon points="8,10.5 16,5 16,16 8,21.5" fill="#3a332b" />
      <polygon points="16,5 24,10.5 24,21.5 16,16" fill="#ff6a2b" />
      <polygon points="8,21.5 16,16 24,21.5 16,27" fill="#9a3a10" />
      <path d="M16 5 L16 16" stroke="#ffc49c" strokeWidth="0.9" strokeLinecap="round" />
      <path d="M16 16 L24 21.5" stroke="#ffb08a" strokeWidth="0.6" opacity="0.7" />
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
