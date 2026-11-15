import { useEffect, useRef } from "react";
import { reducedMotion } from "../lib/motion.tsx";

/** A field of copper dots rolling like a slow swell (meridian-style texture, no gradients). */
export function DotWave({ height = 220 }: { height?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const gap = 11;
      const cols = Math.ceil(w / gap) + 1;
      const rows = 16;
      for (let r = 0; r < rows; r++) {
        const depth = r / (rows - 1); // 0 = far (top), 1 = near (bottom)
        for (let c = 0; c < cols; c++) {
          const x = c * gap;
          const wave = Math.sin(x * 0.012 + t * 0.00045 + r * 0.35) * 18 + Math.sin(x * 0.004 - t * 0.0003) * 26;
          const y = h * 0.25 + depth * h * 0.7 + wave * (0.4 + depth * 0.6);
          if (y < 0 || y > h) continue;
          const a = 0.14 + depth * 0.7 * (0.6 + 0.4 * Math.sin(x * 0.01 + t * 0.0006));
          ctx.fillStyle = `rgba(155,240,212,${a.toFixed(3)})`;
          const s = 0.7 + depth * 1.1;
          ctx.fillRect(x, y, s, s);
        }
      }
      if (!reducedMotion()) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // pause when off screen
    const io = new IntersectionObserver(([e]) => {
      cancelAnimationFrame(raf);
      if (e.isIntersecting) raf = requestAnimationFrame(draw);
    });
    io.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="dotwave" style={{ height }} aria-hidden="true" />;
}
