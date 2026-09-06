# Abliterated - product brief

**Brand:** Abliterated / abliteration.ai
**Product:** Local agent IDE - chat + tools + Jobs + MCP for OpenAI-compatible endpoints.
**Distribution:** Electron desktop (macOS dmg/dir; Windows NSIS + portable).
**Monetization:** Freemium license keys; Sign up / Log in + in-app Stripe + Solana + redeem via abliterated.app APIs (secrets on site).

---

## Positioning

Abliterated is the **local-first agent workbench** for developers who want Cursor-class agent loops without locking inference to one cloud.

| Promise | How we deliver |
| --- | --- |
| Your machine, your files | Localhost bridge (ws://127.0.0.1:17322) - never public |
| Your models | Built-in `abliteration-model` / `abliteration-model-large` (100% unrestricted) + Featherless.ai abliterated catalog (e.g. huihui/zetasepic Qwen2.5-72B, Llama-3.3-70B, R1-Distill-70B, Qwen2.5-Coder-32B) |
| Real agent work | Multi-turn tools, Plan mode, Jobs, MCP stdio |
| No telemetry | localStorage only; no product analytics |

**One-liner:** Local agent IDE for abliterated models - freemium desktop, Featherless.ai frontier uncensored models.

---

## ICP

1. Indie / power-user developers on local or specialty models.
2. Small teams wanting seat licenses (Team tier).
3. Privacy-sensitive shops needing on-box file/shell tools.

---

## Pricing and tiers

See pricing.md. Free $0; Pro $29/mo or $249/yr; Team $99/mo seat.

| | Free | Starter | Pro | Team |
| --- | --- | --- | --- |
| Workspaces | 1 | 1 | Unlimited | Unlimited |
| MCP | 1 | 1 | Unlimited | Unlimited |
| Jobs concurrency | 1 | 1 | Up to 4 | Up to 4 |
| Plan mode | no | no | yes | yes |
| Built-in unrestricted model | — | Included | Included | Included |
| Included tokens / month | 0 | 1M | 3M | 10M / seat |
| Watermark | yes | yes | no | no |

Test keys: empty Free; ABLIT-PRO-XXXX-XXXX Pro; ABLIT-TEAM-XXXX-XXXX Team; ABLIT-DEV-UNLOCK Team.


---

## Packaging

Electron loads dist/index.html; spawns bridge :17322 via Electron-as-Node (ELECTRON_RUN_AS_NODE); preload ablitDesktop. Daemon is asarUnpack'd so bridge.js is a real filesystem path in packaged builds.
- Scripts: build, desktop, desktop:dev, dist:mac, dist:win, dist:win:dir
- Windows: NSIS installer (choose dir, desktop + Start Menu shortcuts) + portable .exe
- Artifacts: release/ as productName-version-os-arch.ext (unsigned for now)
- appId ai.abliteration.ide
- See package.json scripts for desktop packaging

---

## License flow

1. Activate key in Settings License / Plan
2. Stored as licenseKey in localStorage
3. Desktop mirrors via setLicense to userData
4. getLicenseState returns tier features label
5. Soft gates on Jobs MCP Plan mode

Public client pepper is not a secret; stub accepts prefixes only.

---

## Account (Sign up / Log in)

Settings → **Account** (above License / Plan):

- Logged out: Sign up or Log in with email + password; advanced loginId + deviceId path for redeem-created accounts.
- Logged in: shows email, loginId, Log out.
- Client calls `POST /api/signup` and `POST /api/login` on **billingSiteUrl** (default https://abliterated.app) with a stable `deviceId` (Electron userData / settings).
- On success: stores `accountEmail`, `loginId`, `deviceId`, `accountLoggedIn`; if `licenseKey` is returned, activates like checkout.
- Checkout receipt email prefers `accountEmail` when set.

## In-app checkout

Checkout is **in-app** (Settings → License / Plan): card (Stripe Checkout session), Solana USDC, and access-code redeem.

- The desktop IDE calls public HTTPS APIs on **abliterated.app** (`POST /api/checkout`, `GET /api/checkout/session`, `POST|GET /api/checkout/solana`, `POST /api/checkout/solana/confirm`, `POST /api/redeem`, plus `POST /api/signup` / `POST /api/login`).
- Stripe secrets, webhooks, and license minting stay on the **site** — never embed payment provider secrets in this client repo.
- After payment, the IDE polls until a license key appears, then activates via the existing `licenseKey` / `persistLicense` path. Optional deep link: `abliterated://license?key=…`.

## Roadmap to payments

1. ~~Checkout links for Pro and Team~~ — in-app checkout shipped (card + Solana + redeem)
2. Webhook issues signed license keys (site)
3. Customer portal
4. Optional online expiry check
5. Notarization, auto-update, Windows signing

No payment provider secrets in this repo.

---

## Competitive notes

| Player | Angle |
| --- | --- |
| Cursor | Hosted agents; we win on Featherless.ai abliterated catalog / local desktop |
| Continue / Cline | OSS extensions; we ship full workbench + desktop SKU |
| Claude Code / Codex CLI | CLI-first; we are GUI + MCP + Jobs |
| Windsurf / others | Similar agents; local bridge + freemium desktop |

Moat: abliteration.ai alignment, local bridge trust, freemium to Pro.
