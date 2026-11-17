# Contributing

Thanks for looking. Issues and pull requests are welcome.

## Run it locally

```
git clone --recurse-submodules https://github.com/ObsynDev/obsyn
cd obsyn/contracts && forge build && forge test     # contracts
cd ../backend && npm ci && npm test                  # API, relayer, MCP (end-to-end tests use anvil)
cd ../web && npm ci && npm run dev                   # the site
```

Node 26 and [Foundry](https://book.getfoundry.sh/) are needed. The backend's end-to-end tests run the real `OtcEscrow` on a local anvil chain and skip themselves when anvil or the forge build output is missing.

## Branches

- `main` is what runs on obsyn.trade.
- Work happens on `dev` or a feature branch and lands through a pull request once CI passes.

## Ground rules

- **Contracts:** the deployed escrow has no admin and can't be upgraded. A change to `contracts/src` means a new deployment and a new security review, so open an issue first.
- **Privacy:** the server must never see a plaintext offer, a private link's secret or a key. Keep encryption and signing on the client.
- **Tests:** add or update a test with every behaviour change.
- **Security issues:** report privately, see [SECURITY.md](SECURITY.md).

By contributing you agree your work is released under the [MIT license](LICENSE).
