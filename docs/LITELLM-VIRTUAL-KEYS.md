# LiteLLM virtual keys ↔ Abliterated licenses

**Status:** largely implemented on abliterated-site (`src/lib/litellm.ts`, `f7b1d86`+) — this note is the wiring map  
**Audience:** wire paid inference kill-switch through LiteLLM Proxy in front of `api.abliteration.ai`  
**Related:** [`LICENSE-PROTECTION.md`](./LICENSE-PROTECTION.md) · site `licenseMint.ts` · `deviceBindings.ts` · Stripe webhook


## Implemented surfaces (site)

| Piece | Path |
| --- | --- |
| Admin helpers | `src/lib/litellm.ts` (`ensureTenantVirtualKey`, `blockVirtualKey`, `updateVirtualKeyBudget`, `addCreditBudget`) |
| Stripe mint / delete / refund-dispute | `src/app/api/webhooks/stripe/route.ts` |
| Redeem | `src/app/api/redeem/route.ts` |
| Crypto settle | `src/lib/cryptoSettle.ts` |
| Desktop credentials | `POST /api/gateway/credentials` |
| Admin block | `POST /api/gateway/admin` |
| Compose + config | `litellm/` |
| Env | site `.env.example` `LITELLM_*`, `GATEWAY_*` |

Still open: desktop Platform provider consuming `/api/gateway/credentials`; token-accurate budgets (USD approx today); always-online validate from LICENSE-PROTECTION.md.

## Goal

Server fails closed for **inbuilt abliteration.ai** usage. Cracking the IDE soft gates must not burn your LiteLLM spend. Local Spark / Featherless / BYO endpoints stay out of scope.

## Invariants

1. **`LITELLM_MASTER_KEY` never leaves the site/server.** Not in Electron, not in `VITE_*`, not in `asar`.
2. Desktop only ever holds a **per-customer virtual key** (`sk-…`) issued after paid entitlement.
3. **`ABLIT-*` license key** remains the product entitlement id; the LiteLLM key is the inference credential.
4. Revoke / refund / subscription death → **block or delete** the virtual key. Next `/v1/chat/completions` fails even if the client is patched.
5. Device bind (LICENSE-PROTECTION) still applies for seat sharing; LiteLLM budgets apply for token theft.

## Current mint hooks (reuse)

| Event | Today | Add |
| --- | --- | --- |
| Stripe `checkout.session.completed` (subscription) | `mintAndPersist` in `webhooks/stripe/route.ts` | After mint: `ensureLitellmKeyForLicense(minted)` |
| Checkout success page / session poll | Shows `minted.key` | Optionally return `inferenceKey` only via authenticated validate later (prefer not emailing LiteLLM keys forever) |
| Crypto settle / redeem | `mintAndPersist` / accessCodes mint | Same `ensureLitellmKeyForLicense` |
| Credit pack settle | `addCredits` ledger | `POST /key/update` temp budget **or** dedicated top-up key linked to same `user_id` |
| `customer.subscription.deleted` / refund / dispute | Mostly log today | `blockLitellmKey(licenseKey)` |
| Admin revoke | Planned `POST /api/license/revoke` | Block LiteLLM key in same transaction |

## Data model (extend, don’t fork)

Extend `data/licenses.jsonl` rows (or sibling `data/litellm-keys.jsonl`) with:

```json
{
  "licenseKey": "ABLIT-PRO-XXXX-XXXX",
  "email": "a@b.co",
  "plan": "pro_monthly",
  "sessionId": "cs_…",
  "litellmKeyHash": "sha256…",
  "litellmKeyId": "…",
  "litellmKeyPrefix": "sk-…xxxx",
  "litellmUserId": "ablit:email-or-loginId",
  "budgetTokens": 3000000,
  "budgetDuration": "30d",
  "status": "active",
  "createdAt": "…"
}
```

**Store only a hash / last-4 of the virtual key at rest** after first delivery if possible. If you must re-show the key, keep it encrypted with a site-only secret — never commit plaintext keys.

Extend `DeviceBinding` later with `litellmKeyHash` so validate can confirm the desktop’s inference key matches the bound seat.

## Budget mapping

From site `PLAN_INCLUDED_TOKENS`:

| Plan | Tokens / period | LiteLLM suggestion |
| --- | --- | --- |
| starter_monthly | 1M / 30d | `max_budget` ≈ cost(1M) **or** token budget if you track tokens in a custom callback |
| pro_monthly / yearly | 3M / 30d (yearly still monthly pool) | same |
| team_monthly | 10M **per seat** / 30d | team key or per-seat keys under `team_id` |
| credit packs | 5M / 20M / 50M | `temp_budget_increase` + expiry, or raise key budget once |

