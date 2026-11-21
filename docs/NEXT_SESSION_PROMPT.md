# BolPay: handoff prompt for the next Claude Code session

> Read this whole file and `CLAUDE.md` before doing anything. It replaces the earlier handoff, which described the project before auth, the JSON store, the voice planner and the payment migration existed.

## 0. Progress log

- **2026-11-11:** auth (Supabase Auth: owner, supervisor, worker), voice planner, JSON data store, Zoho People import. See [BUILT.md](./BUILT.md).
- **2026-11-20:** payments moved from PayPal to **Cashfree Payouts (UPI, INR)** on branch `feature/cashfree-integration`. Code and docs no longer mention PayPal. Speech moved from ElevenLabs to **Sarvam AI** (`app/lib/sarvam/`); it has not yet been run against the live API.

## 1. What this project is

**BolPay** ("bol" = "speak" in Hindi) is a **voice-first payroll app for small businesses with daily-wage workers** (delivery fleets, shops, kitchens, construction crews).

**Real-life problem:** owners track attendance in notebooks, remember overtime from memory and pay in cash. This causes wage disputes and leaves workers with no income record.

**Product goal:** the owner speaks in any language ("Ravi aaj aaya, Anita ne 2 ghante overtime kiya"); the app plans the steps, a rules engine calculates the pay, a human approves the exact amount, and **Cashfree sends UPI payouts** to each worker. Workers log in and see their own attendance, earnings and payment history.

**Target demo:** speak in Hindi → spoken confirmation → "prepare and approve payouts" → exact-amount checkpoint → UPI transfers go out on the Cashfree sandbox → statuses move to completed.

## 2. Current state of the code

- **Stack:** Next.js 16 (App Router, Turbopack), React 19, Tailwind 4, TypeScript. **Read `AGENTS.md`**: this Next.js version has breaking changes, so read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code.
- **Architecture, commands and gotchas:** `CLAUDE.md` is the source of truth. Highlights: all logic in `app/lib/server/service.ts`; Cashfree client in `app/lib/cashfree/`; webhook at `/api/webhooks/cashfree`; voice stack in `app/lib/voice/`; amounts are ₹ end to end; workers are paid to a UPI ID (`payoutUpi`).
- **Verified:** `tsc` and `npm run lint` pass; the voice eval had 40 of 40 on the previous payment provider.
- **Not verified:** any real Cashfree call. The Payouts keys are not in `.env` yet (`CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET` are empty).

## 3. Environment (`.env`, git-ignored; NEVER print or commit values)

- `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`: Payouts API keys, test mode (dashboard → Payouts → Developers → API Keys). The secret also verifies webhook signatures. The Cashfree MCP cannot return these; the owner copies them once.
- `CASHFREE_ENVIRONMENT=sandbox` (default). `ALLOW_LIVE_PAYOUTS` must stay unset; payouts are refused in production unless it is `true`.
- Speech: `SARVAM_API_KEY` (optional `SARVAM_STT_MODEL`, `SARVAM_TTS_MODEL`, `SARVAM_TTS_SPEAKER`).
- `GROQ_API_KEY`, Supabase keys, optional Zoho keys: see `.env.example`.

## 4. Tooling

- The **Cashfree MCP** connector is authorised. It exposes Payment Gateway data (orders, settlements, reports) and a product-docs search. Its tool guide also mentions Payouts transfer tools; check whether they are loaded before relying on them.
- Sandbox test UPI IDs (from Cashfree's docs): `success@upi` pays, `failure@upi` fails.

## 5. Tasks, in order

1. **Live sandbox test** once keys and test funds (Payouts → Balance) are in place: approve a payout to `success@upi` and confirm it reaches `completed` via sync; then `failure@upi`; then a worker with no UPI ID; then retry (attempt 2); then a duplicate approval from two tabs (one transfer only).
2. **Webhooks:** tunnel the app, register `/api/webhooks/cashfree`, confirm `TRANSFER_SUCCESS` updates a transaction and that a forged signature returns 400.
3. **UPI limits:** Cashfree documents ₹10,000 to ₹1 lakh per UPI transfer depending on the bank; decide how to handle larger payouts.
4. **Sarvam AI check:** the swap is in the code; run a real recording and a spoken reply with a live key (see V-02).
5. **Supabase schema:** rename the `paypal_*` transaction columns when moving data to Postgres (REMAINING Z-18).
6. Re-record the demo video once the Cashfree flow works (the shot list in [DEMO_VIDEO.md](./DEMO_VIDEO.md) was written for the old screens).

## 6. Working rules

- Never print, log or commit secrets. Don't commit `.env*`.
- Only commit when the user asks. Work on the feature branch, not `main`.
- After each step run `npx tsc --noEmit` and `npm run lint` (and `npm run build` before demos).
- Money-moving actions run server-side only, check the owner role, and keep the `ALLOW_LIVE_PAYOUTS` safety switch.
- Keep explanations to the user short and simple.
