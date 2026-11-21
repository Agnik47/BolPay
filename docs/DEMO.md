# Manual testing and demo guide

Everything here runs against the **Cashfree sandbox** (test API keys). No real money moves.

## 0. Start from a clean state
The database holds my earlier test payouts (riders 1, 2 and 25). To start fresh:

```powershell
# stop `npm run dev` (Ctrl+C), then:
Remove-Item -Recurse -Force .data
npm run dev
```

On the next request the app reseeds: 25 Bengaluru riders, rules v1, no current-period payouts. Open http://localhost:3000 in **Chrome** (the microphone needs a secure origin, and localhost counts).

Fixed demo date: the app's "today" is **3 Nov 2026**, and the current pay period is **21 Oct – 3 Nov 2026**. Dates are in `app/lib/merchant/mock-data.ts` (`TODAY`, `CURRENT_PERIOD`).

## 1. What is happening, step by step

| Step | What you do | What the system does |
|---|---|---|
| 1. Data | Workers / Attendance screens | Riders, attendance and deliveries ("units") are the only inputs. They are stored in `.data/db.json`. |
| 2. Calculate | Incentives screen, or the voice command "prepare" | The **rules engine** (`app/lib/merchant/incentives.ts`) computes base pay, overtime, per-unit incentive, daily delivery tiers and the attendance bonus. The AI never computes money. |
| 3. Check | Automatic on submit | Missing attendance days or an "absent but has deliveries" record flag the payout **Needs review**. Those can't be approved. |
| 4. Approve | Payouts screen (or voice) | Only `pending` payouts can be approved. Approving creates a transaction per rider and sends a **Cashfree UPI transfer** for each, in ₹, with an idempotent `transfer_id`. |
| 5. Track | Transactions screen | The page polls Cashfree every 4 s while anything is *processing* (webhooks do the same when configured). Statuses go processing → completed, or failed with a reason. Failed ones can be retried (new `transfer_id`). |
| 6. Voice | Round button, bottom-right | Mic audio → Sarvam AI speech-to-text → Groq LLM plans the steps → the server validates them and resolves the rider and date → you see a plan and press **Confirm** → Sarvam AI speaks the reply. |

## 2. What to tweak, and where

| To change | Where |
|---|---|
| Delivery tiers, overtime multiplier, bonus, attendance threshold | **Incentives** screen, bottom card, then **Apply**. This bumps the rules version, and each payout records the version it used. |
| A rider's wage, city or UPI ID | **Workers** screen. Click the wage to edit it; use **Add worker** for new riders. The UPI ID looks like `name@bank`; in sandbox use `success@upi` (pays) or `failure@upi` (fails). Workers with no UPI ID (new businesses, the Zoho dataset) can be given one in a click: the **Workers** screen shows a sandbox-only banner, **Assign test UPI IDs**, with an optional "Make N fail". Owners and supervisors (own team) can do it; it never overwrites a real ID and is refused when Cashfree is live, where a test ID can also never be saved or paid. |
| Attendance, deliveries and overtime | **Attendance** screen: pick the date, set the status buttons, overtime hours and units done. |
| Many riders or many days at once | **Workers → Import workers CSV / Import deliveries CSV**. Workers: `name, role, city, phone, payoutUpi, dailyWage`. Deliveries: `worker, date, deliveries, status, overtime`. |
| Which Cashfree account pays | `CASHFREE_CLIENT_ID` and `CASHFREE_CLIENT_SECRET` in `.env` (the **Payouts** keys, test mode), plus test funds under Payouts → Balance. |
| Voice and LLM | `SARVAM_API_KEY` and `GROQ_MODEL` in `.env`. |
| Seed riders, deliberate data problems | `app/lib/merchant/mock-data.ts`. After changing it, bump `SCHEMA_VERSION` in `app/lib/server/db.ts` or delete `.data`. |

