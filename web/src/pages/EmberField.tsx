import { useEffect, useRef } from "react";
import { reducedMotion } from "../lib/motion.tsx";

/**
 * Embers rising off a fire: the backdrop of the token section, where fees buy the token and burn it.
 * Canvas, DPR-aware, paused off-screen; with reduced motion it draws one still frame.
 */
export function EmberField({ density = 1 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const still = reducedMotion();
    let W = 0,
      H = 0,
      dpr = 1,
      raf = 0,
      visible = false;

    type P = { x: number; y: number; r: number; vy: number; ph: number; sw: number; life: number; max: number; hue: number };
    let ps: P[] = [];
    const spawn = (atBottom: boolean): P => {
      const max = 5 + Math.random() * 7;
      return {
        x: Math.random() * W,
        y: atBottom ? H + Math.random() * 40 : Math.random() * H,
        r: 0.6 + Math.random() * 2.2,
        vy: 18 + Math.random() * 46,
        ph: Math.random() * Math.PI * 2,
        sw: 6 + Math.random() * 22,
        life: atBottom ? 0 : Math.random() * max,
        max,
        hue: 14 + Math.random() * 26, // deep orange → amber
      };
    };

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width;
      H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(((W * H) / 9000) * density);
      ps = Array.from({ length: Math.min(260, n) }, () => spawn(false));
    };

    const draw = (dt: number) => {
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        p.life += dt;
        p.y -= p.vy * dt;
        const x = p.x + Math.sin(p.ph + p.life * 1.3) * p.sw * 0.3;
        const t = p.life / p.max; // 0..1 over its life
        const fade = Math.sin(Math.PI * Math.min(1, t)) * (0.55 + 0.45 * Math.sin(p.life * 9 + p.ph)); // flicker
        if (t >= 1 || p.y < -10) {
          ps[i] = spawn(true);
          continue;
        }
        const a = Math.max(0, fade) * 0.9;
        const g = ctx.createRadialGradient(x, p.y, 0, x, p.y, p.r * 5);
        g.addColorStop(0, `hsla(${p.hue + 20}, 100%, 75%, ${a})`);
        g.addColorStop(0.35, `hsla(${p.hue}, 100%, 55%, ${a * 0.5})`);
        g.addColorStop(1, `hsla(${p.hue}, 100%, 45%, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, p.y, p.r * 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    };

    let lastT = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - lastT) / 1000);
      lastT = t;
      draw(dt);
      raf = visible ? requestAnimationFrame(loop) : 0;
    };

    resize();
    if (still) {
      draw(0);
      return;
    }
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf) {
        lastT = performance.now();
        raf = requestAnimationFrame(loop);
      }
    });
    io.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [density]);

  return <canvas ref={ref} className="embers" aria-hidden="true" />;
}
