import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { reducedMotion } from "./motion.tsx";
import { Link } from "./ui.tsx";

/** Glint-style corner brackets; they slide in on hover when inside a .gslot or sit on cards. */
export function Brackets() {
  return (
    <>
      <i className="br tl" aria-hidden="true" />
      <i className="br tr" aria-hidden="true" />
      <i className="br bl" aria-hidden="true" />
      <i className="br br2" aria-hidden="true" />
    </>
  );
}


const SCRAMBLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#*+=";

/**
 * Glint-style hover: the label scrambles through random glyphs and resolves
 * left to right (~0.55s). Plain-string labels only; anything else renders as is.
 */
function useScramble(label: ReactNode) {
  const text = typeof label === "string" ? label : null;
  const [shown, setShown] = useState<string | null>(null);
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const run = useCallback(() => {
    if (!text || reducedMotion()) return;
    cancelAnimationFrame(raf.current);
    const start = performance.now();
    const DUR = 550;
    const DELAY = 80;
    const tick = (now: number) => {
      const t = now - start;
      // characters resolve one by one after a short delay
      const revealed = t < DELAY ? 0 : Math.floor(((t - DELAY) / (DUR - DELAY)) * text.length);
      if (revealed >= text.length) {
        setShown(null);
        return;
      }
      let out = "";
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        out += i < revealed || ch === " " ? ch : SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0];
      }
      setShown(out);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [text]);
  return { label: shown ?? label, onPointerEnter: run };
}

/** Primary action as a physical key: lift, LED, ENTER glyph, presses down. */
export function KeyButton({
  to,
  onClick,
  children,
  glyph = "ENTER ↵",
  type = "button",
  disabled,
  tone = "green",
  block,
}: {
  to?: string;
  onClick?: () => void;
  children: ReactNode;
  glyph?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  tone?: "green" | "red";
  /** stretch to the container width */
  block?: boolean;
}) {
  const sc = useScramble(children);
  const inner = (
    <>
      <span className="gkey-legend">{sc.label}</span>
      <span className="gkey-led" aria-hidden="true" />
      <span className="gkey-glyph" aria-hidden="true">
        {glyph}
      </span>
    </>
  );
  if (to) {
    return (
      <Link to={to} className={`gkey ${tone}${block ? " block" : ""}`} onPointerEnter={sc.onPointerEnter}>
        {inner}
      </Link>
    );
  }
  return (
    <button type={type} className={`gkey ${tone}${block ? " block" : ""}`} onClick={onClick} disabled={disabled} onPointerEnter={sc.onPointerEnter}>
      {inner}
    </button>
  );
}

/** Secondary action as a recessed slot: fill sweeps in, brackets snap to the corners, arrow nudges. */
export function SlotButton({ to, onClick, children, arrow = "→" }: { to?: string; onClick?: () => void; children: ReactNode; arrow?: string }) {
  const sc = useScramble(children);
  const inner = (
    <>
      <Brackets />
      <span>{sc.label}</span>
      <span className="gslot-arrow" aria-hidden="true">
        {arrow}
      </span>
    </>
  );
  if (to) {
    return (
      <Link to={to} className="gslot" onPointerEnter={sc.onPointerEnter}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" className="gslot" onClick={onClick} onPointerEnter={sc.onPointerEnter}>
      {inner}
    </button>
  );
}
