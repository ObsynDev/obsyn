# Deploying to Railway

One Railway service runs everything public: the API under `/api` and the web app at `/`. Contracts live on Robinhood Chain; the MCP server runs on each agent's own machine.

## 1. Push to GitHub

Create an empty **private** repo on GitHub (no README), then:

```bash
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

## 2. Create the service

Railway → **New Project** → **Deploy from GitHub repo** → pick the repo. Railway reads `railway.json` and builds the `Dockerfile`.

## 3. Attach a volume

Service → **Volumes** → add one mounted at **`/data`**. The SQLite database lives at `/data/blockotc.db`. Without a volume, every redeploy wipes all bids and offers.

Keep the service at **1 replica**: SQLite is single-writer.

## 4. Variables

| Variable | Value |
|---|---|
| `CHAIN_ID` | `4663` |
| `RPC_URL` | `https://rpc.mainnet.chain.robinhood.com` (or a provider RPC) |
| `PUBLIC_URL` | `https://<your-domain>` (used in share links) |
| `ESCROW_ADDRESS` | from `script/Deploy.s.sol`, once deployed |
| `USDG_ADDRESS` | official USDG on Robinhood Chain |
| `RELAYER_PRIVATE_KEY` | a dedicated hot key with a little ETH (optional; enables ghost mode) |
| `RELAYER_MIN_FEE_ETH` / `RELAYER_MIN_FEE_USDG` | optional, base units |
| `PLATFORM_TOKEN_ADDRESS` | $OBSYN contract address, once it launches. The site shows it everywhere (token section, docs, roadmap) with no rebuild |
| `PLATFORM_TOKEN_PONS_URL` | optional, the token's Pons page (https) for the "Buy on Pons" button |
| `PLATFORM_TOKEN_DISCOUNT_MIN` | optional, whole tokens a holder needs for the 0.5% fee discount (match what you set in `setPlatformToken`) |

`PORT` is set by Railway automatically. Mark `RELAYER_PRIVATE_KEY` as sealed.

Until `ESCROW_ADDRESS` is set the site runs, bids and sealed offers work, but deals can't settle.

## 5. Domain

Service → **Settings → Networking → Generate Domain** (or add your own). Then check:

- `https://<domain>/api/health` returns `"ok": true`
- `https://<domain>/` loads the app

## Agents and SDK against the deployed API

- MCP: `OBSYN_API=https://<domain>/api`
- SDK: `import { BlockOtc } from "https://<domain>/api/sdk/obsyn.mjs"` and `new BlockOtc({ apiUrl: "https://<domain>/api" })`
