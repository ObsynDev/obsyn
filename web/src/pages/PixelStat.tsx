import type { Address } from "viem";
import { TokenAvatar } from "./Terminal.tsx";

/** Glint-style giant pixel numerals (5×7 font drawn as squares). */
const FONT: Record<string, string[]> = {
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "%": ["##....#", "##...#.", "....#..", "...#...", "..#....", ".#...##", "#....##"],
};

export function PixelText({ text, accentFrom = 1 }: { text: string; accentFrom?: number }) {
  const S = 22; // cell size
  const G = 3; // gap
  const glyphs = text.split("");
  const gw = (ch: string) => (FONT[ch] ?? FONT["0"])[0].length;
  const offs: number[] = [];
  let w = 0;
  glyphs.forEach((ch, gi) => {
    offs.push(w);
    w += gw(ch) * S + (gw(ch) - 1) * G + (gi < glyphs.length - 1 ? S : 0);
  });
  const h = 7 * S + 6 * G;
  return (
    <svg className="pixel-text" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={text}>
      {glyphs.map((ch, gi) => {
        const ox = offs[gi];
        const rows = FONT[ch] ?? FONT["0"];
        return rows.flatMap((row, y) =>
          row.split("").map((c, x) => (
            <rect
              key={`${gi}-${x}-${y}`}
              x={ox + x * (S + G)}
              y={y * (S + G)}
              width={S}
              height={S}
              className={c === "#" ? (gi >= accentFrom ? "px-on accent" : "px-on") : "px-off"}
            />
          )),
        );
      })}
    </svg>
  );
}

const CARDS = [
  { tag: "SELL LISTING", sym: "PONS", name: "Pons", size: "12.5M", n: 5, addr: "0x39dbed3a2bd333467115de45665cc57f813c4571", bars: [3, 4, 4, 5, 6, 6, 7, 8, 8, 9] },
  { tag: "BUY BID", sym: "TSLAx", name: "Tesla xStock", size: "250K", n: 3, addr: "0x7a3c5f10aa00000000000000000000000000c01d", bars: [4, 3, 5, 6, 5, 7, 8, 7, 9, 9] },
  { tag: "BUY BID", sym: "NVDAx", name: "Nvidia xStock", size: "~$480K", n: 7, addr: "0xc0ffee0000000000000000000000000000beef42", bars: [8, 8, 9, 8, 9, 9, 9, 8, 9, 9] },
];

/** "0%" slippage block: pixel numerals, two-tone headline, fanned example cards, feature pills. */
export function ZeroSlippage() {
  return (
    <section className="zs">
      <PixelText text="0%" />
      <h2 className="zs-h">
        Size moves at zero slippage. <span className="tone">Prices stay sealed.</span>
      </h2>
      <div className="fan">
        {CARDS.map((c, i) => (
          <article key={c.sym} className={`fan-card f${i}`}>
            <div className="fan-top mono">
              <span>{c.tag}</span>
              <span>EXAMPLE</span>
            </div>
            <div className="fan-title">
              <TokenAvatar address={c.addr as Address} symbol={c.sym} size={30} />
              <b>
                {c.size} {c.sym}
              </b>
            </div>
            <span className="mono dim small">{c.name}</span>
            <div className="fan-bars" aria-hidden="true">
              {c.bars.map((b, k) => (
                <i key={k} style={{ height: `${b * 9}%` }} />
              ))}
            </div>
            <div className="fan-foot mono">
              <span>{c.n} SEALED ANSWERS</span>
              <span className="mint">PRICE ••••••</span>
            </div>
          </article>
        ))}
      </div>
      <div className="feat-pills mono">
        <span>
          <i className="sq-violet" /> ZERO SLIPPAGE, ONE PRICE
        </span>
        <span>
          <i className="sq-mint" /> PRICES SEALED TO YOU
        </span>
        <span>
          <i className="sq-amber" /> 2.5% MAX FEE, IN CODE
        </span>
      </div>
    </section>
  );
}
