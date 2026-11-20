import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide, type KeeperState } from "../src/autoburn.ts";

const NOW = 1_800_000_000;
const base: KeeperState = {
  installed: true,
  pendingEth: 10n ** 16n,
  pendingUsdg: 0n,
  canSnapshot: false,
  snapshotAt: NOW - 700,
  lastBurnAt: 0,
  cooldown: 1800,
  minSnapshotAge: 600,
  maxSnapshotAge: 7200,
  inBand: true,
};
const d = (over: Partial<KeeperState>, now = NOW) => decide({ ...base, ...over }, now);

describe("auto-burn decisions", () => {
  it("does nothing until the keeper is installed, or when there's nothing to burn", () => {
    assert.deepEqual(d({ installed: false }), { kind: "wait", why: "not the vault's keeper yet" });
    assert.deepEqual(d({ pendingEth: 0n }), { kind: "wait", why: "nothing to burn" });
  });

  it("burns ETH first, then USDG, once the snapshot has aged", () => {
    assert.deepEqual(d({}), { kind: "burnEth" });
    assert.deepEqual(d({ pendingEth: 0n, pendingUsdg: 20_000_000n }), { kind: "burnUsdg" });
  });

  it("waits out the cooldown", () => {
    assert.deepEqual(d({ lastBurnAt: NOW - 100 }), { kind: "wait", why: "cooldown" });
    assert.deepEqual(d({ lastBurnAt: NOW - 1800 }), { kind: "burnEth" });
  });

  it("takes a snapshot when there is none, it is stale, or the price left the band", () => {
    assert.deepEqual(d({ snapshotAt: 0, canSnapshot: true }), { kind: "snapshot" });
    assert.deepEqual(d({ snapshotAt: NOW - 7201, canSnapshot: true }), { kind: "snapshot" });
    assert.deepEqual(d({ inBand: false, canSnapshot: true }), { kind: "snapshot" });
  });

  it("waits for a fresh snapshot to age, and never fights the contract's snapshot rule", () => {
    assert.deepEqual(d({ snapshotAt: NOW - 100 }), { kind: "wait", why: "snapshot aging" });
    assert.deepEqual(d({ snapshotAt: 0, canSnapshot: false }), { kind: "wait", why: "snapshot can't be retaken yet" });
  });

  it("treats the edges like the contract does (usable at exactly minAge, until exactly maxAge)", () => {
    assert.deepEqual(d({ snapshotAt: NOW - 600 }), { kind: "burnEth" });
    assert.deepEqual(d({ snapshotAt: NOW - 7200 }), { kind: "burnEth" });
    assert.deepEqual(d({ snapshotAt: NOW - 599 }), { kind: "wait", why: "snapshot aging" });
  });
});
