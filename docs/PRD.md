# BolPay AI — Product Requirements Document

**Tagline:** Speak. Approve. Pay.
**Category:** AI-powered workforce incentive and payout automation
**Users:** logistics companies, delivery businesses, gig-work platforms, workforce managers
**Payments:** Cashfree Payouts (UPI, INR) · **Speech:** Sarvam AI

> Status of the build against this PRD: [BUILT.md](./BUILT.md). Open work: [REMAINING.md](./REMAINING.md).

## 0. Event constraints

BolPay started for a PayPal-sponsored hackathon; its rules, deadline and prizes no longer apply and have been removed. The project now centres on **Cashfree Payouts** (UPI, INR) for payments and **Sarvam AI** for Indian-language speech. **Confirm the current event's rules, deadline and judging criteria before submitting**; this section is a placeholder until they are known.

Carried over as good practice (confirm against the new rules):
1. A working project that meaningfully integrates the payment partner (Cashfree) and AI.
2. A text description of features and functionality, and a tools list stating which models and AI services are used and how.
3. A **functional demo**: clear setup and run instructions in the repo, or a hosted demo URL.
4. A **public repo** with all source, assets, run instructions and a visible LICENSE file.
5. A short **demo video** that shows the project working end to end, with no third-party trademarks or copyrighted music.

Implications:
- All money movement runs on the Cashfree **sandbox** (test API keys, test funds).
- Judges must be able to run the app, so the README setup steps and a demo mode that works without private keys matter.

## 1. Overview

BolPay AI is a voice-first workforce payout platform. A manager speaks a command in their own language. The system turns it into a structured action and calculates pay with a deterministic rules engine. It presents a transparent payout summary, pays only after explicit human approval, and reports verified payment status back by voice.

Example: "Calculate ₹100 incentives for all riders who completed at least 20 deliveries today. Flag workers with missing attendance."

## 2. Problem

- Attendance, delivery counts and incentives live in separate systems and spreadsheets.
- Managers calculate bonuses by hand for hundreds of workers.
- Bulk payouts are slow to prepare and process.
- Missing or conflicting records lead to wrong payouts.
- Dashboards are hard to use for managers who work in regional languages.

## 3. Goals and non-goals

**Goals**
1. Start payout workflows from natural-language voice commands.
2. Calculate incentives with configurable, versioned business rules.
3. Flag missing, inconsistent or invalid records.
4. Show worker-level and batch-level summaries.
5. Require manager approval or rejection before any money moves.
6. Pay through Cashfree Payouts, by UPI (sandbox).
7. Report real payout status by voice.

**Non-goals (MVP):** replacing an HRMS or payroll system, setting salaries or ratings, GPS or attendance tracking, supporting other payment providers, paying without approval.

## 4. Personas

- **Operations manager (primary):** sets rules, reviews records, prepares and approves batches, monitors status.
- **Finance/admin:** verifies calculations and recipients, handles failed and pending payouts.
- **Worker:** receives payouts; views breakdown and status (nice-to-have).

## 5. Functional requirements

### 5.1 Auth and roles
- Manager login (demo authentication is acceptable for the hackathon).
- Manager and admin roles. Only authorised roles can approve, reject, retry or sync payouts.
- Workers, payouts and transactions scoped to a business.

### 5.2 Workforce management
- Add, edit and deactivate workers: name, ID, city, role, phone, UPI ID, daily wage, status.
- View attendance, delivery counts and payout history.
- Filter the workers table (city, status).
- Synthetic dataset: ~25 Bengaluru delivery riders with realistic variety, including missing attendance, a missing payout email and conflicting records.

### 5.3 Voice interface (Sarvam AI)
- Capture audio in the dashboard; transcribe with Sarvam AI speech-to-text.
- Languages: English, Hindi, Kannada, Tamil, Bengali, including code-mixed speech, subject to testing.
- Read replies aloud with Sarvam AI text-to-speech, in the language the manager spoke.
- Ask a clarifying question when information is missing or ambiguous.
- Example commands: "Show today's delivery incentives." / "Prepare payouts for all eligible Bengaluru riders." / "Show workers with missing attendance." / "How many payouts failed?"

