import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OtcAgent } from "../src/sdk/client.ts";

describe("SDK and rate limits", () => {
  it("waits as told by Retry-After and resends a rate-limited request", async () => {
    let calls = 0;
    const fake = (async () => {
      calls++;
      return calls === 1
        ? new Response(JSON.stringify({ error: "rate limited" }), { status: 429, headers: { "retry-after": "1" } })
        : new Response(JSON.stringify([{ name: "Desk" }]), { status: 200 });
    }) as typeof fetch;
    const a = new OtcAgent({ apiUrl: "http://x/api", fetch: fake });
    const t0 = Date.now();
    const r = await a.get<{ name: string }[]>("/makers");
    assert.equal(r[0].name, "Desk");
    assert.equal(calls, 2);
    assert.ok(Date.now() - t0 >= 950, "waited the second the server asked for");
  });

  it("gives up after three retries and reports the limit", async () => {
    let calls = 0;
    const fake = (async () => (calls++, new Response(JSON.stringify({ error: "rate limited" }), { status: 429, headers: { "retry-after": "1" } }))) as typeof fetch;
    const a = new OtcAgent({ apiUrl: "http://x/api", fetch: fake });
    await assert.rejects(a.get("/makers"), /rate limited/);
    assert.equal(calls, 4);
  });

  it("never resends other errors", async () => {
    let calls = 0;
    const fake = (async () => (calls++, new Response(JSON.stringify({ error: "rfq is closed" }), { status: 409 }))) as typeof fetch;
    const a = new OtcAgent({ apiUrl: "http://x/api", fetch: fake });
    await assert.rejects(a.get("/rfqs/x"), /rfq is closed/);
    assert.equal(calls, 1);
  });
});
