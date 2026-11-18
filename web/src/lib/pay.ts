import { useEffect, useState } from "react";
import { zeroAddress, type Address } from "viem";
import { api } from "./api.ts";

/** What a deal can be paid in. OBSYN only when the server's escrow takes it (and burns its fee). */
export type PaySymbol = "ETH" | "USDG" | "OBSYN";

let obsyn: Promise<Address | null> | null = null;

/** $OBSYN's address when paying in it is switched on (the server lists it in payTokens), else null. */
export function obsynPayToken(): Promise<Address | null> {
  return (obsyn ??= api.config().then(
    (c) => c.payTokens?.find((p) => p.symbol === "OBSYN")?.address ?? null,
    () => {
      obsyn = null;
      return null;
    },
  ));
}

/**
 * The pay options to show: `base`, plus OBSYN when the server accepts it, except when the token
 * being traded is OBSYN itself (a deal can't pay in the token it trades).
 */
export function usePayOptions(base: readonly ("ETH" | "USDG")[], token?: string | null): { options: PaySymbol[]; obsyn: Address | null } {
  const [addr, setAddr] = useState<Address | null>(null);
  useEffect(() => {
    let alive = true;
    obsynPayToken().then((a) => alive && setAddr(a));
    return () => {
      alive = false;
    };
  }, []);
  const tradingObsyn = !!addr && !!token && token.toLowerCase() === addr.toLowerCase();
  return { options: addr && !tradingObsyn ? [...base, "OBSYN"] : [...base], obsyn: addr };
}

/** Falls back to USDG when the chosen currency stops being on offer (e.g. the token became OBSYN). */
export function useKeepPayValid(pay: PaySymbol, options: PaySymbol[], setPay: (p: PaySymbol) => void) {
  const key = options.join();
  useEffect(() => {
    if (!options.includes(pay)) setPay("USDG");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pay, key]);
}

/** Ghost mode (gasless relayed deposit) works only for deals paid in ETH or USDG. */
export function ghostPayable(payToken: Address, usdg: Address | null | undefined): boolean {
  return payToken === zeroAddress || (!!usdg && payToken.toLowerCase() === usdg.toLowerCase());
}

/** Why the ghost-mode button is off on a deal paid in $OBSYN. */
export const NO_GHOST_PAY = "Ghost mode works for deals paid in ETH or USDG. On a deal paid in $OBSYN, deliver from your wallet.";

export const PAY_TITLE: Record<PaySymbol, string | undefined> = {
  ETH: undefined,
  USDG: undefined,
  OBSYN: "Pay in $OBSYN: a flat 1.5% fee, burned on settlement",
};
