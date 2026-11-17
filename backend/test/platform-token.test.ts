import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config.ts";

describe("$OBSYN settings from the environment", () => {
  it("is empty until the token launches", () => {
    assert.deepEqual(loadConfig({}).platformToken, { address: null, ponsUrl: null, discountMin: null });
  });

  it("reads the address, Pons link and discount threshold", () => {
    const t = loadConfig({
      PLATFORM_TOKEN_ADDRESS: " 0xaa07a0e9209e16ac99708c3ec70159c6ef3128a3 ",
      PLATFORM_TOKEN_PONS_URL: "https://pons.family/token/0xaa07a0e9209e16ac99708c3ec70159c6ef3128a3",
      PLATFORM_TOKEN_DISCOUNT_MIN: "100,000",
    }).platformToken;
    assert.equal(t?.address, "0xAa07A0e9209e16aC99708C3EC70159c6eF3128A3"); // checksummed
    assert.match(t!.ponsUrl!, /^https:\/\/pons\.family\//);
    assert.equal(t?.discountMin, "100,000");
  });

  it("ignores bad values instead of crashing", () => {
    const t = loadConfig({
      PLATFORM_TOKEN_ADDRESS: "0x1234",
      PLATFORM_TOKEN_PONS_URL: "javascript:alert(1)",
      PLATFORM_TOKEN_DISCOUNT_MIN: "lots",
    }).platformToken;
    assert.deepEqual(t, { address: null, ponsUrl: null, discountMin: null });
  });
});