LiteLLM native `max_budget` is **USD**. Options:

- **A (simple):** convert tokens → USD with a fixed internal rate; reset with `budget_duration: "30d"`.
- **B (accurate):** custom spend callback counting tokens; still use virtual keys for auth/block.
- **C:** model aliases + per-key `models` allowlist so Free keys cannot hit paid model names.

Prefer **A + allowlist** to ship; refine to B later.

## Site module sketch

`src/lib/litellmAdmin.ts` (server-only):

```ts
// env: LITELLM_PROXY_BASE_URL, LITELLM_MASTER_KEY
// POST {base}/key/generate  Authorization: Bearer $MASTER
// POST {base}/key/block
// POST {base}/key/update   // credits / renew

ensureLitellmKeyForLicense({
  licenseKey, email, plan, seats, loginId?
}): { key: string; keyId: string }

blockLitellmKeyForLicense(licenseKey): void

addCreditBudget(licenseKey, tokens): void  // packs
```

`/key/generate` body (illustrative):

```json
{
  "user_id": "ablit:USER",
  "models": ["abliterated-model", "abliterated-model-large"],
  "max_budget": 12.0,
  "budget_duration": "30d",
  "metadata": {
    "ablit_license_key": "ABLIT-PRO-…",
    "ablit_plan": "pro_monthly",
    "ablit_session_id": "cs_…"
  }
}
```

## Desktop delivery (two phases)

### Phase 1 — bootstrap (fast)

1. After Stripe/redeem, success page still shows `ABLIT-*`.
2. Desktop activates license as today.
3. New `POST /api/license/inference-key` (auth: licenseKey + deviceId after bind, or loginId + deviceId):
   - validates entitlement
   - returns `{ litellmKey, baseUrl: "https://api.abliteration.ai/v1" }` **once** (or rotates)
4. Desktop stores inference key in Electron `userData` (not `settings` synced plaintext if avoidable).
5. Builtin provider uses that key — **empty default**; no `VITE_ABLITERATED_TOKEN`.

### Phase 2 — harden

1. `POST /api/license/validate` includes `inferenceStatus: active|blocked`.
2. Periodic re-validate; on revoke → wipe local inference key + soft Free gates.
3. Optional key rotation / short TTL virtual keys (LiteLLM regenerate + grace).

## Stripe webhook pseudocode

```ts
// checkout.session.completed (subscription)
const minted = mintAndPersist({ email, plan, sessionId, seats })
if (minted.created) {
  await ensureLitellmKeyForLicense({
    licenseKey: minted.key,
    email,
    plan: minted.plan,
    seats: minted.seats,
  })
  // email still sends ABLIT-* only; inference key via IDE after device bind
}

// customer.subscription.deleted | charge.refunded | charge.dispute.created
await blockLitellmKeyForLicense(licenseKeyFromCustomerOrSession)
```

## Credits packs

Crypto credits already land in a token ledger (`credits.ts`). Bridge:

1. On settle → `addCreditBudget(licenseKey, pack.tokens)` **or** mint a separate top-up key.
2. Prefer **one key per customer** with budget bumps so the IDE doesn’t juggle credentials.

## Threat notes

| Attack | Mitigation |
| --- | --- |
| Shared `ABLIT-*` on many machines | Device bind + validate (LICENSE-PROTECTION) |
| Extract virtual key from one machine | Budget + block on abuse; rotate; don’t put master key in client |
| Patch IDE soft gates | LiteLLM still requires valid virtual key |
| Replay old virtual key after refund | `/key/block` on revoke; validate fails |

## Env (site only)

```
LITELLM_PROXY_BASE_URL=https://api.abliteration.ai   # or internal proxy URL
LITELLM_MASTER_KEY=sk-...
LICENSE_SIGNING_SECRET=...
```

## Implementation order

1. `litellmAdmin.ts` + env + generate/block smoke against staging proxy  
2. Hook Stripe mint + subscription deleted / refund  
3. Hook redeem + crypto settle + credit packs  
4. `POST /api/license/inference-key` + desktop store/use  
5. Remove any baked `VITE_ABLITERATED_TOKEN` defaults; rotate leaked keys  
6. Fold into LICENSE-PROTECTION validate/revoke checklist  

## Non-goals

- Do not put master key in the IDE “temporarily.”  
- Do not block Spark / Featherless / custom base URLs via LiteLLM.  
- Do not brick offline Free chat to local models for proxy blips.
