// Pack the MCP server as an MCPB bundle (a zip with manifest.json, the server file and an icon),
// the format MCP clients install in one click and the MCP Registry lists.
//   npm run build:mcp && node scripts/build-mcpb.mjs  ->  packages/obsyn-mcp/dist/obsyn-mcp-<version>.mcpb
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const manifest = JSON.parse(readFileSync(at("../../packages/obsyn-mcp/mcpb/manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(at("../../packages/obsyn-mcp/package.json"), "utf8"));
if (manifest.version !== pkg.version) throw new Error(`manifest ${manifest.version} != package ${pkg.version}`);

const entries = [
  ["manifest.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n")],
  ["server/obsyn-mcp.mjs", readFileSync(at("../../packages/obsyn-mcp/bin/obsyn-mcp.mjs"))],
  ["icon.png", readFileSync(at("../../packages/obsyn-mcp/mcpb/icon.png"))],
  ["LICENSE", readFileSync(at("../../packages/obsyn-mcp/LICENSE"))],
];

// A plain zip (deflate), with a fixed timestamp so the same input always gives the same file and hash.
const DOS_TIME = 0, DOS_DATE = (2026 - 1980) << 9 | 1 << 5 | 1;
const local = [], central = [];
let offset = 0;
for (const [name, data] of entries) {
  const nameBuf = Buffer.from(name);
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(0x0800, 6); // UTF-8 names
  head.writeUInt16LE(8, 8); // deflate
  head.writeUInt16LE(DOS_TIME, 10);
  head.writeUInt16LE(DOS_DATE, 12);
  head.writeUInt32LE(crc, 14);
  head.writeUInt32LE(packed.length, 18);
  head.writeUInt32LE(data.length, 22);
  head.writeUInt16LE(nameBuf.length, 26);
  local.push(head, nameBuf, packed);
  const dir = Buffer.alloc(46);
  dir.writeUInt32LE(0x02014b50, 0);
  dir.writeUInt16LE(0x031e, 4); // made by unix, so the mode below is honoured
  dir.writeUInt16LE(20, 6);
  dir.writeUInt16LE(0x0800, 8);
  dir.writeUInt16LE(8, 10);
  dir.writeUInt16LE(DOS_TIME, 12);
  dir.writeUInt16LE(DOS_DATE, 14);
  dir.writeUInt32LE(crc, 16);
  dir.writeUInt32LE(packed.length, 20);
  dir.writeUInt32LE(data.length, 24);
  dir.writeUInt16LE(nameBuf.length, 28);
  dir.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  dir.writeUInt32LE(offset, 42);
  central.push(dir, nameBuf);
  offset += head.length + nameBuf.length + packed.length;
}
const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

const zip = Buffer.concat([...local, centralBuf, end]);
const outDir = at("../../packages/obsyn-mcp/dist/");
mkdirSync(outDir, { recursive: true });
const out = `${outDir}obsyn-mcp-${manifest.version}.mcpb`;
writeFileSync(out, zip);
console.log("built", out);
console.log("sha256", createHash("sha256").update(zip).digest("hex"));
