# License protection — Agent checklist (anti-casual-resale)

**Audience:** coding agent implementing anti-casual-resale protections for Abliterated IDE + site.  
**Repo:** Abliterated IDE (`flak3dd/abliterated`) + marketing site (`abliterated-site`).  
**Tone:** imperative. Treat every `YOU MUST` / `DO NOT` as a hard rule.  
**Honesty:** this is **not uncrackable**. Stack = **license key + device bind + server revoke + copyright/EULA**. Goal is deter casual resale and enable remote kill — not DRM theater.

Paste this file as a CloudAgent launch appendix when implementing validate / device bind / revoke.

---

## 1. Goals & non-goals

### Goals

1. **Deter casual resale** of paid seats / gift codes (one buyer → many machines / resold keys).
2. **Bind** a paid entitlement to a **deviceId** (and `loginId` when issued).
3. **Validate online** from desktop on a soft schedule so revoked / mismatched devices lose paid features.
4. **Revoke** on admin action, Stripe refund / chargeback, or subscription death.
5. Keep the product usable offline for a **grace period**, then fail soft → lock paid features (not brick the Free tier).

### Non-goals

- DO NOT try to **hide or encrypt `asar` forever**. Anyone who owns the bits can unpack Electron apps.
- DO NOT build client-side “uncrackable” license crypto. Client pepper is public; secrets stay server-side.
- DO NOT brick Free-tier chat / bridge for network blips. Revocation targets **paid** features.
- DO NOT replace the existing stub prefix license flow overnight — **extend** it with online validate.
- DO NOT add product telemetry or phone-home beyond license validate / revoke paths described here.

---

## 2. Current building blocks (REUSE — do not reinvent)

| Piece | Where | What it already does |
| --- | --- | --- |
| **Stripe checkout + webhook** | site `POST /api/checkout`, `POST /api/webhooks/stripe` | Mints `ABLIT-*` keys via `licenseMint.ts` on `checkout.session.completed` |
| **Access codes** | site `src/lib/accessCodes.ts`, `POST /api/redeem`, UI `/redeem` | One-time codes; mint key; bind first `deviceId` |
| **loginId** | site `mintLoginId()` in `deviceBindings.ts` | `ABLIT-LOGIN-XXXXXXXX` issued at redeem |
| **deviceId bind** | site `data/device-bindings.json` via `deviceBindings.ts` | `{ loginId, code, email, deviceId, licenseKey, tier, plan, createdAt }` |
| **LICENSE_SIGNING_SECRET** | site env only | HMAC secret for deterministic signed keys in `mintLicenseKey` |
| **Site APIs** | `POST /api/redeem`, `POST /api/login` | Redeem + re-fetch key when `loginId` + `deviceId` match |
| **Desktop license** | IDE `src/lib/license.ts` | Tier resolve, soft gates (Jobs / MCP / Plan / watermark / token pool) |
| **Desktop store** | Electron `ablit:getLicense` / `ablit:setLicense` → `userData/license.json` | Persist key on disk; renderer mirrors `settings.licenseKey` |
| **Legal** | site `/legal/terms`, `/legal/privacy` | Terms already exist — cite; do not invent a parallel EULA file in IDE repo unless product asks |
| **Pricing** | IDE `docs/PRODUCT.md`, `docs/pricing.md` | Free / Starter / Pro / Team list prices + stub keys |

**YOU MUST** extend `deviceBindings` + Stripe webhook + desktop `license.ts` rather than inventing a second binding store or a second tier table.

---

## 3. Architecture (target)

```
Desktop IDE (soft online validate)
  │  launch + periodic timer
  │  POST { loginId | licenseKey, deviceId }
  ▼
Site  POST /api/license/validate
  │  lookup binding in data/device-bindings.json (+ revoked flag / revoked store)
  │  → active | revoked | mismatch | unknown
  ▼
Desktop applies soft gates (reuse getLicenseState / features)
  │
Admin / Stripe ──► POST /api/license/revoke (admin) or webhook refund/chargeback
                   marks binding revoked; next validate fails
```

