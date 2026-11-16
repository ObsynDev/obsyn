import { BRAND } from "../lib/brand.tsx";
import { Copy, Link } from "../lib/ui.tsx";

const TOOLS: [string, string][] = [
  ["otc_info", "Chain, contract, fees, relayer, and which wallet the agent signs with"],
  ["otc_list_bids", "Open bids and sell listings, with side, size and time left"],
  ["otc_create_bid", "Post a buy bid: token, amount, ETH or USDG, reply window"],
  ["otc_create_listing", "Sell privately: list a block, buyers answer with sealed bids"],
  ["otc_get_offers", "Decrypt answers locally, with verified and hasFunds flags"],
  ["otc_send_offer", "Answer a posting with a sealed, signed price (ghost mode for sellers)"],
  ["otc_accept_offer", "Fix the deal with one answer; refuses unverified answers by default"],
  ["otc_deal_status", "Accepted? Who has deposited? Time left? Settled or refunded?"],
  ["otc_deposit", "Deposit your side; signs, or returns unsigned transactions"],
  ["otc_refund", "Return deposits after the funding deadline"],
];

const ROUTES: [string, string][] = [
  ["GET /api/rfqs", "Open bids and listings (?side=buy|sell, ?token=)"],
  ["POST /api/rfqs", "Post a bid or listing; returns a capability token once"],
  ["POST /api/rfqs/{id}/quotes", "Send a sealed answer (ciphertext only)"],
  ["GET /api/rfqs/{id}/quotes", "Poster reads sealed answers (Bearer token)"],
  ["POST /api/rfqs/{id}/accept", "Poster fixes the on-chain terms"],
  ["GET /api/quotes/{id}", "Answerer checks status; gets terms once accepted"],
  ["POST /api/relay/deposit", "Gasless ghost-mode deposit via the relayer"],
  ["GET /api/token/{address}", "ERC-20 facts read on-chain by the server"],
];

export function Developers() {
  const origin = window.location.origin;
  const mcp = `mcp-client add ${BRAND.name.toLowerCase()} \\
  -e OBSYN_API=${origin}/api \\
  -e OBSYN_PRIVATE_KEY=0x... \\
  -- node backend/src/mcp/stdio.ts`;
  const sdk = `import { Obsyn } from "${origin}/api/sdk/obsyn.mjs";

const otc = new Obsyn({ apiUrl: "${origin}/api", privateKey }); // key optional

// buy side
const bid = await otc.createBid({ token, amount: "25000", payWith: "USDG", replyMinutes: 60 });
const offers = await otc.getOffers(bid.bidId);       // decrypted here, verified first
await otc.acceptOffer({ bidId: bid.bidId, offerId: offers[0].offerId, fundingMinutes: 60 });
await otc.deposit({ bidId: bid.bidId });              // signs, or returns unsigned txs

// sell side
const listing = await otc.createListing({ token, amount: "50000", payWith: "ETH", replyMinutes: 60 });`;

  return (
    <div className="doc">
      <span className="label">Developers & agents</span>
      <h1>
        Build on the desk. <span className="serif">Stay private.</span>
      </h1>
      <p className="lede">
        Everything the app does is available to code and AI agents: an MCP server, a JavaScript SDK and a documented REST API. Sealed
        answers are encrypted and decrypted on your side, never on ours.
      </p>

      <div className="pill-row">
        <a className="pill info" href="/api/openapi.json" target="_blank" rel="noreferrer">
          openapi.json
        </a>
        <a className="pill info" href="/api/sdk/obsyn.mjs" target="_blank" rel="noreferrer">
          obsyn.mjs
        </a>
        <a className="pill info" href="/api/health" target="_blank" rel="noreferrer">
          /api/health
        </a>
      </div>

      <section className="doc-sect">
        <span className="num">01 · MCP</span>
        <h2>Give an AI agent the desk</h2>
        <p className="muted">
          The MCP server runs on the agent's own machine. That is deliberate: offers are encrypted there and the wallet key never
          leaves it. Without a key, deposit tools return unsigned transactions for a human to send.
        </p>
        <div className="cmd-bar block-cmd">
          <pre>{mcp}</pre>
          <Copy text={mcp.replace(/\\\n\s*/g, "")} />
        </div>
        <div className="table-wrap">
          <table className="plain">
            <tbody>
              {TOOLS.map(([t, d]) => (
                <tr key={t}>
                  <td className="mono ok">{t}</td>
                  <td className="muted">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="doc-sect">
        <span className="num">02 · SDK</span>
        <h2>One import, both sides</h2>
        <p className="muted">Works in browsers and Node. Secrets live in memory by default; in Node, pass a FileStore to keep them on disk.</p>
        <div className="cmd-bar block-cmd">
          <pre>{sdk}</pre>
          <Copy text={sdk} />
        </div>
      </section>

      <section className="doc-sect">
        <span className="num">03 · API</span>
        <h2>Plain HTTP, no accounts</h2>
        <p className="muted">
          Creating a bid, listing or answer returns a capability token. Send it as <span className="mono">Authorization: Bearer …</span>{" "}
          to manage that item. CORS is open: there are no cookies.
        </p>
        <div className="table-wrap">
          <table className="plain">
            <tbody>
              {ROUTES.map(([r, d]) => (
                <tr key={r}>
                  <td className="mono">{r}</td>
                  <td className="muted">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="doc-sect">
        <span className="num">04 · RULES</span>
        <h2>Treat answers as hostile input</h2>
        <ul className="checks-list">
          <li>Answers are signed (EIP-191) by the wallet they name; check before accepting</li>
          <li>Compare accepted terms with what you sent before depositing</li>
          <li>The side that posted should prefer to deposit after the other side</li>
        </ul>
        <Link to="/security" className="text-link">
          Security model →
        </Link>
      </section>
    </div>
  );
}
