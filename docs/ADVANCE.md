# BolPay Advance: implementation spec

Emergency salary advances for workers: a worker asks by voice or text, the server checks eligibility, a person approves, and the existing Cashfree Payouts path sends it. Status: **Phases 1 to 4 built** (worker request; staff queue, owner approval, Cashfree sandbox payment; policy, delegation and the rule-based Manager Agent; recovery from the next payroll). Phase 4 is checked offline only; it has not been run end to end against the Cashfree sandbox. Decisions below were settled on 2026-11-20.

## 1. Decisions

| Topic | Decision |
|---|---|
| Limit basis | 25% of **earned unpaid base pay + overtime** this period, minus outstanding advances. Bonuses (tiers, attendance) are excluded because they may not be earned until period end. |
| Agent autonomy | **Human approves by default.** The "Manager Agent" is a deterministic rule engine, not an LLM. Autonomous approve-and-pay is a per-delegation owner opt-in, with caps and expiry, and is blocked in production unless `ALLOW_AUTONOMOUS_ADVANCES=true`. |
| Recovery | Deducted from the **next payroll**, shown as an explicit line and disclosed to the worker before they submit. |
| Approver | **Owner only.** Supervisors review and recommend; they never move money (matches the current role model). |

The 25% and every other number are configurable product policy, not a legal entitlement. Check wage-deduction and advance rules for your jurisdiction before using this with real workers.

## 2. Invariants (never relax)
1. Amounts, limits and eligibility are computed on the server from server state. The client and the LLM never supply a limit or a worker id.
2. The LLM only turns a transcript into `{amount, reason category, summary, language}`. It never decides eligibility, approval or payment, and its output is validated and confirmed by the worker.
3. Money moves only through the existing Cashfree path (`submitToCashfree`), after a server-side approval. No public "execute" route.
4. A payment counts as paid only on Cashfree `SUCCESS` (existing rule). The worker is told "paid" only then.
5. Every state change is one synchronous compare-and-set (the `decidePayouts` pattern), so two approvals can't both pay.
6. Advances never mix into payroll totals or payroll retries.

## 3. Data model (all additive; do not bump `SCHEMA_VERSION`, which reseeds and would wipe the Zoho dataset)
In `Db` (`app/lib/server/db.ts`), all optional and defaulted on read (`db.advances ??= []`):
- `advances: AdvanceRequest[]`
- `advancePolicy: AdvancePolicy`
- `delegations: Delegation[]`

`Transaction` gets optional `kind?: "payroll" | "advance"` (absent means payroll) and `advanceId?`. `AuditEntry` gets optional `actor?` and `target?` (also lets the Audit Log page show them).

**AdvanceRequest:** `id, workerId, amount, approvedAmount?, reasonText, reasonCategory, language, transcript?, source ("voice"|"text"), idempotencyKey, status, eligibility (snapshot), recommendation?, decision?, transactionId?, recovery {outstanding, recovered}, recoveryAck, createdAt, updatedAt`.

**Status machine:** `submitted -> pending_review | rejected(auto) -> approved | rejected -> paying -> paid | payment_failed`; also `cancelled` (worker) and `expired` (pending too long). Each transition checks the current status.

**Eligibility snapshot** (stored on the request so approvers see what the server saw): `earnedBase, earnedOvertime, paidPayroll, outstanding, limit, available, policyVersion, rulesVersion, computedAt, flags[]`.

**AdvancePolicy:** `percentLimit (25), maxAmount, minServiceDays, maxOutstanding (default 1), requireHumanApproval (default true), expireAfterHours, maxRecoveryPercentOfPayout (default 100), version`.

**Delegation:** `id, grantedBy (owner), delegate ("manager_agent"), maxPerRequest, maxDailyTotal, maxMonthlyTotal, startsAt, expiresAt, autonomous (default false), revokedAt?`. Owner notification is mandatory.

