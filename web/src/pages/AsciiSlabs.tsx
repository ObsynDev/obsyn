import { useEffect, useMemo, useState } from "react";
import { reducedMotion } from "../lib/motion.tsx";

/**
 * The SLAB mark drawn in characters: three stacked slabs.
 * Characters keep flickering into hex "ciphertext", so the logo reads as sealed data.
 */
const W = 46;
const H = 25;
const HEX = "0123456789abcdef";

type Cell = { ch: string; layer: 0 | 1 | 2 } | null;

function buildGrid(): Cell[][] {
  const g: Cell[][] = Array.from({ length: H }, () => Array<Cell>(W).fill(null));
  // three slabs, top to bottom; each is a parallelogram (top face) over a front face
  const slabs = [
    { y: 1, x: 15, w: 22 },
    { y: 9, x: 9, w: 28 },
    { y: 17, x: 3, w: 34 },
  ];
  slabs.forEach((s, k) => {
    const layer = k as 0 | 1 | 2;
    // top face: 3 rows, skewed
    for (let r = 0; r < 3; r++) {
      const left = s.x + (2 - r) * 2;
      for (let c = 0; c < s.w; c++) {
        const x = left + c;
        if (x < W) g[s.y + r][x] = { ch: r === 0 ? "+" : "*", layer };
      }
    }
    // front face: 4 rows, dense
    for (let r = 3; r < 7; r++) {
      for (let c = 0; c < s.w; c++) {
        const x = s.x + c;
        if (x < W && s.y + r < H) g[s.y + r][x] = { ch: c === 0 || c === s.w - 1 ? "=" : "#", layer };
      }
    }
    // right side face for depth
    for (let r = 0; r < 7; r++) {
      const x = s.x + s.w + Math.max(0, 2 - r) * 2 - (r < 3 ? 0 : 0);
      for (let d = 0; d < 3; d++) {
        const xx = x + d - (r >= 3 ? 0 : 0);
        if (r >= 1 && xx < W && s.y + r < H && !g[s.y + r][xx]) g[s.y + r][xx] = { ch: d === 0 ? ":" : ".", layer };
      }
    }
  });
  return g;
}

export function AsciiSlabs() {
  const grid = useMemo(buildGrid, []);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reducedMotion()) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 140);
    return () => clearInterval(id);
  }, []);

  // ~7% of cells show a hex digit each frame: the slabs are "made of" ciphertext
  const rows = grid.map((row, y) =>
    row.map((cell, x) => {
      if (!cell) return null;
      const seed = Math.sin((x * 928.3 + y * 127.1 + tick * 31.7) % 10000) * 43758.5453;
      const r = seed - Math.floor(seed);
      return { ...cell, ch: r < 0.07 ? HEX[Math.floor(r * 1000) % 16] : cell.ch, hot: r < 0.07 };
    }),
  );

  return (
    <pre className="ascii" aria-hidden="true">
      {rows.map((row, y) => (
        <span key={y} className="ascii-row">
          {row.map((c, x) =>
            c ? (
              <span key={x} className={`l${c.layer}${c.hot ? " hot" : ""}`}>
                {c.ch}
              </span>
            ) : (
              " "
            ),
          )}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}
