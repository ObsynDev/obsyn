import { useEffect, useRef } from "react";
import { reducedMotion } from "../lib/motion.tsx";

/**
 * The SLAB mark as a lit 3D object rendered in characters (glint-style ASCII art):
 * three stacked slabs slowly turning, shaded with a character ramp. A few cells flicker
 * into hex "ciphertext" in copper, so the mark reads as sealed data.
 */

type V = [number, number, number];
const RAMP = " .:-=+*#%@";
const HEX = "0123456789abcdef";

// slab: half extents (x, y, z) and vertical offset
const SLABS: { hx: number; hy: number; hz: number; y: number }[] = [
  { hx: 1.0, hy: 0.11, hz: 0.66, y: -1.0 },
  { hx: 0.82, hy: 0.11, hz: 0.54, y: 0 },
  { hx: 0.64, hy: 0.11, hz: 0.42, y: 1.0 },
];

const LIGHT: V = (() => {
  const l: V = [-0.35, 0.75, -0.7];
  const n = Math.hypot(...l);
  return [l[0] / n, l[1] / n, l[2] / n];
})();

function rot(p: V, ay: number, ax: number): V {
  // rotate around Y, then tilt around X
  const [x, y, z] = p;
  const cy = Math.cos(ay);
  const sy = Math.sin(ay);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const cx = Math.cos(ax);
  const sx = Math.sin(ax);
  return [x1, y * cx - z1 * sx, y * sx + z1 * cx];
}

export function AsciiSlabs() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const COLS = 64;
    const ROWS = 36;
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

    const lum = new Float32Array(COLS * ROWS);
    const zbuf = new Float32Array(COLS * ROWS);
    const layer = new Uint8Array(COLS * ROWS);
    let raf = 0;
    let last = 0;
    const start = performance.now();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 66) return; // ~15 fps is plenty for ASCII
      last = now;
      const t = (now - start) / 1000;
      const ay = 0.75 + t * 0.35;
      const ax = -0.5; // tilt the top toward the camera so the top faces are visible
      lum.fill(-1);
      zbuf.fill(-Infinity);

      SLABS.forEach((s, k) => {
        // sample each of the 6 faces
        const faces: { n: V; u: V; v: V; c: V; su: number; sv: number }[] = [
          { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], c: [0, s.hy, 0], su: s.hx, sv: s.hz },
          { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], c: [0, -s.hy, 0], su: s.hx, sv: s.hz },
          { n: [1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], c: [s.hx, 0, 0], su: s.hz, sv: s.hy },
          { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], c: [-s.hx, 0, 0], su: s.hz, sv: s.hy },
          { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], c: [0, 0, s.hz], su: s.hx, sv: s.hy },
          { n: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0], c: [0, 0, -s.hz], su: s.hx, sv: s.hy },
        ];
        for (const f of faces) {
          const n = rot(f.n, ay, ax);
          if (n[2] > 0.05) continue; // back face (camera looks along +z)
          // Lambert: LIGHT points toward the light, so a face is lit when n · LIGHT > 0
          const shade = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) * 0.7 + 0.3;
          const nu = Math.max(4, Math.round(f.su * 60));
          const nv = Math.max(2, Math.round(f.sv * 60));
          for (let i = 0; i <= nu; i++) {
            const a = (i / nu) * 2 - 1;
            for (let j = 0; j <= nv; j++) {
              const b = (j / nv) * 2 - 1;
              const p: V = [
                f.c[0] + f.u[0] * a * f.su + f.v[0] * b * f.sv,
                f.c[1] + f.u[1] * a * f.su + f.v[1] * b * f.sv + s.y,
                f.c[2] + f.u[2] * a * f.su + f.v[2] * b * f.sv,
              ];
              const r = rot(p, ay, ax);
              const z = r[2] + 5;
              const ooz = 1 / z;
              const sx = Math.floor(COLS / 2 + r[0] * ooz * COLS * 1.55);
              const sy = Math.floor(ROWS / 2 - r[1] * ooz * ROWS * 1.6);
              if (sx < 0 || sx >= COLS || sy < 0 || sy >= ROWS) continue;
              const idx = sy * COLS + sx;
              if (ooz > zbuf[idx]) {
                zbuf[idx] = ooz;
                // darken face edges slightly so slabs read as distinct blocks
                const edge = Math.abs(a) > 0.94 || Math.abs(b) > 0.9 ? 0.55 : 1;
                lum[idx] = shade * edge;
                layer[idx] = k;
              }
            }
          }
        }
      });

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = `600 ${fs}px "Geist Mono", ui-monospace, monospace`;
      ctx.textBaseline = "top";
      const seed = Math.floor(t * 7);
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const L = lum[y * COLS + x];
          if (L < 0) continue;
          const h = Math.sin(x * 12.9898 + y * 78.233 + seed * 3.17) * 43758.5453;
          const rnd = h - Math.floor(h);
          let c = RAMP[Math.min(RAMP.length - 1, 1 + Math.floor(L * (RAMP.length - 2)))];
          let color: string;
          if (rnd < 0.02) {
            c = HEX[Math.floor(rnd * 1000) % 16];
            color = "#e39a5d";
          } else {
            const k = layer[y * COLS + x];
            const g = [0.55, 0.78, 1][k];
            const a = 0.25 + L * 0.75;
            color = `rgba(${Math.round(140 * g)},${Math.round(255 * g)},${Math.round(97 * g)},${a.toFixed(2)})`;
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