### 5.4 AI intent processing
- An LLM converts the transcript into a strict-schema action, for example `{intent, city, date, conditions}`.
- Every output is validated and resolved against real records server-side before anything runs.
- **The LLM never calculates amounts or invents records.** The rules engine is the source of truth.
- Supported intents: mark attendance, record overtime/units, prepare incentives (with city and minimum-deliveries filters), approve/reject payouts, payout status, navigate, clarify.

### 5.5 Incentive engine
- Deterministic and server-side. Inputs: attendance, deliveries, wage, rules.
- Rule types: wage, overtime, per-unit incentive, attendance bonus and **tiered delivery incentives** (e.g. 10 / 20 / 30 deliveries → ₹50 / ₹100 / ₹150).
- Detect missing or conflicting records and mark the worker **Needs Review** instead of guessing.
- Store the **rule version** used for every calculation.
- Currency: ₹ everywhere. Cashfree Payouts pays UPI transfers in INR, so no conversion is needed.

### 5.6 Payout batch and approval
- Show eligible worker count, total, per-worker amounts, workers needing review, invalid recipients and the rule applied.
- Approve or reject the batch, or individual payouts. No payment before explicit approval.

### 5.7 Cashfree payments
After approval the backend validates each payout and its recipient's UPI ID, registers a Cashfree beneficiary (idempotent), then creates a UPI transfer with `POST /payout/transfers` using an idempotent `transfer_id`. It stores the transfer id and UTR and updates status from signature-verified webhooks (`TRANSFER_*`), with polling as a fallback.

Statuses: Draft, Pending Approval, Approved, Processing, Completed, Failed, Needs Review.

Requirements: duplicate-payout prevention, transaction records, retry of failed payouts, webhook signature verification, and reconciliation of provider status against internal records.

### 5.8 Voice status updates
"What's the payout status?" / "Who has a pending payment?" are answered from stored provider-confirmed statuses (not from API-submission success) and spoken via TTS. Recipient details are never read aloud.

## 6. End-to-end flow

Manager logs in → opens the voice assistant → speaks → Sarvam AI transcribes → LLM extracts the intent → backend validates and resolves records → rules engine calculates → discrepancies are flagged → dashboard shows the proposed batch → manager approves → backend submits UPI transfers to Cashfree → webhooks and sync update status → TTS summarises the outcome.

## 7. Architecture

Next.js (App Router, TypeScript, Tailwind) frontend and route-handler backend. Business logic is in `app/lib/server/service.ts`, and the API routes are thin wrappers around it. Integrations: Sarvam AI (STT and TTS), Groq LLM (intent extraction and reply translation), Cashfree (raw REST client for Payouts V2 and webhook verification).

Original plan: Express + PostgreSQL + Prisma. Current implementation: a file-backed JSON store behind a single service layer. Decision for the team: either move to Postgres (Prisma) behind the same service layer, or keep the JSON store for the demo and state the limitation. Next.js route handlers already replace Express, so a separate Express server is not needed.

## 8. Security and reliability
- Secrets only in environment variables.
- Role-based authorisation on money-moving endpoints.
- Validate every AI-generated action. Payout amounts and emails are read from server state, never from the client or the model.
- Audit log of calculations, approvals and status changes.
- Idempotent batches and per-transaction tracking.
- Verify webhook signatures.
- Live Cashfree payouts are blocked unless explicitly enabled (`ALLOW_LIVE_PAYOUTS`).

## 9. MVP scope

**Must-have:** demo auth, synthetic workforce data, attendance and deliveries, voice input via Sarvam AI, LLM intent extraction, deterministic incentives, discrepancy flags, approval workflow, Cashfree sandbox UPI payouts with status display, spoken results.

**Nice-to-have:** language switcher, payout history and analytics, worker statements, downloadable reports, richer rules.

## 10. Success criteria
- A voice command starts a payout workflow and the right filters are extracted.
- Amounts match the configured rules; missing or conflicting data is flagged.
- The manager approves a batch and eligible payouts reach the Cashfree sandbox.
- Dashboard and voice report verified statuses, including failed and pending ones.

