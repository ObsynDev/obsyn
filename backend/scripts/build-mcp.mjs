// Bundle the MCP server into one runnable file for the obsyn-mcp npm package.
//   npm run build:mcp   ->  packages/obsyn-mcp/bin/obsyn-mcp.mjs
import { build } from "esbuild";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../../packages/obsyn-mcp/bin/obsyn-mcp.mjs", import.meta.url));
await build({
  entryPoints: [fileURLToPath(new URL("../src/mcp/stdio.ts", import.meta.url))],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  legalComments: "none",
  // some dependencies are CommonJS and call require(); give the ESM bundle a real one
  banner: { js: '#!/usr/bin/env node\nimport { createRequire as __obsynRequire } from "node:module";\nconst require = __obsynRequire(import.meta.url);' },
});
chmodSync(out, 0o755);
console.log("built", out);
