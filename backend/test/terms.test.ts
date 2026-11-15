import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { it } from "node:test";
import { dealId, termsFromJson } from "../src/terms.ts";

/** The backend's dealId must equal OtcEscrow.dealId(terms) = keccak256(abi.encode(terms)). Checked with Foundry's cast. */
it("dealId matches Solidity abi.encode + keccak256", (t) => {
  const terms = termsFromJson({
    buyer: "0x2222222222222222222222222222222222222222",
    seller: "0x3333333333333333333333333333333333333333",
    token: "0x1111111111111111111111111111111111111111",
    amount: "1000000000000000000000",
    payToken: "0x0000000000000000000000000000000000000000",
    price: "25000000000",
    sellerPayout: "0x4444444444444444444444444444444444444444",
    referrer: "0x0000000000000000000000000000000000000000",
    relayerFee: "5",
    deadline: "1800003600",
    salt: `0x${"01".repeat(32)}`,
  });
  let encoded: string;
  try {
    encoded = execFileSync(
      "cast",
      [
        "abi-encode",
        "f((address,address,address,uint256,address,uint256,address,address,uint256,uint64,bytes32))",
        `(${[terms.buyer, terms.seller, terms.token, terms.amount, terms.payToken, terms.price, terms.sellerPayout, terms.referrer, terms.relayerFee, terms.deadline, terms.salt].join(",")})`,
      ],
      { encoding: "utf8" },
    ).trim();
  } catch {
    t.skip("foundry cast not available");
    return;
  }
  const expected = execFileSync("cast", ["keccak", encoded], { encoding: "utf8" }).trim();
  assert.equal(dealId(terms), expected);
});
