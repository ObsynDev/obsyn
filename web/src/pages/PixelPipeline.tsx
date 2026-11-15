import { useEffect, useState } from "react";
import { reducedMotion } from "../lib/motion.tsx";

/**
 * Glint-style "live simulation" of a block deal: dot-matrix icons in dotted frames,
 * one colour per stage, dotted connectors, and failure branches underneath.
 */

// 11×11 bitmaps: '#' = lit, '+' = half-lit, anything else = off
const ICONS: Record<string, string[]> = {
  post: [
    "...........",
    ".+++++++++#",
    "...........",
    ".+++++#....",
    "...........",
    ".++++++++#.",
    "...........",
    ".+++#......",
    "...........",
    ".++++++#...",
    "...........",
  ],
  seal: [
    "....###....",
    "...#...#...",
    "..#.....#..",
    "..#.....#..",
    ".#########.",
    ".####.####.",
    ".###...###.",
    ".####.####.",
    ".####.####.",
    ".#########.",
    "...........",
  ],
  sign: [
    "...........",
    ".##.+.+.+.+",
    ".##........",
    "...........",
    ".##.+.+.+.+",
    ".##........",
    "...........",
    ".##.+.+.+.+",
    ".##........",
    "...........",
    "...........",
  ],
  escrow: [
    "...........",
    "...#.......",
    "..##.......",
    ".#########.",
    "..##.......",
    "...#...#...",
    ".......##..",
    ".#########.",
    ".......##..",
    ".......#...",
    "...........",
  ],
  chain: [
    "...........",
    ".###.###.##",
    ".+++.+++.++",
    "...........",
    ".##.###.###",
    ".++.+++.+++",
    "...........",
    ".###.##.###",
    ".+++.++.+++",
    "...........",
    "...........",
  ],
  reject: [
    "...........",
    ".#.......#.",
    "..#.....#..",
    "...#...#...",
    "....#.#....",
    ".....#.....",
    "....#.#....",
    "...#...#...",
    "..#.....#..",
    ".#.......#.",
    "...........",
  ],
  refund: [
    "...........",
    "...#.......",
    "..##.......",
    ".########..",
    "..##.....#.",
    "...#.....#.",
    ".........#.",
    ".........#.",
    "..#######..",
    "...........",
    "...........",
  ],
};

const CELL = 7;
const N = 15; // frame size in cells (11 icon + border + gap)

function PixelIcon({ icon, color, small }: { icon: keyof typeof ICONS; color: string; small?: boolean }) {
  const dots: { x: number; y: number; a: number; on: boolean }[] = [];
  const bmp = ICONS[icon];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const border = x === 0 || y === 0 || x === N - 1 || y === N - 1;
      if (border) {
        dots.push({ x, y, a: 1, on: true });
        continue;
      }
      const ch = bmp[y - 2]?.[x - 2];
      if (ch === "#") dots.push({ x, y, a: 1, on: true });
      else if (ch === "+") dots.push({ x, y, a: 0.5, on: true });
      else dots.push({ x, y, a: 1, on: false });
    }
  }
  const size = N * CELL;
  return (
    <svg className={`px-icon ${small ? "small" : ""}`} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {dots.map((d, k) =>
        d.on ? (
          <rect key={k} x={d.x * CELL + 1} y={d.y * CELL + 1} width={CELL - 2} height={CELL - 2} rx={0.6} fill={color} opacity={d.a} />
        ) : (
          <rect key={k} x={d.x * CELL + 2.5} y={d.y * CELL + 2.5} width={2} height={2} fill="#1d2230" />
        ),
      )}
    </svg>
  );
}

const STAGES = [
  { key: "POST", icon: "post", color: "#f5c98a", text: "Bid to buy or list to sell. A private link, no account.", log: "buyer bids for 2,500 TSLA · pays in USDG · reply window 1h" },
  { key: "SEALED_BOX", icon: "seal", color: "#8fd3ff", text: "Answers are encrypted to the poster. We store ciphertext.", log: "3 offers arrive sealed · the server can't read the prices" },
  { key: "SIGNATURE_CHECK", icon: "sign", color: "#ff6a2b", text: "Each answer is signed by its wallet. Pass or flag.", log: "2 signed by their wallet · 1 unverified, ranked last" },
  { key: "ESCROW", icon: "escrow", color: "#f2f2f0", text: "Payment locks first. Then the tokens. No admin key.", log: "best offer accepted · payment locked · seller deposits gasless" },
  { key: "ROBINHOOD_CHAIN", icon: "chain", color: "#c2410c", text: "Both sides swap in one transaction. A receipt on chain.", log: "settled in 1 transaction · receipt on Robinhood Chain" },
] as const;

export function PixelPipeline() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reducedMotion()) return;
    const id = window.setInterval(() => setI((x) => (x + 1) % STAGES.length), 1900);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="pxp">
      <div className="pxp-row">
        <span className="pxp-wire" aria-hidden="true" />
        {STAGES.map((s, n) => (
          <div key={s.key} className={`pxp-node ${n === i ? "on" : ""} ${n < i ? "done" : ""}`}>
            <span className="pxp-key mono" style={{ color: s.color }}>
              {s.key}
            </span>
            <p>{s.text}</p>
            <PixelIcon icon={s.icon} color={s.color} />
          </div>
        ))}
      </div>

      <div className="pxp-branches">
        <div className="pxp-branch b-sign">
          <span className="pxp-drop" aria-hidden="true" />
          <PixelIcon icon="reject" color="#ff5277" small />
          <div>
            <span className="pxp-key mono amber">UNVERIFIED</span>
            <p>Not signed by its wallet. Ranked last; accepting it needs your explicit OK.</p>
          </div>
        </div>
        <div className="pxp-branch b-escrow">
          <span className="pxp-drop" aria-hidden="true" />
          <PixelIcon icon="refund" color="#ff5277" small />
          <div>
            <span className="pxp-key mono amber">REFUND</span>
            <p>Deadline passes before both sides fund: everyone gets their deposit back.</p>
          </div>
        </div>
      </div>

      <div className="pxp-log mono">
        <span className="dim">&gt;</span> {STAGES[i].log}
        <span className="cursor" aria-hidden="true">
          _
        </span>
      </div>
    </div>
  );
}
