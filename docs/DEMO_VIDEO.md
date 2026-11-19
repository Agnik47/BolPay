# Demo video: script, shot list and how to build it

Target: **2 minutes 55 seconds** (under 3 minutes, public on YouTube, shows the project working). One narrator, plus the manager's spoken voice commands, which you can say live into the mic.

> **Status (2026-11-20): this kit was first written and timed for the previous payment screens and voice provider.** The script text now describes the Cashfree flow, but every timecode, "stand-in length" and ₹ checkpoint figure below comes from the earlier take. Re-record the Cashfree flow, re-measure the narration with the new voice, and update the timeline before editing. Treat section 4 as the structure, not the final timing.

## 0. How the timing works (read this first)

Generate each narration clip with the Sarvam AI voice (section 6) and measure it. Two rules keep the edit simple:
1. **Events drive the cuts, not the clock.** Record each screen block separately (section 5) and slide each narration clip so it starts when its visual appears (the "Starts when" column).
2. **After generating, re-measure** each clip and shift later clips by the difference. If the total passes 3:00, apply the trims in section 4.

## 1. The cast

| Voice | Who | Where it comes from |
|---|---|---|
| **Narrator** | The pitch voice-over | Sarvam AI text-to-speech (clips N1 to N10) |
| **Manager** | Gives the spoken commands to BolPay | You, live into the mic (best), or clips generated from M1 to M4 |
| **BolPay** | The assistant's spoken replies | The app itself (Sarvam AI text-to-speech), recorded from system audio |

## 2. Before you record: pre-flight checklist

