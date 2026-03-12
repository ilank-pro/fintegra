# fintegra / riseup-cli — Claude Init File

## Project Identity

**`riseup-cli`** (v0.3.0, MIT) — an unofficial Node.js/TypeScript CLI tool that
reverse-engineers the internal REST API of [RiseUp](https://input.riseup.co.il),
an Israeli personal finance aggregator (bank accounts, credit cards, investments).
Also installable as a Claude Code AI skill for natural-language finance queries.

**Project root:** `/Users/ilankor/Documents/projects/fintegra/riseup-cli-main/`

There is **no server, no database, no frontend**. Pure HTTP client + terminal
rendering.

---

## Architecture

```
src/cli.ts                   ← Commander.js CLI entry (all commands wired here)
src/index.ts                 ← Library barrel export

src/auth/
  BrowserLogin.ts            ← Playwright Chrome login → extracts cookies + commitHash
  SessionManager.ts          ← Read/write/cache ~/.config/riseup-cli/session.json (0600)

src/client/
  RiseUpClient.ts            ← API facade with namespaced sub-clients
  http.ts                    ← native fetch wrapper; injects Cookie + COMMIT-HASH headers
  types.ts                   ← All TS interfaces for API response shapes

src/commands/
  auth / balance / spending / transactions / income / trends / progress
  plans / insights / account / skill / helpers / budget-helpers

src/formatters/              ← table.ts, currency.ts, json.ts (stdout only)
src/utils/
  config.ts                  ← BASE_URL, DEFAULT_COMMIT_HASH, XDG paths
  dates.ts                   ← parseMonth(), offsetMonth()
  errors.ts                  ← RiseUpError → AuthError / ApiError / NetworkError
src/data/SKILL.md            ← Claude Code skill definition
```

### Auth Flow
1. `riseup login` → visible Chrome launched (automation flags disabled to bypass
   Google OAuth bot detection: `--disable-blink-features=AutomationControlled`,
   `ignoreDefaultArgs: ["--enable-automation"]`)
2. User completes interactive login (Google OAuth + SMS OTP)
3. All cookies for `input.riseup.co.il` scraped → serialized as raw `Cookie:` string
4. Next.js build hash (`COMMIT-HASH`) scraped from DOM
5. Written to `~/.config/riseup-cli/session.json` with `chmod 0600`
6. Every API call injects cookies verbatim + `RISEUP-PLATFORM: WEB`

### Data Flow (per command)
```
riseup <cmd> → withClient() → SessionManager.load() → RiseUpClient
    → HttpClient.getJson(path) → fetch("https://input.riseup.co.il/api/…")
    → full response → filter/group in memory → print table or JSON to stdout
```
All filtering is **client-side** — full datasets always fetched.

### RiseUp API Endpoints
| Endpoint | Data |
|----------|------|
| `/api/logged-in/` | Session check |
| `/api/budget/current` | Current month budget + all transactions |
| `/api/budget/{date}/{count}` | Historical budgets |
| `/api/budget/oldest` | Oldest available budget date |
| `/api/current-balance` | Bank account balances |
| `/api/current-credit-card-debt` | Credit card debt per card |
| `/api/plans` | Savings goals |
| `/api/insights/all` | AI-generated financial insights |
| `/api/credentials-settings` | Connected bank/card configuration |
| `/api/credentials-info` | Credential status + last scrape times |
| `/api/creds-to-accounts` | Credential → account number mappings |
| `/api/subscription` | Billing/subscription details |
| `/api/subscription-state-simplified` | Subscription state |
| `/api/cashflow-start-day` | Budget cycle reset day |
| `/api/restricted-customer/session-data` | PII: name, email, phone |
| `/api/aggregator/financial-summary` | Investments, loans, mortgages |
| `/api/hamster/cashflow-trends` | Fixed vs variable expense trends |
| `/api/hamster/customer-progress` | Savings metrics + recommendations |

---

## Security Findings

### HIGH

**H1 — Plaintext credential storage**
`src/auth/SessionManager.ts:68`
Auth cookies written to disk as unencrypted JSON. `0o600` permissions protect
from other users but not same-user processes, backup tools (Dropbox, Time Machine,
iCloud), or memory-scraping attacks.
→ Remediate: OS keychain (macOS Keychain / `node-keytar`).

**H2 — All domain cookies forwarded on every request**
`src/client/http.ts:128`
The full serialized cookie string (auth token + analytics + A/B test cookies)
is sent on every API call. No whitelist filtering to `__Host-auth-token` only.
→ Remediate: Filter cookie string before injection; keep only `__Host-auth-token`.

**H3 — Cookie forwarding on followed redirects**
`src/client/http.ts:74`
`fetch()` uses `redirect: "follow"`. Same-origin redirects forward the `Cookie`
header, creating a credential-forwarding risk if the upstream API is compromised.
→ Remediate: Use `redirect: "manual"`, verify redirect target before following.

### MEDIUM

**M1 — Session expiry not enforced**
`src/auth/SessionManager.ts:86-90`
`isValid()` only checks file existence. The stored `expiresAt` field is never
compared to the current time before making API calls.
→ Remediate: Check `expiresAt` in `isValid()`, surface clear re-login prompt.

**M2 — Hardcoded version fingerprint goes stale**
`src/utils/config.ts:11`
`DEFAULT_COMMIT_HASH = "75927d0"` is sent as `COMMIT-HASH` on every request.
Stale after any RiseUp deployment until user re-logs-in.
→ Remediate: Auto-refresh hash from a public Next.js asset at startup.

**M3 — Raw API error bodies printed to terminal**
`src/client/http.ts:90-95`
Non-2xx responses include the raw body text in the thrown `ApiError` message,
which surfaces to the terminal (and shell history/logs).
→ Remediate: Truncate/sanitize error bodies; add `--debug` flag for full output.

**M4 — Google OAuth bot-detection bypass (inherent)**
`src/auth/BrowserLogin.ts:30-33`
Automation flags explicitly disabled to bypass Google's bot detection. Inherent
to the reverse-engineering approach; no full remediation without an official API.

### LOW / Informational

**L1** — `Number(opts.min)` / `Number(opts.max)` can produce silent `NaN`
(`src/commands/transactions.ts:22-23`)

**L2** — All domain cookies captured at login, not just auth token
(`src/auth/BrowserLogin.ts:58-61`)

**L3** — Session file path printed to stdout on successful login
(`src/commands/auth.ts:58`)

**L4** — No HTTPS enforcement on `baseUrl` override
(`src/client/http.ts:21`)

**L5** — Playwright browser profile at `~/.config/riseup-cli/browser-profile/`
is a second copy of sensitive session state, less explicitly protected than
`session.json`

**L6** — `~/.claude/skills/riseup/SKILL.md` not integrity-verified; could be
substituted by an attacker with write access to inject commands into Claude sessions

---

## Sensitive Data the App Handles

All data is fetched from RiseUp's API and held in memory per-invocation.
With `--json` flag, it is also written to stdout (and potentially shell logs):

- Full name, email, phone number (`session-data` endpoint)
- Bank account numbers and IBAN numbers
- Credit card account numbers and debt amounts
- Investment ISIN codes, unit counts, buy prices, current valuations
- `intercomUserHash` (Intercom customer identity verification token)
- Full transaction history (merchant names, amounts, dates, categories)

---

## Key Files to Know

| File | Why Important |
|------|--------------|
| `src/auth/SessionManager.ts` | Credential persistence — primary security asset |
| `src/auth/BrowserLogin.ts` | Login automation + cookie extraction |
| `src/client/http.ts` | All outbound HTTP; cookie injection, redirect, error handling |
| `src/utils/config.ts` | Hardcoded constants (BASE_URL, DEFAULT_COMMIT_HASH) |
| `src/client/types.ts` | Complete TS type definitions for all API responses |
| `src/commands/skill.ts` | Claude Code skill installer |
| `src/commands/transactions.ts` | Input validation gap (NaN on min/max) |

---

## Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `playwright` | ^1.58.2 | Chrome browser automation (login only) |
| `chalk` | ^5.4.1 | Terminal colors |
| `cli-table3` | ^0.6.5 | ASCII tables |
| `commander` | ^13.1.0 | CLI argument parsing |

Node.js ≥ 22 required. ESM only. Build: `tsup` (entry: `src/cli.ts` + `src/index.ts`).
