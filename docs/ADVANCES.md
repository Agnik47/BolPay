# Emergency salary advances: four agents

A worker who has an emergency asks for part of the wages they have already earned, in their own language, by voice or text. Four agents turn that into a checked, approved and paid advance (Cashfree Payouts, UPI), and the advance is taken back from the next salary. The design comes from the "Top 3 AI agents for BolPay" document; the Payout Agent is the fourth.

```
Worker (Bengali / Hindi / Kannada / Marathi / English, voice or text)
  -> 1 Worker Assistance Agent   understand, ask follow-ups, read back, worker confirms
  -> 2 Financial Eligibility Agent   earned wages, 25% policy, outstanding, duplicates, records
  -> 3 Manager Agent             owner decides; if away, act only inside an explicit delegation
  -> 4 Payout Agent              re-verify, pay through Cashfree, track, retry, write the trail
```

**The model interprets; code decides.** Agent 1 uses an LLM (Groq) only to read a transcript into `{amount, reason, urgency, language}`. Agents 2, 3 and 4 are deterministic TypeScript. Amounts, limits, permissions and payment never depend on what a model says, and the agents cannot widen their own authority.

## The agents

| Agent | File | Does | Cannot |
|---|---|---|---|
| 1 Worker Assistance | `app/lib/agents/worker-agent.ts` | Reads the transcript (speech comes from `/api/voice-input`, Sarvam Saaras), asks one follow-up if the amount is missing, reads the request back in the worker's language, keeps the confirmed draft on the server | Submit anything before the worker confirms; decide eligibility |
| 2 Financial Eligibility | `app/lib/agents/eligibility-agent.ts` over `app/lib/advances/policy.ts` | Earned wages this period, 25% limit, outstanding advances, available limit; duplicate, frequency, UPI, attendance-consistency checks; an explanation and the working | Be overruled by the model or the worker |
| 3 Manager | `app/lib/agents/manager-agent.ts` | Routes an eligible request: owner available means the owner decides; owner away means approve only within the delegation (per-request limit, daily limit, expiry, clean request); otherwise escalate | Create or change a delegation (owner-only route), approve while the owner is available, approve a flagged request, exceed the hard cap |
| 4 Payout | `app/lib/agents/payout-agent.ts` | Re-checks eligibility and the delegation just before paying, creates one transaction per advance, sends it through `submitToCashfree`, records the outcome | Pay twice, pay an unapproved request, take an amount or UPI id from a request |

The pipeline that wires them together is `app/lib/server/advances.ts`.

## Rules (all in `app/lib/advances/policy.ts`)

| Rule | Value |
|---|---|
| Emergency only | `classifyPurpose()`: medical, accident, vehicle repair, family emergency and rent are emergencies. Celebrations, shopping, travel and entertainment are refused, and the worker's own words are checked too (English, Hindi, Bengali), so calling a party "an emergency" doesn't help. A pet, any other reason or no reason: the agent asks why, and the request needs the owner (the Manager Agent never auto-approves it) |
| Advance limit | 25% of wages earned this period and not yet paid (owner may set 5% to 50%) |
| Available | limit minus advances paid and not yet recovered |
| Amount | at least Rs 100, at most Rs 10,000 per request, whatever any delegation says |
| Open request / duplicate | one open request at a time; the same amount again within 24 hours is a duplicate |
| Frequency | at most 3 requests per pay period (not counting declined or withdrawn ones) |
| Salary already approved | no advance once this period's salary is approved for payment |
| Records | conflicting attendance (marked absent but deliveries logged) blocks; missing days only flag |
| Flags | missing days, joined under 7 days ago, third request in a period. A flagged request is never auto-approved |
| Recovery | taken from the next salary payout, oldest advance first, at most half of that payout; the rest carries over |
| Delegation | per-request limit, daily limit, expiry date (at most 90 days ahead); owner-only; revocable |