**Data state (important: the numbers on screen depend on it)**
1. Demo data must be fresh: stop `npm run dev`, delete **only** `.data/db.json`, start it again. (Do **not** delete `.data/zoho.json` or `.data/integrations.json`: they hold your Zoho employees and the connection.) After any rehearsal, repeat this.
2. Check on the Incentives page that rules are still **version 1** (tiers 10 / 20 / 30 → ₹50 / ₹100 / ₹150). Then Ravi Kumar's payout is **₹7,812.50** and Mohammed Ali's **₹9,403.75**, so the checkpoint shows **2 payments totalling ₹17,216.25** (these figures come from the rules engine, not the payment provider, so they still hold). If your numbers differ, the rules changed; the video works either way, since the narration never says a number.
3. Zoho must be connected with employees synced (Integrations page shows **Connected**).
4. Cashfree is in **Test mode** with the Payouts keys in `.env`, and the Payouts balance is funded with test funds. Rider 25 (Carlos D'Souza) deliberately has no UPI ID; he is the failed-payment shot.

**Browser and accounts**
5. Sign in as the owner: `owner@demo.bolpay.app` / `BolPayDemo#2026`.
6. Chrome, 1920×1080, zoom 110 percent, bookmarks bar hidden, notifications off (Windows Focus Assist), one clean window.
7. Open one more window ready and **already signed in**, so no passwords appear on camera: the Cashfree dashboard (Test mode) already signed in, on **Payouts → Transfers**.
8. Microphone allowed for `localhost`. Voice replies **on** (speaker icon in the voice panel). Test once with "How many payments failed?" (read-only, changes nothing), then **New conversation**.
9. Recorder: OBS Studio, 1920×1080, 30 fps, **desktop audio and microphone on separate tracks**.

## 3. The script (what the narrator says)

Clip ids match `docs/demo-video/narration.json`. The text below has no delivery tags. "Stand-in length" is from the earlier take: re-measure with the Sarvam AI voice, especially N2, N6, N8, N9 and N10, whose wording changed.

| Clip | Narrator says | Stand-in length |
|---|---|---|
| **N1** | Every pay cycle, a manager somewhere is stitching together attendance, deliveries, bonuses and bank details from spreadsheets and chat threads. It takes hours... and one wrong cell means someone gets paid wrong. | 13.7 s |
| **N2** | This is BolPay. Speak. Approve. Pay. You say what you need, a rules engine does the maths, a human approves, and Cashfree sends the money straight to the worker's UPI. | re-measure |
| **N3** | And you don't start from scratch. This is a real Zoho People account. One click, and every employee, and this month's attendance, flow into BolPay. No retyping. Pay settings stay in BolPay, so a re-sync never overwrites a wage. | 15.4 s |
| **N4** | Now the good part. The manager just talks, in one breath, and BolPay turns it into a plan. | 6.6 s |
| **N5** | Three steps, in order. Nothing has moved yet. | 3.7 s |
| **N6** | Before a single rupee moves, it shows the exact number of payments and the exact total. Only a second confirm sends it. | re-measure |
| **N7** | Nothing is paid blindly. Riders with missing or conflicting records land in Needs Review, and can't be approved until someone fixes them. Owners approve. Supervisors record attendance. Workers see only their own pay. | 15.3 s |
| **N8** | And this is real. Live UPI payouts through Cashfree, moving from processing to completed. Here they are in the Cashfree dashboard. | re-measure |
| **N9** | If a payment can't go through, say a worker has no UPI ID on file, BolPay says so plainly, and one click retries it once it's fixed. | re-measure |
| **N10** | Voice first. Rules you can trust. A human on every payment. Real UPI payouts. And a way in from the HR tools businesses already use. BolPay. Speak. Approve. Pay. | re-measure |

Narration total: about 110 s in the earlier take. **Manager lines** (say them naturally, one breath each):

| Clip | Manager says | Length |
|---|---|---|
| **M1** | "Mark Anita Sharma absent today, then prepare payouts for Ravi Kumar and Mohammed Ali, then approve everything that's pending." | 8.7 s |
| **M2** | "Confirm." | 1.1 s |
| **M3** | "Yes, go ahead." | 1.5 s |
| **M4** | "Prepare payouts for everyone." (typed, not spoken; see 1:43) | 2.3 s |

## 4. Master timeline (this is the one to edit against)

Times are video time (m:ss). "Starts when" tells you the visual event that triggers the clip, so you can re-time if your voice runs long.

| Time | Visual (what is on screen) | Audio | Starts when |
|---|---|---|---|
| 0:00 – 0:14 | **Dashboard**, Demo dataset. Slow cursor drift over the stat cards. Overlay text: "Payroll today: spreadsheets + chat threads." | **N1** | First frame |
| 0:14 – 0:24 | Same dashboard. Overlay the tagline **"Speak. Approve. Pay."** and the logo. At the end, the cursor moves to the round voice button (bottom right). | **N2** | Tagline appears |
| 0:24 – 0:46 | **Zoho import.** Click **Integrations** in the sidebar (page shows **Connected**). 0:27 click **Sync now**. ~0:29 toast "Synced 20 employees from Zoho". 0:32 click **Open Zoho data** (top right): the Workers screen loads with the Zoho employees. Scroll slowly. 0:44 click **Dataset → Demo** in the sidebar (page reloads to the dashboard). | **N3** (ends ~0:40; the last 6 s are silent screen time) | The Integrations page is visible |
| 0:46 – 0:53 | Demo dashboard. Click the round **voice button**, panel opens. Move the cursor to **Tap and speak**. | **N4** | Cursor goes to the voice button |
| 0:53 – 1:03 | Click **Tap and speak**, say **M1**. The transcript appears as your chat bubble. | **M1** (live mic) | You click the mic |
| 1:03 – 1:10 | The **plan card** appears with 3 numbered steps (mark attendance, prepare payouts, approve and send). BolPay reads it aloud. At ~1:09.5 tap the mic to cut the reading. | BolPay's voice (app) | Plan card appears |
| 1:10 – 1:14 | Zoom in on the plan card (editor zoom 120 percent). | **N5** | The reading stops |
| 1:14 – 1:16 | Tap the mic, say **M2**. | **M2** (live) | You tap the mic |
| 1:16 – 1:25 | Steps 1 and 2 tick off. The **amber checkpoint card** appears: "Before I send money: 2 payments totalling ₹17,216.25". BolPay reads it aloud. Hold on the amounts. | BolPay's voice (app) | Amber card appears |
| 1:25 – 1:34 | Zoom in on the amber card and the **Confirm and send** button. | **N6** | The reading ends |
| 1:35 – 1:37 | Tap the mic, say **M3**. | **M3** (live) | You tap the mic |
| 1:37 – 1:43 | All three steps show ✓. BolPay says "Done... approved 2 payouts... and sent them to Cashfree." Let it play about 5 s. | BolPay's voice (app) | The ticks complete |
| 1:43 – 1:49 | Click the **speaker icon** in the panel (voice replies off). In the text box type **M4** ("Prepare payouts for everyone") and press Go; click **Confirm** on the plan card. Then click **Payout approvals** in the sidebar. | silent (typing sounds only) | The Done speech ends |
| 1:49 – 2:04 | **Payout approvals.** The **Needs review** card is at the top, listing riders with missing or conflicting records and the reason under each. Hover or expand one **Details** under *Awaiting approval* to show the breakdown (base, overtime, delivery tiers, rules version). | **N7** | Needs review card visible |
| 2:05 – 2:11 | **Transactions.** Rows for Ravi Kumar and Mohammed Ali show **Completed** (the ₹ amount and the bank UTR under it). A "Payment completed" toast slides in if you are recording as it lands. | **N8** (first half) | Transactions page loads |
| 2:11 – 2:20 | Switch to the **Cashfree dashboard window, Payouts → Transfers**: the two transfers (₹7,812.50 and ₹9,403.75) with their `bp_…` transfer ids at the top; open one to show its status and UTR. | **N8** (second half), then **N8b** | You switch windows |
| 2:20 – 2:27 | Back in the app: **Payout approvals**, select Carlos D'Souza (no UPI ID) and approve. Then **Transactions → Failed**. | silent | You switch windows |
| 2:27 – 2:38 | **Transactions, Failed tab.** Carlos's row shows the red **Failed** badge with "Worker has no UPI ID on file" and the **Retry** button. | **N9** | The failed row is visible |
| 2:39 – 2:53 | Cut to the **dashboard** (or an end card): logo, **Speak. Approve. Pay.**, the repo URL. | **N10** | End card appears |
| 2:53 – 2:55 | Fade to black. | none | |

**Total about 2:55.** If your narrator is slower and the total passes 3:00, trim in this order: (1) cut **N5** and the 1:10 zoom (saves 4 s); (2) drop the Cashfree transfer-detail shot at 2:11 (8 s); (3) shorten N7 to its first sentence (7 s).

**Timing note for the payments:** a sandbox payout can take from seconds to a minute or two to complete (measure it on your first run). Record the Transactions page and the Cashfree dashboard (the 2:05 to 2:20 block) **after** the payments have completed, as separate clips, and cut them in. If you also want the "processing → completed" change on camera, start a screen clip right after M3 and trim it.

## 5. How to record each block

Record these as separate clips (OBS: one scene, stop/start between blocks). Save as `01-dashboard`, `02-zoho`, `03-voice`, `04-payouts`, `05-transactions`, `06-cashfree`, `07-failed`, `08-endcard`.

1. **01-dashboard** (15 s): Demo dashboard, slow drift. Record 25 s so you can trim.
2. **02-zoho** (25 s): Integrations → Sync now → toast → Open Zoho data → Workers → scroll → switch back to Demo. Practice the click order once.
3. **03-voice** (65 s): one unbroken take of the voice conversation from the click on the round button to the "Done" speech. System audio **on**, mic **on**. Say M1, M2, M3 live. Tap the mic to cut BolPay's plan reading at about 6 s. If a command is mis-heard, press **New conversation** and redo the take.
4. **04-payouts** (20 s): type M4, confirm, open Payout approvals, expand one rider's Details.
5. **05-transactions** (20 s): after payments completed. Show tabs and the Completed rows with their UTR.
6. **06-cashfree** (20 s): the signed-in Cashfree dashboard, Payouts → Transfers, open one transfer.
7. **07-failed** (15 s): Payout approvals → approve Carlos D'Souza → Transactions → Failed row → Retry visible.
8. **08-endcard**: a static slide (Canva, PowerPoint or Clipchamp): logo, tagline, repo URL. No third-party logos (see section 8).

Option if you do not want to speak on camera: type M1 to M3 into the box in the voice panel (the typing is visible), and lay generated manager clips over those moments in the edit.

## 6. Generate the narration with Sarvam AI

1. Choose an Indian-English voice in Sarvam AI's text-to-speech and keep the pace natural.
2. Paste each clip's text from section 3 (N1 first), generate, listen, and save as `N1.mp3` and so on. One clip per generation; re-generate any that sound rushed.
3. Write each clip's length next to its id and update the timeline (section 4).
4. `scripts/demo-narration.mjs` still calls the previous voice provider. It is replaced as part of the Sarvam AI integration; until then generate clips by hand. The clip texts live in `docs/demo-video/narration.json`.

## 7. Edit it together (CapCut, DaVinci Resolve or Clipchamp)

1. New 1920×1080, 30 fps project. Import the eight screen clips and the narration clips.
2. Place the screen clips and narration on the timeline following section 4. Put narration on its own audio track, **screen/system audio on another** (BolPay's replies), the microphone track on a third.
3. **Ducking:** lower the system-audio track by about 12 dB whenever a narration clip plays. During BolPay's replies and the manager's lines the narrator is silent by design, so no overlap.
4. **Zooms:** add a slow zoom (110 to 130 percent) on the plan card (1:03), the amber checkpoint card (1:16), the Needs review card (1:49) and the failed-payment row (2:27). Add a soft cursor highlight if your recorder has one.
5. **Captions:** burn in subtitles from the section 3 text (judges often watch muted). Put the manager's spoken commands on screen as captions too.
6. **Overlays (keep them to text):** a 2-second lower-third on each new screen: "Zoho People import", "One sentence, three steps", "Exact amounts before any money moves", "Live Cashfree UPI payout", "Needs Review safeguard", "Failed payment and retry".
7. Fade in at 0:00 and out at 2:53. No music is needed; if you want a bed, use only a track from the YouTube Audio Library (no copyrighted music is allowed).
8. Export H.264 MP4, 1080p, 30 fps, **under 3:00**.

## 8. Upload and submission checklist

- Upload to YouTube as **Public**. Title: `BolPay: Speak. Approve. Pay. | Voice-first payroll with Cashfree UPI payouts`.
- The video must show the project working: keep the real screens; don't use mockups.
- No third-party trademarks or copyrighted material: keep the Cashfree dashboard shots short and functional, don't use Cashfree, Zoho or Sarvam AI logos on your title or end cards, and use no copyrighted music.
- Paste the YouTube link into the submission form. Keep the README run steps current (judges can run it themselves).

**YouTube description (paste):**
```
BolPay is a voice-first workforce payout agent. Say what you need in one sentence, a rules engine calculates the pay, a human approves with the exact amounts on screen, and Cashfree Payouts sends the money by UPI. Employees and attendance import from Zoho People, and a payment that cannot go through shows its reason and can be retried.

Built with Next.js, Cashfree Payouts, Sarvam AI (speech-to-text and text-to-speech) and Groq.
```

**Project description (paste, about 230 words):**
```
BolPay turns payroll into a conversation. Managers who pay riders, packers or contractors spend hours reconciling attendance, deliveries and bonuses. With BolPay they speak one sentence, in English, Hindi or Hinglish: "Mark Anita absent, prepare payouts for Ravi and Mohammed, then approve everything that's pending."

How it works: Sarvam AI transcribes the voice, a Groq language model turns it into an ordered plan, and the server checks every step against real records. A deterministic rules engine (wage, overtime, daily delivery tiers, attendance bonus) calculates every amount: the AI never does the maths and can never approve a payment by itself. Anything that moves money pauses on an exact checkpoint (payment count and rupee total) and needs a second confirmation. Cashfree Payouts then sends the money to each worker's UPI ID, with idempotent transfer ids and webhook signature verification; statuses sync back, including failures with their reason.

Real adoption needs a way in, so BolPay imports employees and attendance from Zoho People (OAuth), keeps pay settings under the owner's control on every re-sync, and keeps the trained demo data in a separate dataset. Roles (owner, supervisor, worker) decide who may approve, record attendance, or only see their own pay.

Built with: Next.js 16, Cashfree Payouts V2 REST API, Sarvam AI (speech-to-text and text-to-speech), Groq (gpt-oss), Supabase Auth, AG Grid, Zoho People API.
```

## 9. Optional extras (only for a longer cut, not the 3-minute one)

- **Hindi moment (8 s):** after the Done speech, say "रवि कुमार को आज उपस्थित मार्क करो"; BolPay shows the plan and answers in Hindi.
- **AG Grid attendance history (5 s):** Attendance page, scroll to the history grid, sort a column, filter a rider.
- **Rules by voice (10 s):** "Set the twenty delivery bonus to one hundred fifty rupees" shows the rules version go up.
- **Role view (8 s):** sign in as `supervisor@demo.bolpay.app` to show the money pages are not there.

## 10. If something goes wrong on the day

| Problem | Fix |
|---|---|
| The assistant mis-hears a command | **New conversation**, say it again slower; or type it. |
| Groq answers "busy" | Wait 30 seconds (free tier: 8,000 tokens per minute per model; it fails over to a second model automatically). |
| A payment is still processing | Keep working; record the Transactions block later. |
| Numbers differ from the table | Rules changed or the data wasn't fresh: repeat the reset in section 2. |
| You need a retake of the whole voice block | Delete `.data/db.json`, restart the server, repeat. |