Deliberate seed problems: riders **7 and 13** are missing attendance days, rider **18** is marked absent with 14 deliveries, and rider **25 (Carlos D'Souza)** has no UPI ID, so his payout fails on purpose.

## 3. Manual test checklist (about 15 minutes)

1. **Dashboard** loads with the period and stat cards. No red error banner.
2. **Workers:** 25 riders, all in Bengaluru, rider 25 shows "Missing" under UPI. Filter by city. Import a 2-row workers CSV and check the rows appear, then re-import it and check "already exists" is reported.
3. **Attendance:** open 3 Nov. Change rider 1 to Absent and back to Present with 25 units.
4. **Incentives:** the table has a Delivery tiers column. Change a tier bonus (₹100 → ₹120), click **Apply**, and check totals change and the version goes to v2. Click **Submit … for approval**. The banner should say how many are submitted and how many are Needs Review.
5. **Payouts:** the **Needs review** card lists riders 7, 13 and 18 with reasons. In **Awaiting approval**, expand **Details** on a rider: it shows the breakdown and rules version.
6. **Approve a few, not all.** Select riders 1 to 4 and click **Approve selected → Yes, approve**. Every seeded rider uses `success@upi`, so they all succeed, but approving a few keeps the sandbox balance healthy.
7. **Transactions:** rows show *processing*, then *completed* within about a minute, with the ₹ amount and the bank UTR once Cashfree has one. The page updates itself.
8. **Failure and retry:** approve rider 25 (no UPI ID). It fails with "Worker has no valid UPI ID on file". On **Workers**, give him `success@upi`, then press **Retry** on Transactions. It should complete. To see a Cashfree-side failure instead, set a UPI ID of `failure@upi` and approve.
9. **Needs review fix:** on Attendance, mark rider 7 present on 2 Nov, then **Incentives → Submit** again. Rider 7 moves to Awaiting approval.
10. **Cashfree side:** in the Cashfree dashboard (Test mode) open **Payouts → Transfers**. Each BolPay payout appears with its `transfer_id` (`bp_…`) and status.

## 4. Voice flow
The assistant now handles multi-step sentences, follow-up questions, spoken "confirm" and exact-amount checkpoints. The full guide and a manual test script are in [VOICE.md](./VOICE.md); the short version is below.

Click the round teal button (bottom-right) to open the panel.

1. Press **Tap and speak**, say the command, press again to stop.
2. The app transcribes, interprets and shows a plan card. Informational answers (status questions) appear directly with **Read aloud**. Actions show **Confirm / Cancel**.
3. After Confirm, the action runs and the reply is spoken (the speaker icon toggles voice replies). You can also type a command in the box.

**What to say (English)**

| Say | What happens |
|---|---|
| "Calculate incentives for all Bengaluru riders who completed at least twenty deliveries today." | Plan: prepare, city Bengaluru, ≥ 20 deliveries on 3 Nov. Confirm → qualifying riders appear on Payouts. |
| "Prepare payouts." | Submits everyone not yet submitted, including the Needs Review ones. |
| "Mark Ravi Kumar present today." | Plan: set attendance. Confirm to apply. |
| "Anita Sharma worked two hours overtime today." | Records overtime. |
| "Record twenty-five deliveries for Mohammed Ali." | Records units. |
| "Approve Ravi Kumar's payout." | Approves one pending payout and sends it through Cashfree. |
| "How many payments failed?" / "What is the payout status?" / "Which workers have pending payments?" | Answered from the stored statuses and spoken back. |
| "Open transactions." | Navigates to that screen. |

**Hindi example:** "आज रवि कुमार को उपस्थित मार्क करो।" (Mark Ravi Kumar present today.) Replies come back in the language you spoke. Kannada, Tamil and Bengali are untested.

Avoid "approve all" while testing: it approves every pending payout.

## 5. Suggested demo script (under 3 minutes)
1. (10 s) One-line pitch. Dashboard on screen.
2. (30 s) Voice: "Calculate incentives for all Bengaluru riders who completed at least twenty deliveries today." Show the plan (city, threshold, date), **Confirm**.
3. (20 s) Payouts: point at the **Needs review** card (missing attendance, conflicting record), open **Details** to show tiers and the rules version.
4. (30 s) Approve riders 1 to 4. Say it plainly: "Nothing is paid until a human approves."
5. (30 s) Transactions: processing → completed. Show the ₹ amount and the UTR. Optionally show the transfer in the Cashfree dashboard.
6. (20 s) Voice: "How many payments failed?" and let it speak the answer. Show rider 25's failure and **Retry** after adding the email.
7. (20 s) Close with the architecture line: voice → validated plan → rules engine → human approval → Cashfree UPI payout → verified status.

Record a backup video of a clean run first, in case the network fails during judging.

## 6. If something goes wrong
- **Approve fails with an authentication or "IP not whitelisted" error:** wrong keys (use the Payouts keys, not Payment Gateway), or you are in production without your server IP whitelisted. Check `CASHFREE_ENVIRONMENT`.
- **Transfers fail with insufficient balance:** add test funds under Payouts → Balance.
- **Voice says "not configured" (503):** a missing `SARVAM_API_KEY` or `GROQ_API_KEY`. Restart the server after editing `.env`.
- **Mic button does nothing:** use Chrome, allow microphone access, and use `localhost`, not a LAN IP.
- **Weird state:** stop the server and delete `.data`.
- **Webhooks:** optional. Without a public URL the page's polling replaces them; to test them, tunnel the app and register `/api/webhooks/cashfree` (see the README).

## 7. Zoho HRMS import (optional second dataset)
1. Complete the one-time setup in the README (Zoho Client ID and Secret in `.env`).
2. Owner: **Integrations → Connect Zoho → Sync now**. The result card shows employees created and attendance records imported.
3. Switch the sidebar **Dataset** to **Zoho HRMS**. Workers shows the synced employees (department, city, joining date), all with the default daily wage and their Zoho email.
4. Attendance is mostly empty for test employees, so say: **"Mark everyone present on weekdays this month"** or use the Attendance screen. Until weekdays are marked, **Payouts → Needs review** lists everyone, which is the safeguard working.
5. Give a few employees a test UPI ID: **"Set Michael Johnson's UPI ID to success@upi"**, **"Set Michael Johnson's daily wage to two thousand"**.
6. **"Prepare payouts for Michael Johnson, then approve Michael Johnson's payout"**: confirm the exact-amount checkpoint, watch the payment complete on Transactions.
7. Change something in Zoho (a status or a department), press **Sync now** again, and show that identity updates while the wage and UPI ID you set are kept.
8. Switch back to **Demo** to show the trained dataset is untouched.

### Zoho demo: getting recipients that can be paid
Zoho People has no payment details, so imported employees start with no UPI ID and their payouts fail with "Worker has no UPI ID on file" until you add one. In the sandbox give them `success@upi` (by voice or on **Workers**) and the payments complete. For real use, collect each employee's UPI ID and enter or import it.
