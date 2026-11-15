import { useCallback, useEffect, useState, type ReactNode } from "react";
import { formatUnits } from "viem";

// ── tiny router: path-based, no dependency ──
export function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return path;
}

export function navigate(to: string) {
  window.history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function Link({
  to,
  children,
  className,
  onPointerEnter,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  onPointerEnter?: () => void;
}) {
  return (
    <a
      href={to}
      className={className}
      onPointerEnter={onPointerEnter}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

// ── async action with busy/error state ──
export function useAction<A extends unknown[]>(fn: (...a: A) => Promise<unknown>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (...a: A) => {
      setBusy(true);
      setError(null);
      try {
        await fn(...a);
      } catch (e: any) {
        setError(e?.shortMessage ?? e?.message ?? String(e));
      } finally {
        setBusy(false);
      }
    },
    [fn],
  );
  return { run, busy, error };
}

export function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () =>
      fn()
        .then((d) => alive && (setData(d), setError(null)))
        .catch((e) => alive && setError(e?.shortMessage ?? e?.message ?? String(e)));
    tick();
    const id = setInterval(tick, ms);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error };
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

// ── formatting ──
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function fmtAmount(v: bigint | string, decimals: number, max = 4) {
  const s = formatUnits(BigInt(v), decimals);
  const [i, f = ""] = s.split(".");
  const int = BigInt(i).toLocaleString("en-US");
  const frac = f.slice(0, max).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

export function fmtLeft(sec: number) {
  if (sec <= 0) return "closed";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

export const fmtUsd = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });

// ── small UI pieces ──
export function Err({ msg }: { msg: string | null }) {
  return msg ? <p className="err" role="alert">{msg}</p> : null;
}

export function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn ghost sm"
      onClick={() => navigator.clipboard.writeText(text).then(() => (setDone(true), setTimeout(() => setDone(false), 1500)))}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function Pill({ tone, children }: { tone: "ok" | "warn" | "muted" | "info"; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}