## 4. Eligibility engine (pure function, server)
```
earned      = basePay + overtimePay  (calculatePay, attendance to date)
paidPayroll = payroll payouts APPROVED (sent or being sent) for this period
available   = min(maxAmount, floor(percentLimit * max(0, earned - paidPayroll)) - outstanding)
```
Blocks (reason shown to approver and worker): worker inactive or not found; under `minServiceDays` (from `joinedOn`); no valid UPI ID; open advances >= `maxOutstanding`; payout in Needs Review for the worker; amount < ₹1 or > `available`; duplicate `idempotencyKey` (returns the existing request). "Allowed outstanding: 1" means a second advance is blocked while one is unrecovered; the spec's ₹500-outstanding example needs `maxOutstanding = 2`. Missing wage or attendance data escalates, never approves.

**Planned later:** block or flag when the UPI ID changed recently (needs a `payoutUpiChangedAt` field that doesn't exist yet).

## 5. API (worker routes are a separate namespace, so existing STAFF/OWNER guards stay unchanged)
Worker (`requireApiRole(["worker"])`, worker id from `session.workerRef` only; runs on the demo dataset, see section 9):
- `POST /api/me/advance/parse` `{text}` or audio -> `{transcript, language, amount?, reasonCategory, summary, preview}`; persists nothing. Size and rate limited.
- `POST /api/me/advance` `{idempotencyKey, amount, reasonText, language, source, confirmed:true, recoveryAck:true}` -> creates the request; the server recomputes eligibility.
- `GET /api/me/advance` -> the worker's own requests and current limit.
- `POST /api/me/advance/[id]/cancel`

Staff:
- `GET /api/advances` (STAFF), `POST /api/advances/[id]/recommend` (STAFF)
- `POST /api/advances/[id]/approve`, `.../reject` (OWNER). Approve = compare-and-set to `approved`, create the advance `Transaction`, call `submitToCashfree`. `transferIdFor(salt, "adv_"+id, attempt)`.
- `GET/PUT /api/advances/policy` (OWNER), `GET/POST /api/advances/delegations`, `POST .../[id]/revoke` (OWNER)

## 6. Extraction (Groq)
Strict JSON output: `{amount_inr: number|null, reason_category: enum, summary_en: string(<=120), language}`. Send the transcript only, never worker identity. Cross-check the amount against digits and number words found deterministically in the transcript (Bengali, Devanagari and Latin digits); on disagreement, ask the worker to type the amount. Show the worker the interpreted amount and reason in their language, and read the amount back before submit; a 10x misread (২০০০ vs ২০০০০) must be caught here. Reason text is shown to approvers as quoted, untrusted input. Store the transcript, never the audio.

## 7. Manager Agent (deterministic)
Runs on submission and on a timer sweep. Output per request: `approve | recommend | escalate | block` plus reasons, written to the audit log with `actor = "delegation:<id>"`.
- Always blocked: expired, revoked or not-yet-started delegation; request over `maxPerRequest`; over daily or monthly exposure (summed from the advance ledger in the same synchronous step); ineligible; missing data (escalate).
- `approve` and pay automatically only if `delegation.autonomous` AND `policy.requireHumanApproval === false` AND (sandbox OR `ALLOW_AUTONOMOUS_ADVANCES=true`). Otherwise it recommends and a human approves.
- It can never edit its own delegation, the policy or limits.

## 8. Recovery (next payroll)
`submitPeriod` adds, per worker with outstanding advances, `deductions: [{advanceId, amount}]` to the payout, capped at `maxRecoveryPercentOfPayout` of gross and never below a ₹1 net; any remainder carries to the following payroll. `payout.amount` stays the net sent to Cashfree; add `grossAmount`. An advance is marked recovered only when that payroll transfer completes (not on approval, not on failure). Payouts and `/me` show the deduction line. Write-offs and manual repayment are owner-only and audited.

## 9. UI
- `/me`: Emergency Advance card (limit, mic and text, interpreted amount and reason with correction, recovery disclosure, request history and live status).
- `/advances` (new, in the Payments nav): queue for staff (supervisor can recommend) with worker, amount, reason, original transcript, eligibility snapshot, outstanding balance; owner approve/reject with a confirm dialog showing the exact amount, Cashfree/UPI and environment. A second tab for policy and delegation (owner).
- Transactions: `Advance` badge and a kind filter. Dashboard: advance totals separate from payroll "Paid out". Payouts: deduction column. Audit Log: actor and target.
- Voice assistant: advances are excluded from the planner catalogue in v1, so its money checkpoint surface doesn't change.
- Notifications are in-app only (no SMS or push exists). "Paid" is shown and spoken only after Cashfree confirms.

**Known gap:** `/me` and worker requests run on the Demo dataset today, so Zoho-dataset workers can't use this until worker sessions carry a dataset.

**Phase 1 notes (what was built and why it differs):**
- Pending payouts are **not** subtracted from earned wages (they are still unpaid, and Phase 4 recovers the advance from the next payout). Only approved payouts reduce it. Phase 4 must also apply recovery to payouts already pending when an advance is paid.
- A request that hits a hard block is saved as `rejected` with the reasons (audit trail), not silently dropped. Needs-review data is not yet a block or flag; add it when staff can act on it (Phase 2).
- Request creation is rate limited (8 per 10 minutes) and parsing (12 per 10 minutes) per worker.
- There is no manual language picker: speech-to-text auto-detects the language and read-back uses the detected one, so a picker would be a dead control.
- Staff can't see requests yet; they appear only in the Audit Log (`advance.*`, with `actor`). The queue is Phase 2.
- Pure logic is checked by `node scripts/advance-check.mjs` (24 checks).

**Phase 2 notes (what was built and why it differs):**
- Approve creates the transfer and sets the request straight to `paying` in one synchronous step; there is no resting `approved` state. Approval re-runs eligibility and stores it as `decisionEligibility`. An owner may approve less than requested, never more.
- Staff routes: `GET /api/advances` (STAFF), `.../recommend` (STAFF), `.../approve`, `.../reject`, `.../retry` (OWNER). There is no public execute route.
- The transfer is a normal transaction tagged `kind: "advance"` (`payoutId` = the advance id, so its Cashfree transfer id can't collide with payroll). Status sync, webhook and polling are unchanged; a hook (`syncAdvanceFromTx`) moves the request to `paid` only on Cashfree SUCCESS and to `payment_failed` on failure or a later reversal.
- Advances are excluded from payroll totals (Dashboard, `/me` "Paid to date") and from voice `retry_failed` and failed-payment queries; Transactions has a payroll/advance filter. The generic transaction retry refuses an advance.
- Advance retry first asks Cashfree about the earlier attempt and does nothing if it actually succeeded.
- The worker sees a plain message on failure; the provider's error text is for the owner only.
- Verified against the Cashfree sandbox: a `failure@upi` transfer failed with Cashfree's reason, and after correcting the UPI the retry paid with a UTR. Concurrent approvals and retries never sent twice.

**Known gaps after Phase 2**
- No pending-advance badge in the sidebar and no dashboard alert; the owner must open Advances. There is no notification channel.
- Pending requests expire lazily (when someone reads them), not on a timer.
- Needs-review payroll data and a recently changed UPI ID are not yet blocks or flags.
- `/privacy` says supervisors cannot see payouts or transactions, but supervisors already receive them from `/api/state` and now also see advance requests. The wording or the access needs a decision.
- (Fixed in Phase 4.) Outstanding advances were never recovered, so a paid advance blocked that worker from another one.

**Phase 3 notes (what was built and why it differs):**
- The agent is the pure function `evaluateDelegation` (`app/lib/advance/delegation.ts`), checked offline. It returns `approve`, `recommend`, `escalate` or `none` for one request and has no way to change a delegation, the policy or a limit. Those routes are owner-only (`/api/advances/policy`, `/api/advances/delegations`, `.../revoke`).
- It approves only when ALL hold: the delegation is in force (not revoked, started, not expired), the request is eligible with no data flags, it is within the per-request, daily and monthly caps (totals count what the agent already approved, in India time), the delegation is marked autonomous, `policy.requireHumanApproval` is off, and (in production) `ALLOW_AUTONOMOUS_ADVANCES=true`. Otherwise it recommends or escalates, and a person decides.
- When it approves, it goes through the same `approveAdvance()` as the owner (fresh eligibility check, one synchronous check-and-set, the existing Cashfree path) as `delegation:<id>`. No `await` sits between evaluating the rules and that check-and-set, so a revoke or a human decision can't slip in between.
- One delegation at a time; it lasts 5 minutes to 60 days; its per-request cap can't exceed the policy maximum. Starting one also reviews requests that were already waiting. Revoking takes effect immediately.
- Owner notification is in-app only: each request shows the agent's decision and reasons, the Advances page shows a banner for agent approvals in the last 24 hours, and everything is in the audit log. There is no push or email.
- The agent runs when a worker's request is saved (the worker's save never fails because of it). Requests that arrive with no delegation get no agent record.
- Policy changes are versioned and audited. `maxRecoveryPercentOfPayout` is stored but not shown in the UI until Phase 4 uses it.
- Not covered by the end-to-end test (the Cashfree sandbox only): a delegation expiring on its own, production mode. Both are covered by the offline checks.

**Phase 4 notes (what was built and why it differs):**
- The planner is the pure function `planRecovery` (`app/lib/advance/recovery.ts`): oldest paid advance first, capped at `maxRecoveryPercentOfPayout` of gross and always leaving the worker at least ₹1; the rest carries to the next payroll. Whole rupees only.
- `Payout.amount` stays the net sent to Cashfree; `grossAmount` holds the wages and `deductions: [{advanceId, amount}]` the withheld part. Deductions are set in `submitPeriod`, and recomputed from fresh state in `decidePayouts` at the moment of approval (so an advance paid or repaid after submit is picked up). A pending payout also re-plans when an advance becomes paid or is taken back (this covers the Phase 1 note about payouts already pending).
- An advance is credited as recovered **only when the payroll transfer completes** (`syncRecoveryFromTx`, via submit, sync or webhook). A failed or retried transfer recovers nothing, and a completed transfer later reversed takes the credit back (`advance.recovery_reversed`). Pending and approved payouts reserve their deductions, so two payouts for one worker can't withhold the same rupees.
- Eligibility now subtracts recovered amounts: a fully recovered advance stops counting as outstanding and stops blocking a new one. Payroll already paid is counted at gross, so a deduction doesn't make the worker look under-paid.
- Owner-only `POST /api/advances/[id]/settle` records a repayment made outside payroll or writes off the rest (note required, audited, moves no money). It is refused while a payroll deduction for that advance is still in flight.
- UI: Payouts shows the deduction and the net; the policy panel has the recovery share; Advances shows what is owed per paid advance with Record repayment and Write off; `/me` shows what will be deducted.
- Verified against the Cashfree sandbox with real payroll (not just offline): a payroll of ₹7,812.50 went out as ₹7,712.50 net; a payroll transfer that failed recovered nothing and kept its deduction reserved; the retry completed and credited the advance exactly once, and repeated syncs did not credit it again; rejecting a payout released its reservation and the resubmitted payout was re-planned without double counting; a repayment and a write-off were recorded and audited, and a closed advance stopped blocking the worker.
- Found in review and fixed: the planner's net amount could carry float noise (for example 2.11 − 1 = 1.1099999999999999) in about 6% of cases. The Cashfree call already rounds to the paisa, so no payment was wrong, but stored amounts and sums were not exact. The net is now rounded to the paisa, with a regression check.
- A write-off is counted inside `recovery.recovered` (it clears the balance), so the amount forgiven is kept separately in `recovery.writtenOff`. Money actually collected is `recovered − writtenOff`.
- Known gaps: the Zoho dataset (workers can't use advances there yet); needs-review payouts get no deduction until they are recomputed as pending; if an approved payroll transfer fails and is never retried, its deduction stays reserved and the advance can't be settled until the transfer is retried or resolved. The advance status stays `paid` after recovery; "recovered" is derived from `recovery`.

**Voice-first request notes (added after Phase 4):**
- Flow: record (`VoiceRecorder`) -> `POST /api/me/advance/transcribe` (Sarvam Saaras, language auto-detected or picked by the worker) -> `POST /api/me/advance/parse` (Sarvam translation to English, Groq extraction of amount, reason and urgency, deterministic amount cross-check) -> worker reviews and edits -> `POST /api/me/advance` (saves; the server re-translates the saved original, never trusting a client-supplied translation) -> spoken confirmation only after the save succeeded.
- Both the original transcript and the English translation are stored (`transcript`, `transcriptEnglish`) and shown side by side in the staff queue, with the worker's stated urgency (`urgency`, a claim, not a rule). **Audio is not kept**: the worker can replay their own clip on the review screen only, and staff never get audio. This follows the earlier decision to store the transcript, never the audio.
- An amount the model did not find is never guessed from the words ("maybe two or three thousand" stays empty); the worker types it. A number written as digits must survive translation or the translation is dropped.
- Language picker (Auto, Bengali, Hindi/Hinglish, Kannada, Marathi, Tamil, Telugu, English) is remembered per device. Hinglish is transcribed as Hindi.
- The `brand-*` colour tokens came from the dropped UI commit and don't exist on main; this UI uses `teal-*` (the cause of the invisible microphone).
- **Voice screen** (`VoiceStage.tsx`, `VoiceOrb.tsx`, `useVoiceAudio.ts`): opened by "Tap to speak" on `/me`. A canvas fluid orb in the BolPay teal (`--color-voice-*` tokens in globals.css) driven by the real loudness of the microphone while listening and of Sarvam Bulbul's audio while it speaks (amplitude-reactive, not lip-sync). States: idle, listening, processing, translating, speaking, error. Sarvam returns the transcript only after the recording ends, so nothing is shown while the worker speaks; the original-language transcript then appears under the orb while translation runs. After the worker confirms on the light review screen and the server saves the request, the screen reopens only to speak the confirmation. It honours prefers-reduced-motion. Indic fonts (Noto Sans Bengali, Kannada, Tamil, Telugu) load on demand.
- A new theme token only reaches a running dev server after the stylesheet is touched or the server restarts.
- Tested with Sarvam's own synthetic voices (not real worker speech): Bengali, Hindi, Kannada, Marathi, Tamil, Telugu, English, Hinglish, no-amount. Real accents, noise and phone microphones are untested.

## 10. Phases and acceptance
1. **Worker request:** parse, confirm, eligibility, save and list. Tests: limit math, every block, idempotent resubmit, 10x amount mismatch.
2. **Approval:** queue, recommend, owner approve/reject, Cashfree sandbox transfer, webhook and sync reconcile. Tests: double approve, approve then retry, failed transfer, worker cannot reach staff routes.
3. **Delegation:** policy, delegation, deterministic agent, revoke, expiry, daily cap. Tests: expired and revoked block, cap exhaustion, human-required override, production flag.
4. **Recovery:** deductions on payroll, recovery on completion only. Tests: payroll fails, net below ₹1, partial carry, advance and payroll totals stay separate.

No test runner exists, so add `scripts/advance-check.mjs`-style checks for the pure eligibility, delegation and recovery functions, plus end-to-end runs against the Cashfree sandbox, which needs test funds under Payouts > Balance.
