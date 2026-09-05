# Abliterated pricing

Suggested list prices for the desktop product. Subject to change when Stripe goes live.

## Plans

| Plan | Price | Highlights |
| --- | ---: | --- |
| **Free** | $0 | 1 workspace, basic chat, bridge, **1 MCP**, Jobs concurrency **1**, Featherless.ai catalog (no built-in token pool), **Free · Upgrade** watermark |
| **Starter** | **$19/mo** | 1 workspace, 1 MCP, Jobs concurrency **1**, built-in unrestricted model **1M tokens/mo**, watermark |
| **Pro** | **$29/mo** or **$249/yr** | Unlimited MCP, Jobs concurrency **up to 4**, **Plan mode**, built-in unrestricted model **3M tokens/mo**, no watermark |
| **Team** | **$99/mo per seat** | Everything in Pro + shared seats + built-in unrestricted model **10M tokens/mo per seat** |

Yearly Pro is about two months free vs monthly.

## Activate a key

1. Open **Settings — License / Plan**.
2. Paste a key (`ABLIT-PRO,  / `ABLIT-TEAM,  ) and click **Activate**.
3. Empty key = Free.

**Stub test keys** (no payment): `ABLIT-PRO-TEST-0001` (Pro), `ABLIT-TEAM-TEST-0001` (Team), `ABLIT-ADMIN` / `ABLIT-DEV-UNLOCK` (Admin / full usage), `ABLIT-FREE` (force Free gates). Local admin login: `admin` / `abliterated`. Vite DEV auto-unlocks Admin.

## What's next

Stripe Checkout + signed keys + customer portal. See [`PRODUCT.md`](PRODUCT.md).
