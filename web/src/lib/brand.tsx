/** Change the product name here; every page, the logo wordmark and the tab title follow it. */
export const BRAND = {
  name: "SLAB",
  tagline: "Big blocks. Zero chart noise.",
  description: "Private OTC block trades on Robinhood Chain",
};

/** Logo mark: three offset slabs on a dark tile. Neon green is the brand accent. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <rect width="32" height="32" rx="8" fill="#0b0d10" />
      <rect x="6" y="20" width="20" height="5" rx="1.5" fill="#8cff61" />
      <rect x="8.5" y="13.5" width="17" height="5" rx="1.5" fill="#8cff61" opacity="0.7" />
      <rect x="11" y="7" width="14" height="5" rx="1.5" fill="#8cff61" opacity="0.4" />
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
