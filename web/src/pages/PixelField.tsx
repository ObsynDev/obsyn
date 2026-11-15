import { useEffect, useRef } from "react";
import { reducedMotion } from "../lib/motion.tsx";

/**
 * A raster of square cells behind the hero: on load the cells light up in a sweeping wave,
 * then they settle into a slow, sparse twinkle, and cells near the pointer warm up.
 * Canvas, DPR-aware, paused when off-screen; one still frame with reduced motion.
 */

const CELL = 30; // px, including the gap
const GAP = 3;

// palette: ember, deep ember, ash grey (drawn at low alpha on the dark page)
const COLORS = [
  [255, 106, 43],
  [150, 55, 20],
  [95, 86, 76],
] as const;

export function PixelField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = reducedMotion();

    let W = 0,
      H = 0,
      cols = 0,
      rows = 0,
      raf = 0,
      visible = true;
    // per cell: current level, target level, colour index, next change time
    let level = new Float32Array(0);
    let target = new Float32Array(0);
    let tone = new Uint8Array(0);
    let next = new Float32Array(0);
    let px = -1e4,
      py = -1e4;
    const start = performance.now();

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width;
      H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(W / CELL) + 1;
      rows = Math.ceil(H / CELL) + 1;
      const n = cols * rows;
      level = new Float32Array(n);
      target = new Float32Array(n);
      tone = new Uint8Array(n);
      next = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        tone[i] = Math.random() < 0.62 ? 1 : Math.random() < 0.6 ? 0 : 2;
        target[i] = Math.random() < 0.28 ? 0.25 + Math.random() * 0.75 : 0;
        next[i] = 1.6 + Math.random() * 6;
      }
    };

    const draw = (t: number, dt: number) => {
      ctx.clearRect(0, 0, W, H);
      const intro = still ? 99 : t; // seconds since start
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          // intro wave: a diagonal front sweeps across in ~1.4s, flashing each cell as it passes
          const front = intro * (cols + rows) * 0.7 - (x + y * 0.6);
          let wave = 0;
          if (front > 0 && front < 6) wave = Math.sin((front / 6) * Math.PI) * 0.9;
          if (front <= 0 && !still) continue; // not reached yet

          // slow twinkle after the intro
          if (!still && t > next[i]) {
            target[i] = Math.random() < 0.3 ? 0.25 + Math.random() * 0.75 : 0;
            next[i] = t + 2 + Math.random() * 7;
          }
          level[i] += (target[i] - level[i]) * Math.min(1, dt * 1.6);

          // pointer warmth
          const cx = x * CELL + CELL / 2;
          const cy = y * CELL + CELL / 2;
          const d = Math.hypot(cx - px, cy - py);
          const warm = d < 160 ? (1 - d / 160) ** 2 : 0;

          const a = Math.min(1, level[i] * 0.55 + wave + warm * 0.9);
          if (a < 0.02) continue;
          const [r, g, b] = warm > 0.15 || wave > 0.3 ? COLORS[0] : COLORS[tone[i]];
          ctx.fillStyle = `rgba(${r},${g},${b},${(a * 0.72).toFixed(3)})`;
          ctx.fillRect(x * CELL + GAP / 2, y * CELL + GAP / 2, CELL - GAP, CELL - GAP);
        }
      }
    };

    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      draw((now - start) / 1000, dt);
      raf = visible ? requestAnimationFrame(loop) : 0;
    };

    resize();
    if (still) {
      for (let i = 0; i < level.length; i++) level[i] = target[i];
      draw(99, 0);
      return;
    }
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    });
    io.observe(canvas);
    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      px = e.clientX - r.left;
      py = e.clientY - r.top;
    };
    const leave = () => {
      px = py = -1e4;
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
    };
  }, []);

  return <canvas ref={ref} className="pixel-field" aria-hidden="true" />;
}
