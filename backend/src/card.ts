/**
 * Share card for a settled deal: a 1200x630 PNG for link previews and posts, drawn from the public
 * receipt (the settlement transaction) and the "vs DEX" snapshot. No private data: everything on it is
 * already public on-chain once the deal settles.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import type { VsDex } from "./vsdex.ts";

const asset = (p: string) => new URL(`../assets/${p}`, import.meta.url);
const FONTS = ["fonts/Geist-Regular.ttf", "fonts/Geist-Medium.ttf", "fonts/Geist-Bold.ttf", "fonts/GeistMono-Medium.ttf"].map((f) => fileURLToPath(asset(f)));
let logo: string | null = null;
const logoUri = () => (logo ??= "data:image/png;base64," + readFileSync(asset("obsyn-logo-400.png")).toString("base64"));

export interface CardData {
  tokenSymbol: string;
  amount: number;
  paySymbol: string;
  paid: number;
  fee: { amount: number; symbol: string; burned: boolean };
  vs: VsDex | null;
  timestamp: number;
  txHash: string;
  block: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 1234567.8 → "1.23M", 0.25 → "0.25", 45 → "45" */
export function fmtNum(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2).replace(/\.?0+$/, "") + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (a >= 1e4) return Math.round(n).toLocaleString("en-US");
  if (a >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (a === 0) return "0";
  return n.toPrecision(3).replace(/\.?0+$/, "");
}
export const fmtUsd = (n: number) => (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: Math.abs(n) < 1000 ? 2 : 0, maximumFractionDigits: Math.abs(n) < 1000 ? 2 : 0 });
const signedUsd = (n: number) => (n > 0 ? "+" : "") + fmtUsd(n);

function stat(x: number, label: string, value: string, sub: string, accent: boolean) {
  return `<g transform="translate(${x} 392)">
    <rect width="336" height="132" rx="18" fill="#15120f" stroke="#2e2822"/>
    <text x="24" y="40" font-family="Geist Mono" font-weight="500" font-size="15" letter-spacing="2" fill="#9a9084">${esc(label)}</text>
    <text x="24" y="86" font-family="Geist" font-weight="700" font-size="36" fill="${accent ? "#ff6a2b" : "#ece4d8"}">${esc(value)}</text>
    <text x="24" y="114" font-family="Geist" font-weight="400" font-size="17" fill="#9a9084">${esc(sub)}</text>
  </g>`;
}