## 11. Demo script
25 Bengaluru riders. The manager says: "Calculate ₹100 incentives for all riders who completed at least 20 deliveries today. Flag workers with missing attendance." Show transcription and the extracted intent, the proposed batch with flagged workers, approval, sandbox payouts moving to completed (include one deliberate failure and one pending), and the spoken summary. Keep a pre-recorded fallback in case of live network failure.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Payouts sandbox keys or test balance missing | Generate the Payouts test keys and add test funds before the first run |
| Recipient UPI IDs invalid | Validate the `name@bank` format on entry; use `success@upi` and `failure@upi` in the sandbox |
| Per-transfer UPI limits (₹10,000 to ₹1 lakh by bank, per Cashfree's docs) | Split large payouts or use another transfer mode |
| Webhook needs a public URL | Use a tunnel or Render; keep the sync action as fallback |
| Non-English transcription accuracy | Test Hindi, Kannada, Tamil, Bengali and code-mixed speech early |
| LLM misreads a command | Strict schema, server validation, clarification questions |
| JSON store loses data or fails on serverless hosts | Move to Postgres, or demo locally |
| Duplicate payments | Deterministic `sender_batch_id`, per-transaction state |

## 15. Version 1.1: changes and extensions (2026-11-07)

Decisions made while building, and requirements added after the first draft. Open work is tracked in [REMAINING.md](./REMAINING.md) by ID.

### 15.1 Changes to the original scope
- **Payments:** the project moved from PayPal Payouts to Cashfree Payouts (UPI). Amounts are shown, stored and paid in ₹ with no conversion; workers are identified by a UPI ID instead of an email.
- **Architecture:** Next.js route handlers replace Express; storage is a JSON file behind a service layer (Postgres + Prisma is still the target, decision B-01).
- **Status model:** payout statuses are pending, needs_review, approved, rejected; transaction statuses are processing, completed, failed. Draft and a separate Approved step are future work (D-03).
- **Daily incentive filter:** "at least 20 deliveries today" selects qualifying riders, who receive the period amount; a true daily-only batch is future work (D-01).

### 15.2 Voice control requirements (new, replaces and extends §5.3 and §5.4)
Voice is the product's main strength: the whole workflow can be run by voice.
- **VC-1 Multi-step commands.** One utterance may contain several actions; they run in the order spoken and stop at the first failure.
- **VC-2 Scope.** Voice can do everything the screens do: attendance, overtime, deliveries, prepare, approve, reject and retry payouts, refresh statuses, add and update workers, change rules and tiers, answer questions, navigate.
- **VC-3 Targets.** Multiple names, "everyone", "everyone except", a city, a filter (for example missing attendance) and a minimum delivery count, resolved by the server from real records.
- **VC-4 Follow-ups.** Missing or ambiguous details produce one clarifying question; the reply continues the same request. An unrelated reply must not be mistaken for an answer; the assistant says it set the question aside.
- **VC-5 Persistent session.** Tapping the mic again, closing the panel or reloading the page must not lose a pending question or plan. Only an explicit "new conversation" or the idle timeout ends it.
- **VC-6 Spoken confirm.** Saying "confirm" (or the equivalent in supported languages) runs the stored plan; saying "cancel" drops it. Only a whole-utterance phrase counts; a phrase inside a longer instruction is a new instruction.
- **VC-7 Exact money.** Before any approve or retry step runs, the manager sees and confirms the exact payment count and totals in ₹ and US$. If earlier steps in the same flow change the numbers, the flow pauses with the real figures.
- **VC-8 Safety.** The model never calculates money and never decides to execute. Confirm only runs the plan the server stored; every step is re-validated at execution. Prompt-injection attempts must not execute anything.
- **VC-9 Measurability.** The assistant exposes metrics (latency, clarification, supersede and error rates, models used) and ships an automated eval of conversation fixtures.
- **VC-10 Languages.** English, Hindi and Hinglish verified; Kannada, Tamil and Bengali to be verified (V-02).

### 15.3 Additional requirements
- **AR-1 Needs Review.** Missing or conflicting records must block approval until fixed; the manager is told why.
- **AR-2 Rule versioning and audit.** Every payout records the rules version and a snapshot; calculations, approvals, rule changes, imports and voice flows are logged.
- **AR-3 Import.** Workers and daily deliveries can be imported from CSV with row-level error reporting.
- **AR-4 Reconciliation.** Internal transaction state must be comparable with Cashfree transfers, with mismatches flagged (P-04).
- **AR-5 Explained payment states.** Pending, reversed and rejected transfers need their own explained states (P-05).
- **AR-6 Demo-ability.** A judge must be able to run the app from the README alone, with seeded data that includes a flagged worker, a missing-UPI-ID failure and a retry.
- **AR-7 Rate-limit resilience.** The assistant must degrade gracefully when the model provider rate-limits (failover, spoken wait message).

### 15.4 Success metrics (updated)
- Voice eval pass rate of at least 95 percent on the fixture suite (currently 40 of 40).
- A multi-step spoken flow runs end to end with the exact-amount checkpoint, with no payment sent before the final confirm.
- Zero payments sent without an explicit confirmation across all test runs.
- Webhook-driven status updates arrive without pressing sync (P-01).

## 16. Version 1.2: HRMS integration and delivered access control (2026-11-12)

### 16.1 Delivered since v1.1
- **Access control (§5.1):** Supabase Auth login with three roles (owner, supervisor, worker). Owners approve and move money; supervisors mark attendance and prepare payouts; workers see only their own pay page. Row-level security schema in `supabase/migrations/`.
- **Product polish:** shared UI kit, toasts and payment alerts, quiet interaction sounds, settings page, skeleton loading, legal pages, BolPay branding throughout, MIT license, production build passing.

### 16.2 Why an HRMS integration
BolPay's promise is to replace the manual work of paying people. A business will only try it if it does not have to re-enter its team. Most already keep employees and attendance in an HR system, so the fastest path to a real trial is to import from there and let HR run payouts in BolPay while the rest of the platform matures. For the hackathon the integration is Zoho People; the demo dataset stays for the trained demo.

### 16.3 Requirements
- **HR-1 Connect.** The owner signs in with Zoho (OAuth 2.0, read-only scopes). Tokens are stored server-side only; a one-time state value protects the redirect.
- **HR-2 Import.** Employees become workers and the current period's attendance becomes attendance records. A sync is repeatable and idempotent; a manual "Sync now" is the minimum, scheduled sync is the target.
- **HR-3 Ownership.** The HR system owns identity and attendance; BolPay owns pay settings (daily wage, UPI ID). A sync never overwrites pay settings.
- **HR-4 Separate datasets.** Imported data lives in its own workspace, switchable from the sidebar, so the trained demo is never disturbed and the real import can be shown on its own.
- **HR-5 Salary honesty.** Zoho People exposes no salary. New employees get a configurable default wage (or a value from a named custom field) that HR edits; payroll products are a later integration.
- **HR-6 Same controls.** Needs Review, approvals with exact amounts, Cashfree payouts, audit log and the voice assistant apply unchanged to imported data. Weekends are not treated as missing attendance for imported employees.
- **HR-7 Safety.** Only owners can connect, sync or switch datasets. Sync failures are shown with the provider's message; a partial result (employees without attendance) is reported, not hidden.
- **HR-9 Honest payment states.** A payout to an employee with no UPI ID fails immediately with a clear reason instead of sitting in processing. Payment readiness (how many employees have a UPI ID) is visible before paying.
- **HR-8 Portability.** The mapping accepts both the HR system's API field names and its UI export column labels, so more systems (Keka, Darwinbox, BambooHR, greytHR) can be added behind the same sync interface.

### 16.4 Success metrics
- An owner connects a Zoho account and imports every employee in under two minutes, with no manual entry.
- A second sync changes nothing the owner edited (wage, UPI ID) and updates what Zoho changed.
- A voice command ("mark everyone present today, then prepare payouts") works on imported employees exactly as on the demo data.
- The demo dataset is unchanged after any number of syncs and switches.

### 16.5 Risks
| Risk | Mitigation |
|---|---|
| Zoho scope names or endpoints differ from the documentation | Scopes are configurable (`ZOHO_SCOPES`); employees import even if attendance is refused; errors show Zoho's message |
| Test employees have no attendance or salary | Mark attendance by voice on the imported data; default wage is editable; document in the pitch |
| Imported employees have no UPI ID, so payouts fail | Set sandbox UPI IDs (`success@upi`) by voice on a few employees |
| One stored Zoho connection for the server | Per-business tokens (Z-07). The dataset switch is already per person (Z-08 done) |

## 17. Final state at submission (2026-11-12)

### 17.1 Requirement status
| PRD section | Requirement | Final status |
|---|---|---|
| 5.1 | Authentication, roles | **Done**: Supabase Auth, owner / supervisor / worker, server-side checks on every route; business scoping still open |
| 5.2 | Workforce management | **Done**: workers, city, UPI ID, CSV import, attendance history grid; Zoho import adds real employees |
| 5.3 | Voice interface | **Done** for English, Hindi and Hinglish (40 of 40 fixtures); Kannada, Tamil, Bengali untested; recorded take with a real microphone is part of the video |
| 5.4 | AI intent processing | **Done**: ordered multi-step plans validated against real records; the model never calculates money or executes |
| 5.5 | Incentive engine | **Done**: wage, overtime, daily delivery tiers, attendance bonus, rule versions, Needs Review; daily-only incentive batches not modelled |
| 5.6 | Payout batch and approval | **Done**: exact-amount checkpoint, approve / reject, per-rider breakdown with rules version |
| 5.7 | Cashfree Payouts | **Implemented**: UPI transfers, beneficiaries, idempotent transfer ids, sync, retry, signature-verified webhooks; **not yet verified** on the Cashfree sandbox; reconciliation screen not built |
| 5.8 | Voice status updates | **Done** |
| 16 | HRMS migration (Zoho People) | **Done** and verified against a live portal; salary is not available from Zoho People, so wages are configured |

### 17.2 How the product is shown and judged
- **Demo video** (under 3 minutes) following [DEMO_VIDEO.md](./DEMO_VIDEO.md): the problem, the Zoho import, one spoken sentence becoming a three-step plan, the exact-amount checkpoint, Needs Review, a live Cashfree UPI payout visible in the Cashfree dashboard, and a failed payout with its reason.
- **Functional demo:** run instructions in the README (judges can run it); a Vercel preview is optional and best-effort (see [DEPLOY_VERCEL.md](./DEPLOY_VERCEL.md) for its limits).
- **Angles:** agentic commerce (an agent that plans and a human who approves, with exact amounts before Cashfree moves money) and impact (workers paid correctly and on time, straight to their UPI, with a migration path from the HR tools businesses already use).

### 17.3 Final success metrics
| Metric | Result |
|---|---|
| Voice eval pass rate (target at least 95 percent) | 100 percent (40 of 40) |
| Spoken flow runs end to end with an exact-amount checkpoint and no payment before the final confirm | Yes, in real runs |
| Zero payments sent without an explicit confirmation | Yes |
| Zoho import without manual entry | 20 employees and 150 attendance records from a live portal |
| Re-sync preserves what the owner edited | Yes (wage, UPI ID) |
| Webhook-driven status updates without pressing sync | Not verified (needs a public URL) |

### 17.4 Known limitations (honest list)
- Business data lives in JSON files; the Supabase schema exists for a later move. A serverless host needs `DATA_DIR` and loses data on cold starts.
- Zoho People has no salary or payment data; test employees have no UPI ID and little attendance.
- Cashfree payouts have not yet been run against the sandbox end to end. Production needs KYC, a whitelisted server IP and `ALLOW_LIVE_PAYOUTS=true`; UPI transfers have per-transfer limits that depend on the bank.
- The language model is on a free tier (8,000 tokens per minute per model); the assistant fails over to a second model and says so when it is busy.
