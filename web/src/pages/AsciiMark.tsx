import { useEffect, useRef } from "react";
import { reducedMotion } from "../lib/motion.tsx";

/**
 * The Obsyn mark (a slanted "o" cut on the diagonal, halves slid along the cut) as a lit
 * 3D object drawn in characters. The flat logo is extruded and raymarched cell by cell,
 * shaded with a character ramp; a few cells flicker into hex "ciphertext" in ice blue.
 * Geometry mirrors the SVG mark in lib/brand.tsx (64-unit space, normalised to ±1).
 */

const RAMP = " .:-=+*#%@";
const HEX = "0123456789abcdef";

// mark geometry, normalised so the 64-unit SVG box spans -1..1
const OUT_H = 26 / 32; // outer rounded square half size
const OUT_R = 18 / 32;
const IN_H = 11 / 32; // the counter (hole)
const IN_R = 7.5 / 32;
const GAP = 14 / 32; // half-width of the diagonal cut, measured on x - y
const SLIDE = 2.4 / 32; // how far each half slides along the cut
const SKEW = Math.tan((10 * Math.PI) / 180); // italic slant
const DEPTH = 0.2; // extrusion half-thickness

function sdRoundBox(x: number, y: number, h: number, r: number) {
  const qx = Math.abs(x) - h + r;
  const qy = Math.abs(y) - h + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** 2D signed distance of the mark (y up). */
function sdMark2(x: number, y: number) {
  // undo the italic slant (top leans right)
  const px = x - SKEW * y;
  const py = y;
  const ring = (u: number, v: number) => Math.max(sdRoundBox(u, v, OUT_H, OUT_R), -sdRoundBox(u, v, IN_H, IN_R));
  // top-left half: x - y < -GAP, slid by (-SLIDE, -SLIDE); bottom-right half: x - y > GAP, slid by (+SLIDE, +SLIDE)
  const ax = px + SLIDE;
  const ay = py + SLIDE;
  const a = Math.max(ring(ax, ay), (ax - ay + GAP) / Math.SQRT2);
  const bx = px - SLIDE;
  const by = py - SLIDE;
  const b = Math.max(ring(bx, by), (-(bx - by) + GAP) / Math.SQRT2);
  return Math.min(a, b);
}

/** 3D signed distance: the 2D mark extruded along z. */
function sdMark(x: number, y: number, z: number) {
  const d = sdMark2(x, y);
  const w = Math.abs(z) - DEPTH;
  return Math.hypot(Math.max(d, 0), Math.max(w, 0)) + Math.min(Math.max(d, w), 0);
}

export function AsciiMark() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const COLS = 60;
    const ROWS = 34;
    const ASPECT = 1.8; // a character cell is ~1.8x taller than wide
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cw = 0;
    let ch = 0;
    let fs = 12;

    const resize = () => {
      const w = canvas.clientWidth;
      fs = Math.max(7, Math.floor(w / COLS / 0.6));
      cw = fs * 0.6;
      ch = fs * 1.08;
      canvas.width = Math.ceil(COLS * cw * dpr);
      canvas.height = Math.ceil(ROWS * ch * dpr);
      canvas.style.height = `${ROWS * ch}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // light from upper left, slightly in front
    const L = (() => {
      const l = [-0.5, 0.6, -0.62];
      const n = Math.hypot(l[0], l[1], l[2]);
      return [l[0] / n, l[1] / n, l[2] / n];
    })();

    const lum = new Float32Array(COLS * ROWS);
    const rim = new Float32Array(COLS * ROWS);
    let raf = 0;
    let last = 0;
    const start = performance.now();
    const VIEW = 1.35; // half-width of the view in object units

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 66) return; // ~15 fps is plenty for ASCII
      last = now;
      const t = (now - start) / 1000;
      // swing back and forth (never edge-on for long), with a slight tilt
      const ay = Math.sin(t * 0.55) * 0.75;
      const ax = -0.18 + Math.sin(t * 0.37) * 0.08;
      const cy = Math.cos(ay), sy = Math.sin(ay), cx = Math.cos(ax), sx = Math.sin(ax);
      // world -> object: inverse of (rotate Y then rotate X)
      const toObj = (x: number, y: number, z: number): [number, number, number] => {
        const y1 = y * cx + z * sx;
        const z1 = -y * sx + z * cx;
        return [x * cy - z1 * sy, y1, x * sy + z1 * cy];
      };
      const sdf = (x: number, y: number, z: number) => {
        const p = toObj(x, y, z);
        return sdMark(p[0], p[1], p[2]);
      };

      lum.fill(-1);
      for (let j = 0; j < ROWS; j++) {
        const wy = -((j + 0.5) / ROWS - 0.5) * 2 * VIEW * ((ROWS * ASPECT) / COLS);
        for (let i = 0; i < COLS; i++) {
          const wx = ((i + 0.5) / COLS - 0.5) * 2 * VIEW;
          // orthographic ray along +z
          let z = -2.5;
          let hit = false;
          for (let s = 0; s < 56; s++) {
            const d = sdf(wx, wy, z);
            if (d < 0.004) {
              hit = true;
              break;
            }
            z += d * 0.9;
            if (z > 2.5) break;
          }
          if (!hit) continue;
          const e = 0.01;
          let nx = sdf(wx + e, wy, z) - sdf(wx - e, wy, z);
          let ny = sdf(wx, wy + e, z) - sdf(wx, wy - e, z);
          let nz = sdf(wx, wy, z + e) - sdf(wx, wy, z - e);
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl;
          ny /= nl;
          nz /= nl;
          const diff = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
          const idx = j * COLS + i;
          lum[idx] = 0.22 + diff * 0.78;
          rim[idx] = Math.pow(1 - Math.abs(nz), 2); // edges facing sideways glow ember
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = `600 ${fs}px "Geist Mono", ui-monospace, monospace`;
      ctx.textBaseline = "top";
      const seed = Math.floor(t * 7);
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const v = lum[y * COLS + x];
          if (v < 0) continue;
          const h = Math.sin(x * 12.9898 + y * 78.233 + seed * 3.17) * 43758.5453;
          const rnd = h - Math.floor(h);
          let c = RAMP[Math.min(RAMP.length - 1, 1 + Math.floor(v * (RAMP.length - 2)))];
          let color: string;
          if (rnd < 0.018) {
            c = HEX[Math.floor(rnd * 1000) % 16];
            color = "#8fd3ff";
          } else {
            const r = rim[y * COLS + x];
            const g = 0.55 + v * 0.45;
            const a = 0.3 + v * 0.7;
            // faces: ember shaded by light; side walls lean brighter and warmer
            color = `rgba(${Math.round(255 * Math.min(1, g + r * 0.2))},${Math.round(106 * g + r * 50)},${Math.round(43 * g)},${a.toFixed(2)})`;
          }
          ctx.fillStyle = color;
          ctx.fillText(c, x * cw, y * ch);
        }
      }
      if (reducedMotion()) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(frame);

    const io = new IntersectionObserver(([e]) => {
      cancelAnimationFrame(raf);
      if (e.isIntersecting) raf = requestAnimationFrame(frame);
    });
    io.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="ascii3d" aria-hidden="true" />;
}