| Surface | Responsibility |
| --- | --- |
| **Desktop** | Stable `deviceId`; store `loginId` + `licenseKey`; call validate; grace offline; lock paid features on revoke/mismatch after grace |
| **Site validate** | Authoritative status for a `(loginId|licenseKey, deviceId)` pair |
| **Site revoke** | Admin-authenticated kill; Stripe refund/chargeback → revoke binding |
| **data/** | `device-bindings.json`, `licenses.jsonl`, plus revoked records (extend schema or sibling `revocations.jsonl`) — **gitignored** |

**Invariant:** server decides **active / revoked / mismatch**. Client only enforces soft gates.

---

## 4. Implementation checklist M0–M3

### M0 — Legal notice + build identity (no new crypto)

- [ ] **EULA / copyright notice** visible in-app (About or first-run / Settings → License): product is licensed, not sold; one device unless Team seats; reverse-engineering for circumvention prohibited where law allows; cite site Terms.
- [ ] Confirm site **Terms** already cover license / acceptable use (`/legal/terms`). Link from About.
- [ ] **About** (or Settings footer) shows **build id**: `package.json` version + git short SHA or CI build number (e.g. `1.0.0+abc1234`). YOU MUST make this copy-pasteable for support.
- [ ] DO NOT ship `LICENSE_SIGNING_SECRET` or Stripe secrets in the desktop binary.

### M1 — `POST /api/license/validate`

Implement on **abliterated-site** (Node runtime, same patterns as `/api/login`).

**Request**

```json
{ "loginId": "ABLIT-LOGIN-…", "deviceId": "…" }
```

or

```json
{ "licenseKey": "ABLIT-PRO-…", "deviceId": "…" }
```

(`loginId` preferred when present; `licenseKey` alone allowed for Stripe-minted keys not yet tied to loginId — then bind-or-match per product rules.)

**Response (locked shapes)**

| `status` | HTTP | Meaning |
| --- | --- | --- |
| `active` | 200 | Binding exists, not revoked, `deviceId` matches |
| `revoked` | 200 or 403 | Entitlement revoked (refund / admin / chargeback) |
| `mismatch` | 200 or 403 | Known login/key but `deviceId` ≠ bound device |
| `unknown` | 404 | No binding / no license record |

Example body:

```json
{ "status": "active", "tier": "pro", "loginId": "ABLIT-LOGIN-…", "deviceId": "…", "plan": "pro_monthly" }
```

**YOU MUST**

- Reuse `findBindingByLoginId` / find-by-licenseKey / `deviceId` compare from `deviceBindings.ts`.
- Rate-limit by IP (same spirit as redeem).
- Never return full unrelated customer PII; email optional/omitted on validate.
- Persist a `revokedAt` / `revokedReason` on the binding (or parallel revocations file) so validate is O(1) local read.

**DO NOT** mint new keys from validate. Validate is read + status only (optional: refresh `lastSeenAt`).

### M2 — Desktop launch + periodic validate

In **Abliterated IDE** (`src/lib/license.ts` + Electron main / small helper):

- [ ] Generate **stable `deviceId`** once (UUID); store in Electron `userData` (not localStorage-only). Never regenerate on every launch.
- [ ] Persist `loginId` when user redeems / logs in via site (Settings).
- [ ] On launch: if paid tier, `POST /api/license/validate` with `{ loginId|licenseKey, deviceId }`.
- [ ] **Periodic** re-validate (e.g. every 12–24h while app open; also on resume from sleep if cheap).
- [ ] **Offline grace:** if network fails, keep last-known `active` for a fixed window (e.g. **72h**). After grace → treat as unverified: **fail soft** — downgrade soft gates to Free (watermark, Jobs/MCP caps) but keep local files / chat to BYO endpoints.
- [ ] On `revoked` or `mismatch`: immediately (or after short retry) lock paid features; show Settings message (“License revoked” / “Device mismatch — contact support or re-bind”).
- [ ] Wire UI: Settings → License shows last validate status + time + build id.

**Fail soft, then lock features** — never infinite paid offline after grace; never crash the process on 5xx.

### M3 — Stripe refund/chargeback → revoke + admin revoke

- [ ] Extend site Stripe webhook: on `charge.refunded`, `charge.dispute.created` / `charge.dispute.funds_withdrawn`, and relevant `customer.subscription.deleted` (when policy says seat ends), **revoke** bindings tied to that `sessionId` / customer email / minted key.
- [ ] Implement **`POST /api/license/revoke`** (admin): body `{ loginId? , licenseKey? , deviceId? , reason }` → mark revoked. Protect with admin secret / session (server-side only). DO NOT expose unauthenticated revoke.
- [ ] Add **admin CLI script** under site `scripts/` (e.g. `revoke-license.mjs`) that writes the same revocation path as the API (for SSH / ops). Log reason + timestamp to `data/`.
- [ ] Notify email optional (`emailNotify` type e.g. `license_revoked`) — nice-to-have, not blocker.
- [ ] Document ops runbook in this file’s Acceptance section only — no second doc required for M3.

---

## 5. Secrets that MUST stay server-side

| Secret | Where | Notes |
| --- | --- | --- |
| `LICENSE_SIGNING_SECRET` | site env | HMAC for mint; never in IDE, never in git |
| `STRIPE_SECRET_KEY` | site env | Checkout + webhook construct |
| `STRIPE_WEBHOOK_SECRET` | site env | Signature verify |
| Admin revoke token / session secret | site env | Gate `/api/license/revoke` + scripts |
| `RESEND_API_KEY` / `EMAIL_WEBHOOK_URL` | site env | Optional notify |
| Solana receive key material (if any) | site env | Pay path unrelated but same rule |

**Client-safe:** `LICENSE_CLIENT_PEPPER` in `src/lib/license.ts` (explicitly public), publishable Stripe key if used, site origin URL for validate.

**YOU MUST** keep `data/device-bindings.json`, `data/licenses.jsonl`, revocations, and `.env*` gitignored on the site.

---

## 6. What NOT to do

- DO NOT encrypt / obfuscate the Electron **asar** as “protection.” That is theater; unpack is trivial; support cost goes up.
- DO NOT embed HMAC signing secrets or admin tokens in the desktop app “to verify offline forever.”
- DO NOT treat prefix stub keys (`ABLIT-PRO-TEST-*`) as production entitlements once validate ships — gate production builds to signed/minted keys + binding.
- DO NOT allow unbounded device rebinds without admin or explicit transfer flow (casual resale vector).
- DO NOT auto-rebind on every `mismatch` — that defeats device bind. Transfer = support / admin revoke-old + redeem/login on new device.
- DO NOT phone home model prompts, file paths, or workspace contents as part of license validate.
- DO NOT break Free tier when validate URL is unreachable during grace.
- DO NOT invent a second license state machine parallel to `getLicenseState` — extend it (`onlineStatus?: 'active'|'revoked'|'mismatch'|'grace'|'unknown'`).

---

## 7. Acceptance tests

### Site

- [ ] Redeem code with `deviceId=A` → binding written; `loginId` returned.
- [ ] `POST /api/login` with same `loginId` + `deviceId=A` → 200 + key.
- [ ] `POST /api/login` with `deviceId=B` → 403 mismatch.
- [ ] `POST /api/license/validate` active path → `status: active`.
- [ ] Admin revoke → validate returns `revoked`; desktop would lock paid features.
- [ ] Second redeem same one-time code → 410; other device after bind → 403 (existing redeem rules still hold).
- [ ] Stripe refund/chargeback fixture → binding revoked; validate → `revoked`.
- [ ] Rate limit: burst validate/redeem from one IP → 429.

### Desktop

- [ ] Fresh install generates stable `deviceId`; survives restart.
- [ ] Launch with paid key + online → validate `active`; features match tier (`docs/pricing.md`).
- [ ] Airplane mode within grace → paid features remain; About still shows build id.
- [ ] Airplane mode past grace → soft Free gates; no crash; clear Settings banner.
- [ ] Server returns `revoked` → paid features lock; watermark / caps apply; local projects intact.
- [ ] Server returns `mismatch` → same lock; message explains device bind.
- [ ] About shows version + build id; Terms link works.

### Negative / honesty checks

- [ ] Unpacking asar still reveals renderer code (expected). Protection remains server revoke + law — document that in About one-liner if product wants.
- [ ] No secrets in packaged `app.asar` / env shipped to clients (`rg` release artifact for `LICENSE_SIGNING_SECRET`, `sk_live`, webhook secrets).

---

## 8. Cross-links

| Doc / surface | Why |
| --- | --- |
| Site `POST /api/redeem`, UI `/redeem` | Issue key + `loginId` + first `deviceId` bind |
| Site `POST /api/login` | Re-fetch key when device matches |
| Site `/legal/terms` | EULA / license terms already published |
| IDE [`docs/PRODUCT.md`](./PRODUCT.md) | License flow stub + roadmap to payments |
| IDE [`docs/pricing.md`](./pricing.md) | Tier prices and activate UX |
| IDE `src/lib/license.ts` | Soft gates to extend with online status |
| Site `src/lib/deviceBindings.ts`, `licenseMint.ts`, `accessCodes.ts` | Binding + mint primitives |
| Site Stripe webhook `src/app/api/webhooks/stripe/route.ts` | Hook refund/chargeback → revoke (M3) |

---

## 9. Suggested file touch list (implementer)

**Site (`abliterated-site`)**

- `src/app/api/license/validate/route.ts` (new)
- `src/app/api/license/revoke/route.ts` (new, admin)
- `src/lib/deviceBindings.ts` — revoked fields + find-by-licenseKey
- `src/app/api/webhooks/stripe/route.ts` — refund/dispute → revoke
- `scripts/revoke-license.mjs` (new)

**IDE (`flak3dd/abliterated`)**

- `src/lib/license.ts` — online status + grace
- `electron/main.mjs` — stable `deviceId` in userData; optional validate timer
- Settings / About UI — build id, validate status, Terms link

Commit messages when implementing (examples):

- `feat(site): POST /api/license/validate + revoke bindings`
- `feat(desktop): soft online license validate with offline grace`
- `feat(site): revoke on Stripe refund/chargeback`

---

## 10. Done definition

M0–M3 checkboxes above green; acceptance tests pass; **no** asar-encryption PR; secrets only on site; casual second-machine use of the same gift code / login fails validate with `mismatch` or `revoked` after admin/Stripe action.