export function cardSvg(d: CardData): string {
  const date = new Date(d.timestamp * 1000).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const headline = `${fmtNum(d.amount)} ${d.tokenSymbol}`;
  const size = headline.length > 14 ? 76 : 96;
  const v = d.vs;
  const buyer =
    v && v.buyerSavedUsd !== null
      ? stat(64, "BUYER VS DEX", signedUsd(v.buyerSavedUsd), `vs a DEX market buy (${v.buyImpactPct! < 0.01 ? "<0.01" : "~" + v.buyImpactPct}% impact)`, v.buyerSavedUsd > 0)
      : stat(64, "PRICE", "One price", v?.thin ? "DEX pool too thin for this size" : "no slippage, sealed quote", false);
  const seller =
    v && v.sellerGainedUsd !== null
      ? stat(432, "SELLER VS DEX", signedUsd(v.sellerGainedUsd), "vs a DEX market sell", v.sellerGainedUsd > 0)
      : stat(432, "SETTLEMENT", "1 transaction", "both sides swapped at once", false);
  const fee = stat(
    800,
    d.fee.burned ? "FEE BURNED" : "FEE TO BUY-AND-BURN",
    `${fmtNum(d.fee.amount)} ${d.fee.symbol}`,
    d.fee.burned ? "sent to 0x…dEaD at settlement" : "buys $OBSYN and burns it",
    d.fee.burned,
  );
  const dealUsd = v ? ` · ${fmtUsd(v.dealUsd)}` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="0.85" cy="0.1" r="0.8">
      <stop offset="0" stop-color="#ff6a2b" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#0c0b0a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#0c0b0a"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <image x="64" y="52" width="44" height="44" xlink:href="${logoUri()}"/>
  <text x="120" y="85" font-family="Geist" font-weight="700" font-size="32" fill="#ece4d8">obsyn</text>
  <rect x="852" y="52" width="284" height="44" rx="22" fill="#0f1a12" stroke="#2f5a3a"/>
  <circle cx="878" cy="74" r="6" fill="#7ad38a"/>
  <text x="896" y="80" font-family="Geist Mono" font-weight="500" font-size="16" letter-spacing="2.5" fill="#7ad38a">SETTLED PRIVATELY</text>
  <text x="64" y="176" font-family="Geist Mono" font-weight="500" font-size="18" letter-spacing="3" fill="#9a9084">OTC BLOCK · ROBINHOOD CHAIN</text>
  <text x="60" y="${176 + size}" font-family="Geist" font-weight="700" font-size="${size}" fill="#ece4d8">${esc(headline)}</text>
  <text x="64" y="${226 + size}" font-family="Geist" font-weight="500" font-size="30" fill="#c9bfb2">for ${esc(fmtNum(d.paid))} ${esc(d.paySymbol)}${esc(dealUsd)}</text>
  ${buyer}
  ${seller}
  ${fee}
  <text x="64" y="584" font-family="Geist Mono" font-weight="500" font-size="17" fill="#6f665c">${esc(date)} · block ${esc(d.block)} · tx ${esc(d.txHash.slice(0, 10))}…</text>
  <text x="1136" y="584" text-anchor="end" font-family="Geist Mono" font-weight="500" font-size="17" fill="#ff6a2b">obsyn.trade</text>
</svg>`;
}

/** An open block, for its share link: side, size, token, pay token, answers, time left. Never a price. */
export interface BlockCardData {
  side: "buy" | "sell";
  /** "~$5,000 of NVDA" or "1,000 TSLA" */
  size: string;
  paySymbol: string;
  answers: number;
  secondsLeft: number;
  open: boolean;
  id: string;
}

export function blockCardSvg(d: BlockCardData): string {
  const left = d.secondsLeft <= 0 || !d.open ? "closed" : d.secondsLeft >= 3600 ? `${Math.floor(d.secondsLeft / 3600)}h ${Math.floor((d.secondsLeft % 3600) / 60)}m` : `${Math.max(1, Math.floor(d.secondsLeft / 60))}m`;
  const size = d.size.length > 16 ? 72 : 92;
  const noun = d.side === "buy" ? "offers" : "bids";
  const pill = d.open && d.secondsLeft > 0 ? "OPEN · SEALED" : "CLOSED";
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="0.85" cy="0.1" r="0.8">
      <stop offset="0" stop-color="#ff6a2b" stop-opacity="0.2"/>
      <stop offset="1" stop-color="#0c0b0a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#0c0b0a"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <image x="64" y="52" width="44" height="44" xlink:href="${logoUri()}"/>
  <text x="120" y="85" font-family="Geist" font-weight="700" font-size="32" fill="#ece4d8">obsyn</text>
  <rect x="884" y="52" width="252" height="44" rx="22" fill="#1d150d" stroke="#5a4426"/>
  <circle cx="910" cy="74" r="6" fill="#f0c48e"/>
  <text x="928" y="80" font-family="Geist Mono" font-weight="500" font-size="16" letter-spacing="2.5" fill="#f0c48e">${pill}</text>
  <text x="64" y="176" font-family="Geist Mono" font-weight="500" font-size="18" letter-spacing="3" fill="#9a9084">${d.side === "buy" ? "BUYING" : "SELLING"} · OTC BLOCK · ROBINHOOD CHAIN</text>
  <text x="60" y="${176 + size}" font-family="Geist" font-weight="700" font-size="${size}" fill="#ece4d8">${esc(d.size)}</text>
  <text x="64" y="${226 + size}" font-family="Geist" font-weight="500" font-size="30" fill="#c9bfb2">paid in ${esc(d.paySymbol)} · sealed ${noun} only</text>
  ${stat(64, "PRICE", "Sealed", `only the poster reads the ${noun}`, false)}
  ${stat(432, d.side === "buy" ? "OFFERS IN" : "BIDS IN", String(d.answers), "encrypted to the poster", false)}
  ${stat(800, "TIME LEFT", left, "to answer this block", d.open && d.secondsLeft > 0)}
  <text x="64" y="584" font-family="Geist Mono" font-weight="500" font-size="17" fill="#6f665c">one price · settled in one transaction · escrow with no admin key</text>
  <text x="1136" y="584" text-anchor="end" font-family="Geist Mono" font-weight="500" font-size="17" fill="#ff6a2b">obsyn.trade</text>
</svg>`;
}

export function renderBlockCard(d: BlockCardData): Buffer {
  return renderSvg(blockCardSvg(d));
}

function renderSvg(svg: string): Buffer {
  const r = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: "Geist" },
  });
  return Buffer.from(r.render().asPng());
}

export function renderCard(d: CardData): Buffer {
  const r = new Resvg(cardSvg(d), {
    fitTo: { mode: "width", value: 1200 },
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: "Geist" },
  });
  return Buffer.from(r.render().asPng());
}
