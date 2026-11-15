import type { ReactNode } from "react";
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
  const inner = (
    <>
      <span className="gkey-legend">{children}</span>
      <span className="gkey-led" aria-hidden="true" />
      <span className="gkey-glyph" aria-hidden="true">
        {glyph}
      </span>
    </>
  );
  if (to) {
    return (
      <Link to={to} className={`gkey ${tone}${block ? " block" : ""}`}>
        {inner}
      </Link>
    );
  }
  return (
    <button type={type} className={`gkey ${tone}${block ? " block" : ""}`} onClick={onClick} disabled={disabled}>
      {inner}
    </button>
  );
}

/** Secondary action as a recessed slot: fill sweeps in, brackets snap to the corners, arrow nudges. */
export function SlotButton({ to, onClick, children, arrow = "→" }: { to?: string; onClick?: () => void; children: ReactNode; arrow?: string }) {
  const inner = (
    <>
      <Brackets />
      <span>{children}</span>
      <span className="gslot-arrow" aria-hidden="true">
        {arrow}
      </span>
    </>
  );
  if (to) {
    return (
      <Link to={to} className="gslot">
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" className="gslot" onClick={onClick}>
      {inner}
    </button>
  );
}