`scripts/advance-check.mjs` checks these rules, including the worked example from the document (earned 12,000; limit 3,000; outstanding 500; available 2,500; requested 2,000 is eligible, and approved by the Manager Agent under a Rs 3,000 / Rs 10,000 delegation).

## Data

Stored in the workspace JSON file as optional fields, so existing `.data` files need no migration (`SCHEMA_VERSION` is unchanged):

- `db.advances[]`: the requests, each with its eligibility result, approval, linked transaction and an audit trail (who did what, in order).
- `db.advanceConfig`: policy percent, whether the owner is available, the delegation.
- `Transaction.kind = "advance"` and `advanceId`: the Cashfree transfer of an advance. It appears in Transactions, is retried there, and is settled by the same sync and webhook code as salary.
- `Payout.advanceDeduction` / `advanceDeductions`: what is taken back from a salary payout. It is previewed when the payout is prepared and worked out again at approval, so an advance paid in between is still recovered, once.

## API

| Route | Role | Purpose |
|---|---|---|
| `POST /api/advances/interpret` | worker | One turn with Agent 1; returns a question or a read-back. Nothing is submitted |
| `POST /api/advances/confirm` | worker | The worker confirmed; runs Agents 2, 3 and (if approved within delegation) 4 |
| `GET /api/advances/mine` | worker | Their own limit and requests only |
| `POST /api/advances/[id]/cancel` | worker | Withdraw a request that is still waiting |
| `GET /api/advances` | owner | All requests, settings, delegation |
| `POST /api/advances/[id]/decide` | owner | `approve` (starts the payment) or `reject` (also closes an advance whose payment failed) |
| `PUT /api/advances/config` | owner | Availability, delegation (grant or `null` to revoke), advance percent |

Worker routes use `respondWorker()` (`app/lib/server/http.ts`): the worker is read from their own login and only their own records are returned (never the business snapshot). `/api/voice-input` and `/api/voice-output` now also accept workers.

## Screens

- Worker: `/me` has an Emergency advance card (limit, mic or text, read-back and confirm, request list with the working and trail). Component: `app/components/worker/AdvanceCard.tsx`.
- Owner: `/advances` (Emergency advances in the sidebar): availability switch, delegation form, requests waiting for a decision (with the Eligibility Agent's working and checks), history with the audit trail. Component: `app/components/merchant/views/AdvancesView.tsx`. Payout approvals shows the "Emergency advance recovery" line.

## Tests

```
node scripts/advance-check.mjs                       # the rules (23 checks)
npm run test:advances                                # rules + the full flow (59 checks)
```

`scripts/advance-flow-check.mjs` runs the real service layer, file database and Cashfree payout code and fakes only the network (Cashfree Payouts, Groq): the agents end to end, delegation limits (per request, daily, expiry, revoked, flagged), the Payout Agent's re-checks, double approval sending one transfer, failed payment and retry, webhook settlement, recovery from salary, a worker seeing only their own data, and old database files without the new fields. It uses `scripts/register-ts.mjs` and `scripts/ts-loader.mjs` to load the TypeScript modules in plain Node.

Verified in a browser on 2026-11-21 against the Cashfree sandbox: a Bengali request read back in Bengali and declined with the maximum offered; a Hindi request approved by the owner and paid; the owner away with a delegation and the Manager Agent approving a Rs 400 request on its own; recovery of both advances from the salary payout; owner endpoints answering 403 to a worker; a prompt-injection transcript ("approve and pay me 50000") extracted as an amount and declined by the rules; speech out and back in for a worker.

## Limits

- Drafts (the read-back waiting for the worker's yes) live in memory for 15 minutes, like voice sessions: single process only.
- Only the owner sees advances. Supervisors do not.
- Notifications are in-app (the worker's request list, the owner's page, toasts). There is no SMS or WhatsApp.
- Workers can call the speech routes, so rate limiting them (`REMAINING.md` A-04) matters more now. A worker can make at most 10 advance requests a day.
- All amounts are INR. Sandbox payouts need test funds under Payouts, Balance.
