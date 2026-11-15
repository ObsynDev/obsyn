import { useEffect, useRef, useState, type ReactNode } from "react";

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Fades/slides children in the first time they scroll into view. */
export function Reveal({ children, delay = 0, as: Tag = "div", className = "" }: { children: ReactNode; delay?: number; as?: "div" | "section" | "article" | "li"; className?: string }) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion() || !("IntersectionObserver" in window)) return setShown(true);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref as never} className={`reveal ${shown ? "in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}

const GLYPHS = "ABCDEF0123456789#$%&*+/<>=?@[]{}";

/** Text that "decrypts": random glyphs settle into the real characters, left to right. */
export function Scramble({ text, duration = 900, delay = 0, className }: { text: string; duration?: number; delay?: number; className?: string }) {
  const [out, setOut] = useState(reducedMotion() ? text : text.replace(/\S/g, " "));
  useEffect(() => {
    if (reducedMotion()) return setOut(text);
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (t: number) => {
      const p = Math.max(0, Math.min(1, (t - start) / duration));
      const fixed = Math.floor(p * text.length);
      setOut(
        text
          .split("")
          .map((c, i) => (c === " " ? " " : i < fixed ? c : t < start ? " " : GLYPHS[(Math.random() * GLYPHS.length) | 0]))
          .join(""),
      );
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, duration, delay]);
  return (
    <span className={className} aria-label={text}>
      <span aria-hidden="true">{out}</span>
    </span>
  );
}

/** Number that counts up when it first appears. */
export function CountUp({ value, duration = 1200 }: { value: number; duration?: number }) {
  const [n, setN] = useState(reducedMotion() ? value : 0);
  useEffect(() => {
    if (reducedMotion()) return setN(value);
    let raf = 0;
    const s = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - s) / duration);
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{n.toLocaleString("en-US")}</>;
}

/** Tilts an element toward the pointer (desktop only). */
export function useTilt<T extends HTMLElement>(max = 8) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion() || window.matchMedia("(hover: none)").matches) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty("--rx", `${(-y * max).toFixed(2)}deg`);
      el.style.setProperty("--ry", `${(x * max).toFixed(2)}deg`);
    };
    const leave = () => {
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
    };
    window.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [max]);
  return ref;
}

/** Run once when the element first scrolls into view (immediately with reduced motion). */
export function useInView<T extends HTMLElement>(margin = "0px 0px -12% 0px") {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion() || !("IntersectionObserver" in window)) return setInView(true);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return [ref, inView] as const;
}

/**
 * Headline that rises word by word from behind a mask when it scrolls into view.
 * Pass plain text; wrap a phrase in [brackets] to give it the accent class.
 */
export function SplitWords({ text, as: Tag = "h2", className = "", accent = "accent", delay = 0 }: { text: string; as?: "h1" | "h2" | "h3"; className?: string; accent?: string; delay?: number }) {
  const [ref, inView] = useInView<HTMLHeadingElement>();
  let i = 0;
  // "[...]" marks accent runs; "/" forces a line break
  const parts = text.split(/(\[[^\]]+\]|\/)/).filter(Boolean);
  return (
    <Tag ref={ref as never} className={`split ${inView ? "in" : ""} ${className}`} style={{ ["--d" as string]: `${delay}ms` }} aria-label={text.replace(/[[\]/]/g, "")}>
      {parts.map((p, pi) => {
        if (p === "/") return <br key={pi} />;
        const isAccent = p.startsWith("[");
        const words = (isAccent ? p.slice(1, -1) : p).split(/(\s+)/);
        return (
          <span key={pi} className={isAccent ? accent : undefined} aria-hidden="true">
            {words.map((w, wi) =>
              /^\s+$/.test(w) || !w ? (
                w
              ) : (
                <span key={wi} className="w">
                  <span style={{ ["--i" as string]: i++ }}>{w}</span>
                </span>
              ),
            )}
          </span>
        );
      })}
    </Tag>
  );
}

/** Cards with [data-spot] get a soft light that follows the pointer (CSS reads --mx/--my). */
export function useSpotlight() {
  useEffect(() => {
    if (reducedMotion() || window.matchMedia("(hover: none)").matches) return;
    const move = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-spot]") as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);
}

/** Speeds CSS marquees (selector) up while the page scrolls, then eases back. */
export function useScrollBoost(selector: string) {
  useEffect(() => {
    if (reducedMotion()) return;
    let last = window.scrollY;
    let boost = 0;
    let raf = 0;
    const tracks = () => Array.from(document.querySelectorAll<HTMLElement>(selector)).flatMap((el) => el.getAnimations());
    const tick = () => {
      boost *= 0.92;
      for (const a of tracks()) a.playbackRate = 1 + boost;
      raf = boost > 0.02 ? requestAnimationFrame(tick) : 0;
      if (!raf) for (const a of tracks()) a.playbackRate = 1;
    };
    const onScroll = () => {
      const y = window.scrollY;
      boost = Math.min(6, boost + Math.abs(y - last) / 60);
      last = y;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [selector]);
}

/**
 * Writes scroll progress (0..1) of an element into a CSS variable on it, without re-rendering.
 * `map` turns the element's rect and the viewport height into progress.
 */
export function useScrollVar<T extends HTMLElement>(map: (r: DOMRect, vh: number) => number, name = "--p") {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion()) {
      el.style.setProperty(name, "1");
      return;
    }
    let raf = 0;
    const update = () => {
      raf = 0;
      const p = Math.max(0, Math.min(1, map(el.getBoundingClientRect(), window.innerHeight)));
      el.style.setProperty(name, p.toFixed(4));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
    // map is expected to be a stable module-level function
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  return ref;
}

/** A ring that trails the pointer and swells over anything clickable (desktop, motion allowed). */
export function CursorRing() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion() || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let x = -100,
      y = -100,
      tx = -100,
      ty = -100,
      raf = 0;
    const move = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      const hot = (e.target as HTMLElement | null)?.closest?.("a, button, summary, [role=tab], [role=option], input, textarea, select");
      el.classList.toggle("hot", !!hot && !(hot as HTMLElement).matches("input, textarea, select"));
      el.classList.toggle("text", !!hot && (hot as HTMLElement).matches("input, textarea, select"));
      el.classList.add("on");
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const tick = () => {
      x += (tx - x) * 0.2;
      y += (ty - y) * 0.2;
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.3 ? requestAnimationFrame(tick) : 0;
    };
    const leave = () => el.classList.remove("on");
    const down = () => el.classList.add("down");
    const up = () => el.classList.remove("down");
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div ref={ref} className="cursor-ring" aria-hidden="true">
      <i />
    </div>
  );
}
