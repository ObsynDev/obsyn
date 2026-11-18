/** Every page on the site, in one place: the header, the phone menu and the homepage all read this. */
export type NavItem = { to: string; label: string; hint: string };
export type NavGroup = { label: string; to?: string; hint?: string; items?: NavItem[] };

export const NAV: NavGroup[] = [
  {
    label: "Trade",
    items: [
      { to: "/app", label: "Terminal", hint: "Every open block, live: answer one in a click" },
      { to: "/otc", label: "OTC desk", hint: "Post a sealed bid or a sell listing" },
      { to: "/trade", label: "Trade any token", hint: "Paste a contract: price, balance, open blocks" },
      { to: "/mine", label: "My blocks", hint: "Your bids, offers and deals in this browser" },
      { to: "/slippage", label: "Slippage calculator", hint: "What your size costs on a DEX" },
    ],
  },
  { label: "Markets", to: "/markets", hint: "Stock tokens, ETFs and $OBSYN with live prices" },
  { label: "Refer & earn", to: "/refer", hint: "Earn half the fee on deals you bring" },
  { label: "Stats", to: "/stats", hint: "Volume, deals, fees and burns, from the chain" },
  {
    label: "Learn",
    items: [
      { to: "/how", label: "How it works", hint: "A block from post to settlement" },
      { to: "/security", label: "Security", hint: "Who controls what, live from the chain" },
      { to: "/docs", label: "Docs", hint: "Fees, contracts, privacy and every live feature" },
      { to: "/roadmap", label: "Roadmap", hint: "What's live and what's next" },
      { to: "/developers", label: "Developers", hint: "MCP server, SDK and API for agents" },
    ],
  },
];

/** Flat list, for the phone menu and the homepage directory. */
export const NAV_ITEMS: NavItem[] = NAV.flatMap((g) => (g.items ? g.items : [{ to: g.to!, label: g.label, hint: g.hint ?? "" }]));
