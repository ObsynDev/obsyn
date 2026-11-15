import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { State, StateStore } from "./client.ts";

/** Node-only: keeps bid/offer secrets in a JSON file readable only by the current user. */
export class FileStore implements StateStore {
  private path: string;
  constructor(path: string) {
    this.path = path;
  }
  load(): State {
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as State;
    } catch {
      return { bids: {}, offers: {} };
    }
  }
  save(s: State) {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path); // atomic replace: a crash never leaves a half-written key file
    try {
      chmodSync(this.path, 0o600);
    } catch {
      /* not supported on every filesystem */
    }
  }
}
