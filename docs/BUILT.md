# What is built so far

Updated 2026-11-20 (payments moved from PayPal to Cashfree; speech moved to Sarvam AI). PRD section numbers refer to [PRD.md](./PRD.md). What is left: [REMAINING.md](./REMAINING.md). Voice details: [VOICE.md](./VOICE.md). Manual test and demo script: [DEMO.md](./DEMO.md).

## 1. Summary

| Area | State |
|---|---|
| Merchant dashboard (workers, attendance, incentives, approvals, transactions) | Working |
| Cashfree Payouts (UPI transfers, beneficiaries, sync, retry, idempotent ids) | **Verified on the Cashfree sandbox (2026-11-20):** approve, send, sync and `completed` with a UTR, through the app. Failure paths other than a rejected request and a missing UPI ID are not yet exercised (see section 2) |
| Cashfree webhooks with signature verification | Implemented (signature scheme matches Cashfree's Payouts docs), **not yet tested** (needs a public URL). Polling already updates statuses without it |
| Rules engine (wage, overtime, per-unit, daily tiers, attendance bonus, versions) | Working |
| Needs Review (missing or conflicting records) | Working |
| Voice assistant (multi-step, follow-ups, spoken confirm, exact-amount checkpoint) | Working, 40 of 40 fixtures; browser microphone untested |
| Amounts in ₹ end to end (UPI payouts in INR, no conversion) | Working |
| CSV import (workers, deliveries) | Working |
| Authentication and roles (Supabase Auth: owner, supervisor, worker) | Working |
| Zoho HRMS import (OAuth connect, employees, attendance, repeatable sync) | Built; verified against a stand-in serving your real exports; **not yet run against your live Zoho portal** |
| Two separate datasets (Demo and Zoho HRMS) with a switch | Working |
| UI kit, toasts, sounds, settings, login and legal pages | Working |
| Attendance history in an AG Grid data grid (sort, filter, page, CSV export) | Working |
| Demo video production kit (script, timed shot list, narration generator) | Ready: [DEMO_VIDEO.md](./DEMO_VIDEO.md) |
| Hosted demo on Vercel | **Not deployed** (needs your Vercel login); steps and limits in [DEPLOY_VERCEL.md](./DEPLOY_VERCEL.md) |
| Database | JSON file (not Postgres) |

## 2. Verified against real services (sandbox)
- **Cashfree Payouts (verified 2026-11-20, Payouts test environment, no KYC needed):**
  - Direct API: add a beneficiary (`success@upi`, status `VERIFIED`), create a ₹1 UPI transfer (`RECEIVED`), and a status check a few seconds later returned `SUCCESS` with a UTR.
  - Through the app: submit period (21 payouts sent for approval, 3 held as Needs Review), approve 2 payouts, then **Processing → Completed** with UTRs and a toast, and "Paid out" rose by the amount.
  - Failure handling seen for real: Cashfree rejecting the request ("IP not whitelisted") shows as **Failed** with the reason and a Retry button; Retry sends a new attempt that completed once the signature method was on. A worker with no UPI ID fails with "Worker has no UPI ID on file".
  - The sandbox charged a service fee on the ₹1 transfer (₹6 plus ₹1.08 tax). BolPay does not show fees.
  - **Not yet exercised:** `failure@upi` and other Cashfree-side failures, an empty-balance run, retry after a Cashfree-side failure, and webhooks.
- **Voice assistant eval:** `npm run test:voice` passes **40 of 40** dry-run conversation fixtures: multi-step flows, clarification then answer, an unrelated command superseding a question, spoken confirm in English, Hindi and Hinglish, cancel, a confirm-looking command that must not confirm, plan edits, ambiguous and unknown names, out-of-period dates, rule edits, prompt-injection attempts. Metrics for that run: 0 errors, model latency p50 about 0.7 s and p95 about 10 s (that tail is rate-limit failover), clarification rate 13 percent. About 40 percent of planning calls were served by the fallback `gpt-oss-20b` because of Groq's per-model token limit.
- **Voice, real run:** "Calculate incentives for Mohammed Ali, then approve Mohammed Ali's payout" prepared the payout, paused with the exact figures (1 payment and the ₹ total), sent only after a second confirm, and "refresh the payment status, then tell me how many payments completed" reported it completed. This run was made against the previous payment provider; repeat it on Cashfree.
- **Voice panel in a browser** (typed commands, Playwright): a pending question survives closing the panel and a full page reload, the answer continues the same request, the plan card shows Confirm and Cancel, and "yes please" confirms and runs.
- **Not verified:** Cashfree payouts and webhooks, real microphone recording, Kannada, Tamil and Bengali speech, `next build` (production), and a clean-clone run on another machine.

## 3. Screens
| Screen | What it does |
|---|---|
| `/dashboard` | Period summary, stat cards, recent transactions |
| `/workers` | List, search, city filter, add worker, inline wage edit, activate or deactivate, **import workers CSV**, **import deliveries CSV** |
| `/attendance` | Per-day status buttons, overtime hours, units; "mark remaining present"; **attendance history** in an AG Grid grid below (click a date to open that day) |
| `/incentives` | Live payout summary per worker (base, overtime, performance, delivery tiers, attendance bonus), rules editor with delivery tiers and rules version, submit for approval (shows how many are Needs Review) |
| `/payouts` | **Needs review** card with reasons, awaiting approval with per-worker breakdown and rule version, bulk approve and reject with a confirmation, decision history |
| `/transactions` | Status tabs (All, Processing, Completed, Failed), ₹ amount and bank UTR, failure reasons, Retry, automatic status refresh every 4 s while anything is processing |
| Voice panel (every screen) | Conversation, plan card with step status, Confirm and Cancel, mic, typed input, New conversation, voice-reply toggle |
| `/integrations` | **Zoho HRMS**: status, Connect Zoho, Sync now, disconnect, last sync result, setup steps (owner only) |
| `/settings` | Per-device preferences: sounds, click sounds, volume, payment alerts |
| `/me` | Worker self-service: own attendance, earnings, payment history |
| `/login`, `/terms`, `/privacy` | Sign in (Supabase Auth) and the public legal pages |

## 4. API inventory
| Route | Purpose |
|---|---|
| `GET /api/state` | Full snapshot for the UI |
| `POST/PATCH /api/workers`, `/api/workers/[id]` | Add and update workers |
| `PUT /api/attendance`, `PUT /api/rules` | Attendance edits, rule changes (bumps the version) |
| `POST /api/import` | CSV import of workers or deliveries |
| `POST /api/payouts/submit-period` | Calculate and queue payouts; optional `{city, minUnits, date}` |
| `POST /api/payouts/decide` | Approve or reject (approve sends the UPI transfers through Cashfree) |
| `POST /api/payouts/sync` | Pull transfer statuses from Cashfree |
| `POST /api/transactions/[id]/retry` | Retry a failed payment |
| `POST /api/webhooks/cashfree` | Signature-verified `TRANSFER_*` events (HMAC-SHA256 of timestamp and raw body) |
| `POST /api/voice-input`, `/api/voice-output` | Speech-to-text and text-to-speech (Sarvam AI; client in `app/lib/sarvam/`) |
| `POST/GET /api/voice/turn` | One conversational turn; restore a session |
| `GET/DELETE /api/voice/metrics` | Voice quality metrics |
| `GET/POST /api/workspace` | Which dataset is active; owners switch between `demo` and `zoho` |
| `GET /api/zoho/status` | Zoho configuration, connection, last sync, dataset size (owner) |
| `GET /api/zoho/connect`, `/api/zoho/callback` | Start and finish the Zoho sign-in (owner; one-time `state` cookie) |
| `POST /api/zoho/sync`, `DELETE /api/zoho/sync` | Import from Zoho; forget the stored tokens (owner) |
| `POST /api/intent` | **Legacy** single-intent route, unused by the UI (to be removed) |

## 5. Voice control
Full details in [VOICE.md](./VOICE.md).
- **Multi-step commands:** one sentence can chain actions ("mark Anita absent, then prepare payouts for Bengaluru riders with at least 20 deliveries, then approve Ravi"). Steps run top to bottom and stop at the first failure.
- **Whole workflow by voice:** attendance, overtime, deliveries, prepare payouts, approve, reject, retry failed payments, refresh statuses, add a worker, update a worker's wage, UPI ID, city, role, phone or status, change rules and delivery tiers, 13 kinds of read-only questions, and navigation.
- **Multiple targets:** several names, "everyone", "everyone except X", a city, "workers missing attendance", a minimum delivery count. The server resolves who is meant, never the model.
- **Follow-ups keep their context:** a clarifying question (unknown or ambiguous name, missing status, wage, hours) is answered in the same session. An unrelated reply sets the question aside and says so. A reply while a plan is waiting can add to or change it ("also mark Anita").
- **Spoken confirm:** "confirm", "yes please", "haan kar do", "हाँ" and cancel phrases work by voice. Only a whole-utterance phrase confirms, so "OK, mark Ravi absent" is a new command.
- **Money checkpoint:** approve and retry steps show the exact payment count and ₹ total, and ask again when earlier steps in the flow change the numbers or the numbers change before execution.
- **Session survives:** closing the panel, tapping the mic again or reloading the page keeps the pending question or plan (server-side session, 15 minute idle timeout). **New conversation** resets it.
- **Catalog-driven:** `app/lib/voice/catalog.json` holds every action, slot, clarifying question, example, confirm phrase and prompt rule; the planner prompt and validation are generated from it.
- **Metrics and eval:** `GET /api/voice/metrics` and `npm run test:voice`.
- **Rate-limit aware:** compact planner prompt, JSON mode, automatic failover from `openai/gpt-oss-120b` to `openai/gpt-oss-20b` (each model has its own 8,000 tokens per minute on Groq's free tier).

## 6. Data and rules (PRD §5.2, §5.5)
- **Seed data:** 25 synthetic Bengaluru riders (`app/lib/merchant/mock-data.ts`) with the Cashfree sandbox UPI ID `success@upi`. Rider 25 has no UPI ID (deliberate failure case), rider 24 is inactive. Deliberate data problems: riders 7 and 13 miss attendance records, rider 18 is marked absent with deliveries logged.
- **City** on workers, with a city filter.
- **Tiered delivery incentives:** on each worked day the highest tier reached is paid once (default 10 / 20 / 30 deliveries → ₹50 / ₹100 / ₹150), editable on the Incentives screen. Plus wage, overtime, per-unit incentive above a daily target, and an attendance bonus.
- **Rule versioning:** every rules change bumps a version. Each payout stores the version and a snapshot of the rules it used.
- **Needs Review:** missing attendance days or absent-with-deliveries records flag the payout `needs_review`. It can't be approved until the data is fixed and the period is submitted again. Enforced on the server.
- **Prepare filters:** city, minimum deliveries on a date, specific workers. Qualifying workers receive the full period amount from the rules engine.
- **Resubmit:** rejected payouts don't block a new submission (new ids `…-r2`); the old ones stay in the history.
- **CSV import:** workers (`name, role, city, phone, payoutUpi, dailyWage`) and deliveries (`worker, date, deliveries, status, overtime`), with row-level errors; duplicates are skipped.
- **Audit log:** calculations, approvals, rule changes, imports and voice flows are recorded in the database (`audit`); not shown in the UI yet.

## 7. Payments and currency
- Amounts are stored, displayed and paid in **₹**. Cashfree Payouts sends UPI transfers in INR, so there is no currency conversion.
- Recipients: each worker has a UPI ID (`payoutUpi`, `name@bank`). `ensureBeneficiary` registers a Cashfree beneficiary per worker and UPI ID (a changed UPI ID creates a new one); a worker without a valid UPI ID fails with a clear reason before anything is sent.
- Duplicate prevention: deterministic `transfer_id` (`bp_` + hash of payout id + per-database salt, plus the attempt number). A repeated submission returns the existing transfer's state, and the per-database salt means a reseed never collides with earlier test transfers.
- Status mapping: only Cashfree `SUCCESS` counts as paid; `FAILED`, `REJECTED`, `REVERSED` and `CANCELLED` are failures; everything else stays processing.
- Live-mode guard: payouts are refused when `CASHFREE_ENVIRONMENT=production` unless `ALLOW_LIVE_PAYOUTS=true`. Production also needs the server IP whitelisted in Cashfree.
- Cashfree's docs give a per-transfer UPI limit of ₹10,000 to ₹1 lakh depending on the bank; large payouts may need splitting or another transfer mode.

## 8. Backend and persistence
- Next.js route handlers with a service layer (`app/lib/server/service.ts`) and thin API routes; no Express server.
- Persistence: file-backed JSON at `.data/db.json`, atomic writes, `schemaVersion` (an older file is reseeded automatically), single process, not serverless-safe.
- Voice sessions and metrics are in memory (lost on restart).

## 9. Known limitations
- JSON file database; one process only.
- The voice assistant needs the Groq model; Groq's free tier allows 8,000 tokens per minute per model, so a burst of turns can wait or fall back to the smaller model.
- A flow cannot name a worker that an earlier step in the same sentence creates.
- The Demo dataset is pinned to fixed dates (3 Nov 2026, period 21 Oct to 3 Nov) so the trained demo always looks the same. The Zoho dataset uses the real date (India time) and the calendar month.
- The Zoho connection (tokens) is one record for the whole server, not per business.
- On a host with a read-only project folder the JSON files must live in a writable folder (`DATA_DIR`, for example `/tmp`), which is wiped on cold starts; see [DEPLOY_VERCEL.md](./DEPLOY_VERCEL.md).
- Legacy single-intent code (`/api/intent`, `voice-commands.ts`) is still in the repo.

## 10. Environment
`.env.example` documents every variable, including the Cashfree keys and `VOICE_PLANNER_MODELS`.

## 11. Authentication and roles (added by the team, 2026-11-11)
- **Login:** Supabase Auth (email and password). `proxy.ts` refreshes the session and sends signed-out visitors to `/login`; pages and route handlers verify the session and role again (`app/lib/auth/dal.ts`, `app/lib/server/http.ts`).
- **Roles:** owner (everything, including approving and moving money), supervisor (attendance, prepare payouts by voice; no money), worker (only `/me`). Owner-only API routes return 403 to other roles, and the voice assistant refuses owner-only steps for supervisors.
- **Schema:** relational schema with row-level security in `supabase/migrations/`, demo logins in `supabase/seed.sql`. Business data itself still lives in the JSON files; Supabase holds logins and roles.
- **UI:** shared component kit, toasts, quiet interaction sounds and payment alerts, settings page, skeleton loading states, MIT license.

## 12. Zoho HRMS integration (added 2026-11-12)
Lets a business that runs HR on Zoho People start paying through BolPay without re-keying people.

**Two datasets.** The app now has two fully separate workspaces behind one switch in the sidebar (each person's own choice, kept in their own cookie, so switching never changes what anyone else sees): **Demo** (the trained 25-rider Bengaluru dataset, unchanged) and **Zoho HRMS** (starts empty, filled by a sync). Each has its own workers, attendance, payouts, transactions, rules and Cashfree transfer ids (`.data/db.json` and `.data/zoho.json`). Every screen, payout flow and the voice assistant work on whichever dataset is active, because everything reads through `getDb()`; "today" and the pay period come from `getToday()` and `getPeriod()` (`app/lib/server/context.ts`).

**Connect.** The owner presses Connect Zoho on `/integrations`: OAuth 2.0 authorization-code flow against `accounts.zoho.in` with a one-time `state` cookie. Tokens are stored server-side in `.data/integrations.json` (never sent to the browser). A `ZOHO_REFRESH_TOKEN` in `.env` (Zoho "Self Client") works instead of the redirect flow.

**Sync now** (`POST /api/zoho/sync`, `app/lib/zoho/`):
- Employees: `GET people.zoho.in/people/api/forms/employee/getRecords`, 200 per call, paged. Mapped by `mapper.ts` (accepts both the API field names and the Zoho UI export column labels).
- Attendance: `GET .../attendance/getUserReport` for the current month, 100 employees per call. Present, half day (under 4 hours), absent, leave types and overtime are mapped; weekends, holidays and unmarked days are skipped.
- **Ownership rules:** Zoho owns identity (name, role, department, city, phone, joining date, active status) and the attendance of days it reports; a re-sync updates them. BolPay owns pay: the daily wage and UPI ID are set once when an employee is first imported and a sync never overwrites them.
- **Salary:** Zoho People has no salary API (payroll is the separate Zoho Payroll product). New employees get `ZOHO_DEFAULT_DAILY_WAGE`, or a value read from a custom field named in `ZOHO_WAGE_FIELD`. HR edits wages on the Workers screen or by voice.
- **UPI ID:** Zoho People holds no payment details, so imported employees start with an empty UPI ID and their payouts fail with a clear reason until one is set (voice: "set Michael Johnson's UPI ID to success@upi", or on the Workers screen).
- **Needs Review** applies to the synced data; for Zoho employees weekends are not counted as missing, so HR is asked to mark the unmarked weekdays before payouts can be approved.

**Verified:**
- The mapper with `node scripts/zoho-mapper-check.mjs`: 6 offline checks, plus all 18 rows of the real `Employee View.xlsx` export.
- The full sync (token refresh, paging, mapping, database writes) against a throwaway local stand-in serving the real exports (18 employees and the real attendance row of one employee). Results: 18 created; a second sync 0 created and 18 updated; an edited wage and payment details survived the re-sync; attendance landed on the right employee; Needs Review flagged the unmarked weekdays and not the weekends; the voice assistant planned and answered correctly on the Zoho dataset ("today" = the real date); the Demo dataset was unchanged (25 workers, 24 payouts).
- **Not verified:** a run against the live Zoho portal (needs the owner's Client ID and Secret), and the exact OAuth scope name for attendance (`ZOHOPEOPLE.attendance.READ` is the default; if Zoho rejects it, use `ZOHOPEOPLE.attendance.ALL`).

## 13. Migration from PayPal to Cashfree (2026-11-20)
- **Payments.** PayPal Payouts, Orders and the `/checkout` page were removed. `app/lib/cashfree/` now holds a Payouts V2 client (`rest.ts`, two auth headers, no token exchange) and the transfer logic (`payouts.ts`); `submitToCashfree`, `syncStatuses` and `applyWebhookTransfer` in `service.ts` use it.
- **Recipients.** Workers have a UPI ID (`payoutUpi`) instead of a PayPal email. `schemaVersion` was bumped, so older data files reseed.
- **Removed with PayPal:** the *awaiting sign-up* (`unclaimed`) status, *cancel and refund*, the PayPal accounts card on Integrations, sandbox-email assignment and the sandbox-accounts CSV export. UPI has no equivalent states: a transfer either succeeds, fails or is still processing.
- **Open:** register the webhook and observe `TRANSFER_SUCCESS` (needs a public URL), exercise the Cashfree-side failure cases, and decide how to handle UPI limits for large payouts.
- **Hardening (2026-11-20):** `MANUALLY_REJECTED` now maps to failed (it used to stay "processing" forever); the beneficiary status (`INVALID`, `FAILED`, `DELETED`) is checked before a transfer so a bad UPI ID fails with a clear reason; the Payouts screen says INR instead of USD.
- **Setup lessons (Cashfree Payouts):**
  - Payouts has its own API keys: Payment Gateway keys return 401 on the Payouts API. Generate them in Payouts > Developers > API Keys.
  - The **Test environment needs no KYC**: open Payouts and use **Switch to Test** in the top bar (the "Try Test Environment" button leads to onboarding). It comes with test balance.
  - Every Payouts call needs an identity check, in test as well as production, or it fails with `IP not whitelisted` (HTTP 403). Option 1: whitelist your IPv4 address (Developers > Two-Factor Authentication). It breaks whenever your IP changes and a hosted server has no fixed IP. Option 2 (used here): generate a **Public Key**, then click **Switch Method** and confirm; generating the key alone does not turn it on. BolPay then sends `X-Cf-Signature` (RSA-OAEP of `<clientId>.<unix time>`) on every request, so it works from any IP. Set `CASHFREE_PUBLIC_KEY` (PEM on one line with `\n`) or `CASHFREE_PUBLIC_KEY_PATH`. See `.env.example`.
- **Speech.** Sarvam AI does speech-to-text (`saaras:v4`, language auto-detected) and text-to-speech (`bulbul:v3`). TTS has no auto-detect, so `app/lib/sarvam/languages.ts` picks the language from the reply text (the planner's language is only a hint): English fallbacks are spoken as English, and Urdu (no Sarvam voice) gets a 422 so the reply is text only. Replies are WAV; numbers over four digits get commas as Sarvam asks. The recorder stops at 28 s because REST speech-to-text is meant for clips under about 30 s, and one retry covers a 429 or 503.
- **Unchanged:** the Zoho import sync fix and screen-refresh work from the earlier session still apply (a sync now hands fresh server data to the screens).

## 14. Final additions before submission (2026-11-12)
- **Per-person dataset.** The Demo / Zoho HRMS choice is stored in each person's own cookie (`bolpay_dataset`) and applied to every request through `AsyncLocalStorage` (`runInWorkspace`, `withRequestWorkspace`). Outside a signed-in request (the worker page, the Cashfree webhook) the demo data is used; the webhook searches every dataset. Owners and supervisors can switch; roles still decide what they may do.
- **AG Grid attendance history.** AG Grid Community (MIT) data grid, themed to the app, paginated, sortable, filterable and exportable, loaded on demand (`next/dynamic`) because it is large. Enterprise features (Excel export, grouping, set filter) are deliberately not used.
- **Clearer feedback.** Toasts for Zoho sync, disconnect and completed or failed payments.
- **Hosting.** `DATA_DIR` moves the JSON files (and the Zoho token store) to a writable folder for hosts such as Vercel. A hosted deployment was **not** performed here; see [DEPLOY_VERCEL.md](./DEPLOY_VERCEL.md) for the steps and the limits of `/tmp` storage.
- **Demo video kit.** [DEMO_VIDEO.md](./DEMO_VIDEO.md) has the narration script, a timed shot list built from measured clip lengths, recording, narration and editing steps, and ready-to-paste YouTube and project description text. `docs/demo-video/narration.json` holds the clips as data and `scripts/demo-narration.mjs` renders them. `scripts/demo-narration.mjs` now renders the clips with Sarvam AI (WAV). Regenerate them, and re-time the shot list re-timed once the Cashfree screens are recorded.
- **Checked for the video:** the three demo voice commands plan correctly against the real planner (dry run), the approve step pauses at the exact-amount checkpoint, and "Yes, go ahead" confirms by voice.

## 15. State at submission
**Working and verified:** voice-driven multi-step flows with exact-amount checkpoints (40 of 40 eval fixtures, plus real runs), Needs Review safeguards, roles and sign-in, Zoho People import against a live portal (20 employees, 150 attendance records), two datasets with per-person switching.
**Not verified or not done:** Cashfree payouts end to end and webhooks (need the Payouts keys and a public URL), the Sarvam AI speech integration against the live API (written from the docs; the first real call should confirm the audio format and the speech-to-text behaviour), a real-microphone take (record it as part of the video), Kannada, Tamil and Bengali speech, a hosted deployment, and a production build run in this session (the team reported it passing). Open work is in [REMAINING.md](./REMAINING.md).
