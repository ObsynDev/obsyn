// Bundles the plugin (with the Obsyn SDK, viem and tweetnacl inlined) into dist/index.js.
// @elizaos/core stays external: the plugin only imports its types.
import { build } from "esbuild";
import { writeFileSync } from "node:fs";

const banner = [
  "// plugin-obsyn: elizaOS plugin for Obsyn (https://obsyn.trade). MIT.",
  // tweetnacl calls require("crypto"): give the ESM bundle a real require
  'import { createRequire as __obsynRequire } from "node:module";',
  "const require = __obsynRequire(import.meta.url);",
].join("\n");

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "dist/index.js",
  external: ["@elizaos/core"],
  legalComments: "none",
  banner: { js: banner },
});
writeFileSync(
  "dist/index.d.ts",
  `import type { Action, IAgentRuntime, Plugin } from "@elizaos/core";
export declare const listBlocks: Action;
export declare const postBlock: Action;
export declare const sendOffer: Action;
export declare const getOffers: Action;
export declare const acceptOffer: Action;
export declare const deposit: Action;
export declare const dealStatus: Action;
export declare const obsynPlugin: Plugin;
/** The plugin's Obsyn SDK client for this runtime. */
export declare function obsynFor(runtime: IAgentRuntime): unknown;
export default obsynPlugin;
`,
);
console.log("built dist/index.js");
