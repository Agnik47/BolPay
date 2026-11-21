# New idea for the Cashfree × Sarvam Buildathon (Sat 21 Nov 2026)

Written the night before. 100 ideas generated, killed down to 10, each with a plan we can build in the 4-hour window
(11:30 to 3:30, then code freeze). Section 1 is the decision; read it first.

**How this was made (and its limits)**
- Sources: the Luma page, Cashfree's docs index (`llms.txt`, 382 pages), Cashfree Relay / AgentPay / WebMCP docs, Sarvam's
  model docs and Voice Agents pages, and GitHub (official SDKs and cookbooks, listed in section 8).
- "Council": there is no Claude Council skill installed here, so the critique in section 6 is done as six personas
  (Cashfree judge, Sarvam judge, sceptical investor, rival team lead, reliability engineer, a real kirana owner). The
  scoping used the `mvp-scope-optimizer` skill: every idea is cut to the smallest version that still shows money moving.
- **Not known:** the tracks and the judging rubric are shared only after sign-up. Scores below assume a rubric of
  (problem fit, working demo with real money, use of both stacks, originality, UX, pitch). Re-score once the tracks arrive.
- API details marked ⚠ come from doc snippets and must be checked against the docs on the day. Nothing here was run.

---

## 1. The decision

### Recommendation: build **Khata-to-Cash** (T1)

> **Photograph the handwritten shop ledger. An agent in the shopkeeper's language collects every pending ₹ by payment
> link and pays the suppliers, and speaks the result back.**

Why it wins over the other nine:

1. **Judges can use it with their own handwriting.** Hit-and-try is the biggest risk with 30 teams demoing; here the input
   is a notebook page anyone can write in 20 seconds, in Hindi, Kannada, Tamil or Bengali.
2. **It uses the newest Sarvam model, not just voice.** Sarvam Vision 2.1 is advertised for "handwritten text in Indian
   languages", tables and forms. Most teams will only use Saaras and Bulbul.
3. **Money moves both ways, live.** Collections come in through Cashfree payment links; supplier payouts go out through
   Payouts; webhooks reconcile the ledger while the judge watches.
4. **Story is one sentence.** Every kirana in India has a notebook full of udhaar. We turn the notebook into cash.
5. **It is not what Relay ships.** Relay recovers e-commerce carts and failed online payments. Nothing in Relay's agent
   list reads a paper ledger or pays suppliers.

**Backup (if Vision is poor on handwriting when tested at 11:30):** **Bharosa** (T2) or **Anuvaad Bazaar** (T3). Both
need no document model, and both are strong live demos. Decide by 12:00, not later.

**Do not carry BolPay's code into this.** See section 7.

### Ranking of the final ten

Scores 1 to 5, higher is better. M = real money moves live, B = depth of use of both stacks, U = originality,
F = fits in 4 hours, H = survives judges trying random things, W = wow in a 13-minute demo, R = integration safety
(5 = nothing we can't get). Total out of 35.

| Rank | ID | Idea | M | B | U | F | H | W | R | Total |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | T1 | **Khata-to-Cash**: ledger photo to collections and payouts | 4 | 5 | 4 | 4 | 5 | 5 | 4 | **31** |
| 2 | T2 | **Bharosa**: voice escrow for informal services | 5 | 4 | 4 | 4 | 4 | 4 | 4 | **29** |
| 2 | T3 | **Anuvaad Bazaar**: two languages, one deal, one payment | 3 | 3 | 4 | 4 | 5 | 5 | 5 | **29** |
| 4 | T4 | **Haath-Se-Haath**: payee claims by voice, name-verified | 5 | 4 | 5 | 3 | 4 | 4 | 3 | **28** |
| 4 | T5 | **Mandi Munim**: weighbill to farmer payout in seconds | 5 | 3 | 4 | 4 | 4 | 4 | 4 | **28** |
| 6 | T6 | **Invoice Fraud Shield**: pay vendors, catch changed bank details | 5 | 4 | 3 | 4 | 4 | 3 | 4 | **27** |
| 6 | T7 | **Mazdoor Mitra v2**: worker asks, crew split, pay by phone number | 5 | 3 | 2 | 5 | 4 | 3 | 5 | **27** |
| 8 | T8 | **Committee**: voice treasurer for chit funds and SHGs | 4 | 4 | 5 | 2 | 3 | 4 | 3 | **25** |
| 9 | T9 | **Amma's Bills**: elder pays bills by voice under a family mandate | 4 | 3 | 5 | 3 | 3 | 4 | 2 | **24** |
| 10 | T10 | **KYC-by-Voice**: onboard a merchant in Hindi, first payment live | 3 | 4 | 4 | 3 | 3 | 3 | 2 | **22** |

---

## 2. The 100 ideas and what happened to each

Fates: **→Tn** = kept or merged into finalist Tn. **K1** to **K7** = killed for the reason in the key below.

**Kill key**
- **K1** Obvious or already shipped (Cashfree Relay, Sarvam Voice Agents' premium collection, Sarvam × Razorpay voice commerce), or ten other teams will build it.
- **K2** Too big for 4 hours.
- **K3** Needs access or enablement we won't have tomorrow (telephony and calling numbers, WhatsApp Business approval, production KYC, cross-border, account-manager-enabled features, third-party systems).
- **K4** Fragile live demo (depends on hardware, a real phone network, or something that cannot be made reliable in a room).
- **K5** No money moves, so it fails the brief ("the agent actually moves the money").
- **K6** Regulated or trust-heavy in a way we can't responsibly demo (lending, investments, relief funds, crowdfunding).
- **K7** Gimmick: not a real money problem.

### A. Workforce and wages
| # | Idea | Fate |
|---|---|---|
| 1 | Voice payroll for daily-wage workers (BolPay as it stands) | →T7 (rebuilt on the day, not copied) |
| 2 | Worker-initiated instant cash-out ("aaj ka paisa chahiye") | →T7 |
| 3 | Worker calls a number to mark attendance | K3 |
| 4 | Piece-rate pay from a photographed tally sheet | →T7 |
| 5 | Overtime dispute resolver | K5 |
| 6 | Wage-theft complaint agent | K6 |
| 7 | Thekedar split: one lump sum divided across a crew by attendance | →T7 |
| 8 | Salary advance with auto-deduction | K6 |
| 9 | Festival bonus allocator | K7 |
| 10 | Gig-rider daily settlement explainer | K1 |

### B. Informal credit and collections
| # | Idea | Fate |
|---|---|---|
| 11 | Handwritten khata to payment links, with payables netting | →T1 (lead) |
| 12 | Phone-call reminders to debtors in their language | K3 |
| 13 | Voice entry into the khata ("Ramesh ko 500 udhaar") | →T1 (input mode) |
| 14 | Credit score built from khata history | K6 |
| 15 | Auto-allocate one lump payment across several dues | →T1 (feature) |
| 16 | Reminder voice notes with a pay link | →T1 (feature) |
| 17 | Late-payment negotiator that restructures dues | K6 |
| 18 | NBFC EMI collection calls | K1 |
| 19 | Rent collection for small landlords | K1 |
| 20 | Wholesale group-buying settlement | K2 |

### C. Community finance
| # | Idea | Fate |
|---|---|---|
| 21 | SHG treasurer (savings, loans, repayments) | →T8 |
| 22 | Committee / chit-fund draw with instant winner payout | →T8 |
| 23 | Kuri / bishi auction by voice | →T8 |
| 24 | Festival-fund (chanda) transparency ledger | →T8 |
| 25 | Apartment-society maintenance dues agent | K1 |
| 26 | Wedding shagun ledger | K7 |
| 27 | School-fee instalment agent | K1 |
| 28 | NGO micro-donations to verified beneficiaries | K6 |
| 29 | Crowd-pooled hospital bill payment | K6 |
| 30 | Dairy co-op litre-and-fat payments to farmers | →T5 |

### D. Family and remittance
| # | Idea | Fate |
|---|---|---|
| 31 | Ghar-Paisa: a migrant sends home, the family claims by voice | →T4 |
| 32 | Cross-state remittance with receipts in the family's language | →T4 |
| 33 | Pocket money with limits for kids and elders | →T9 |
| 34 | Voice "send to Mummy" contacts | K1 |
| 35 | Gold or SIP buying by voice | K6 |
| 36 | Gulf-worker remittance with FX | K3 |
| 37 | Overseas student fee payment | K3 |
| 38 | Festival gift money with a greeting in the sender's cloned voice | K7 |
| 39 | "Is this safe to pay?" scam check for elders | K5 |
| 40 | Family treasury: relatives pool monthly for parents' expenses | →T9 |

### E. Bills and elders
| # | Idea | Fate |
|---|---|---|
| 41 | Amma's Bills: elder pays utilities by voice under a family mandate | →T9 |
| 42 | Mobile recharge by voice for feature-phone families | K1 |
| 43 | Electricity-bill dispute helper | K7 |
| 44 | Monthly cap plus family approval for bill payments | →T9 |
| 45 | Medicine refill and pay | K3 |
| 46 | DTH or FASTag recharge by voice | K1 |
| 47 | Flatmates' utility bill split | K7 |
| 48 | "Why is my bill high?" from a bill photo, then pay | →T9 |
| 49 | LPG cylinder booking and pay | K3 |
| 50 | Insurance premium reminder and pay | K1 |

### F. Merchant operations
| # | Idea | Fate |
|---|---|---|
| 51 | Voice soundbox announcing payments | K1 |
| 52 | Kirana end-of-day voice report | K5 |
| 53 | Dynamic QR or link by voice for street vendors | K1 |
| 54 | Supplier payment by voice with approval limits | →T6 |
| 55 | Policy-checking refund agent | K1 |
| 56 | COD confirmation call | K1 |
| 57 | Abandoned-cart recovery call | K1 |
| 58 | Failed-payment recovery | K1 |
| 59 | Subscription dunning | K1 |
| 60 | "Why was my settlement short?" explainer | K5 |

### G. Documents to money
| # | Idea | Fate |
|---|---|---|
| 61 | Invoice photo to vendor payment | →T6 |
| 62 | Handwritten supplier chits (kachcha parchi) to payables | →T1 (payables side) |
| 63 | Mandi weighbill photo to instant farmer payout | →T5 |
| 64 | ID and PAN photo to instant merchant onboarding | →T10 |
| 65 | Medical-bill photo to insurer reimbursement | K3 |
| 66 | Prescription to pay a pharmacy | K3 |
| 67 | School-fee receipt reconciliation | K7 |
| 68 | GST invoice voice queries | K5 |
| 69 | Rent agreement to recurring rent autopay | K2 |
| 70 | Government scheme form helper with DBT | K6 |

### H. Trust, safety and fraud
| # | Idea | Fate |
|---|---|---|
| 71 | Invoice fraud shield: flag changed bank details before paying | →T6 |
| 72 | Spoken scam check before paying an unknown UPI ID | K5 |
| 73 | Deepfake-voice defence with a liveness phrase | K4 |
| 74 | Spoken readback plus name match before every payout | →T4 and →T6 (safety layer) |
| 75 | Duress word that silently cancels a payment | K4 |
| 76 | Per-person spend guardrails in a family wallet | →T9 |
| 77 | Refund-abuse guard | K1 |
| 78 | Chargeback evidence agent | K1 |
| 79 | Mule-account detector for gig payouts | K6 |
| 80 | Spoken audit trail ("what happened to my money?") | →T2 (feature) |

### I. Cross-language commerce
| # | Idea | Fate |
|---|---|---|
| 81 | Anuvaad Bazaar: two-language market with payment inside the conversation | →T3 |
| 82 | Voice price negotiation between buyer and seller | →T3 |
| 83 | Tourist pays a local vendor, translated | K3 |
| 84 | Multilingual hospital billing desk | K3 |
| 85 | Auto-fare dispute | K7 |
| 86 | Street-food order and pay for migrants | →T3 |
| 87 | Translating UPI error messages | K7 |
| 88 | Bank-branch interpreter | K6 |
| 89 | Telecom-store voice KYC | →T10 |
| 90 | Language-learning rewards paid in ₹ | K7 |

### J. Informal services and institutions
| # | Idea | Fate |
|---|---|---|
| 91 | Bharosa: voice escrow for informal services (maid, plumber, tailor) | →T2 |
| 92 | Tutor or coach fee escrow | →T2 |
| 93 | Artisan milestone payouts | →T2 |
| 94 | Tailor or boutique advance plus balance | →T2 |
| 95 | Scholarship disbursal with KYC | K6 |
| 96 | Disaster-relief payouts by phone number | K6 |
| 97 | Parametric crop-insurance payout | K3 |
| 98 | Construction milestone payments to a crew | →T7 |
| 99 | Voice-first merchant onboarding (KYC by voice) | →T10 |
| 100 | Build-your-own Relay-style agent by voice | K2 |

**Tally** (counted by script from this table): see section 9.

**Why the "obvious" ones were killed.** Cashfree already ships Relay agents for cart recovery, payment recovery, COD
confirmation, refund screening, disputes and dunning, and its docs even describe building custom agents on WhatsApp,
Slack, Gmail and Sheets. Sarvam publishes a premium-collection voice agent that calls customers and sends a payment link,
and announced a voice-first checkout partnership with Razorpay. Any idea that reads as "agent calls a customer about a
payment" or "say a sentence, pay by UPI" will sit next to ten near-copies and next to the hosts' own products.

---

## 3. The ten finalists in detail

Every plan below is already cut down using the MVP rule: no login, no admin screen, no dashboard, no settings. Seed data
and a "reset demo" button replace anything that would need real users. A single page UI is enough.

Team split assumed (5 people; for fewer, merge roles): **V** Sarvam and voice pipeline · **C** Cashfree rails and webhooks ·
**U** UI and demo polish · **D** documents, data and prompts · **P** pitch, fallbacks, QA.

### T1. Khata-to-Cash (recommended)

**One line:** a shopkeeper photographs the paper ledger; the agent collects what's owed and pays what's due, in their language.

**Core hypothesis:** a shopkeeper will let an agent act on a photo of their notebook if every money step is shown and
confirmed. **Demo success metric:** a judge writes three lines, photographs them, and sees at least one sandbox collection
and one payout complete with a reference number inside the 13-minute slot.

**Flow**
1. **Photo in.** Page or camera upload of a handwritten ledger (lines like "Ramesh 1200 baaki", "Mehta ji ko 5000 dena").
2. **Read it.** Sarvam Vision 2.1 (Document Intelligence; job based: create, upload, start, poll, download ⚠ confirm in
   docs) returns the text. **Sarvam 105B** (OpenAI-compatible at `https://api.sarvam.ai/v2`, supports tool calling) turns it
   into rows: `party, amount, direction (they owe me / I owe them), phone?, note`. Show an editable table with low-confidence
   cells highlighted. The human fixes anything wrong. This is the trust step, and it's also our answer to OCR errors.
3. **Voice confirm.** The owner says (Hindi, Kannada, Tamil or Bengali): "Ramesh aur Suresh se maango, Mehta ji ko
   paanch hazaar de do." **Saaras v4** transcribes; the 105B planner maps it to actions. Money steps always read the exact
   figures back (Bulbul) and wait for "confirm".
4. **Collect.** For each receivable, create a Cashfree **Payment Link** (`POST /pg/links` ⚠ confirm fields: `link_id`,
   `link_amount`, `link_purpose`, `customer_details`, `link_notify`, `link_meta.notify_url`). Show a QR on screen for the
   demo phone, plus an audio reminder in the **debtor's** language (Sarvam-Translate or Mayura, then Bulbul).
5. **Pay.** For each payable, Payouts V2: create beneficiary, create transfer, poll or webhook. Phone numbers and UPI IDs
   for suppliers come from a seeded contact list or are spoken ("Mehta ji ka UPI bolo") with readback.
6. **Reconcile live.** PG webhook `PAYMENT_*` and Payouts `TRANSFER_*` update the ledger row from "open" to "paid". The agent
   speaks the summary: "Ramesh ne ₹1,200 de diye. Mehta ji ko ₹5,000 bhej diye, reference ...".
7. **Netting line (the clever part):** "After today's collections you can pay Mehta ₹5,000 and keep ₹3,200."

**Cashfree APIs:** Payment Links (PG sandbox keys, which you already have), webhooks (signature check on the raw body),
Payouts V2 `beneficiary` and `transfers` (Payouts test environment: *Switch to Test*, no KYC), optionally the name check
from Section T4.
**Sarvam:** Vision 2.1, Saaras v4, Bulbul v4 Flash (or v3), Mayura or Sarvam-Translate, 105B. Five models, so a Sarvam judge sees breadth.

**4-hour plan**
- 11:30 to 12:30: **C** keys, tunnel, a payment link plus a payout working from a script. **D** gathers 6 sample pages in 3
  languages and gets Vision output. **V** Saaras, Bulbul and a planner skeleton. **U** one-page shell with the table.
- 12:30 to 2:00: wire the flow end to end on seeded data. Webhooks to ledger. Voice confirm loop.
- 2:00 to 3:00: failure paths (link expired, payout failed with a retry), the netting line, language switch.
- 3:00 to 3:30: freeze, record a fallback video, rehearse once, put a cached Vision result behind a switch.

**Cuts (aggressive):** no accounts or roles, no multi-shop, no WhatsApp Business (use QR plus a link on a phone), no real
SMS dependency, no dashboards. Debtor phone numbers come from a CSV.

**Risks and fallbacks**
| Risk | Fallback |
|---|---|
| Vision slow (job based) or misreads messy handwriting | Show a progress animation, cache known pages, keep the editable table; let judges write neatly in a provided notebook |
| PG sandbox payment needs a test checkout | Use Cashfree's published sandbox test values (⚠ from docs) on the hosted page, rehearsed |
| Payout identity check (IP whitelist vs signature) on venue Wi-Fi | **Generate the Payouts public key and switch the 2FA method tonight** (see section 7) |
| Webhook can't reach us | Poll status every 3 s as a backup, as BolPay does |

**Why original:** paper in, cash out, reconciled, with reminders spoken in the *debtor's* language and a netting
suggestion. Nobody gets to say "yet another voice UPI".

### T2. Bharosa: voice escrow for informal services

**One line:** the customer says what job they want; the worker agrees in their own language; the customer pays upfront into
trust; "kaam ho gaya" releases the money.

**Problem:** maids, electricians, tailors, tutors and artisans are paid in cash after the fact or upfront on trust. Both sides
get cheated; there is no record.

**Flow:** (1) customer and provider each speak their own language; Saaras **translate** mode and Bulbul carry the
conversation; the 105B drafts a **job card** (job, price, advance, date) and reads it back in both languages; (2) the
customer pays the amount through a Cashfree payment link; (3) funds sit in our merchant balance (the demo's escrow; real
Cashfree escrow exists ⚠ "One Escrow" in Cashfree's payouts materials, needs enablement); (4) on "kaam ho gaya, theek
hai" the agent runs a **Payout** to the provider; on "problem hai" it offers a partial **refund** (PG refunds API) and
records a spoken summary of the dispute.
**Cashfree:** Payment Links or Orders, Refunds, Payouts V2, webhooks. **Sarvam:** Saaras (translate), Bulbul, 105B.
**Cuts:** no ratings, no search or marketplace, one job at a time, providers pre-registered with a UPI ID.
**Risk:** "who holds the money" regulatory question. Answer in the pitch: demo uses the merchant balance; production
would use Cashfree's escrow or nodal arrangement. **Unique:** trust layer for the informal economy; both parties speak
different languages.

### T3. Anuvaad Bazaar: two languages, one deal, one payment

**One line:** a Bengali buyer and a Kannada seller talk through the agent; it builds the bill and the payment lands.

**Flow:** the two speakers alternate; Saaras translate mode converts each to the other's language, Bulbul speaks it. The
105B watches the conversation for items, quantities and price, keeps a running bill on screen, then creates a payment
link or QR when both say yes. On the webhook it announces "payment received" in both languages. Voice extras: "give her
₹50 back" calls the Refund API; "pay the porter ₹200" calls Payouts.
**Cashfree:** Payment Links/Orders, Refunds, Payouts, webhooks. **Sarvam:** Saaras (translate), Bulbul, 105B, optionally Mayura.
**Cuts:** two fixed language pairs, three product items, one shop. Latency target under 3 seconds a turn (use streaming TTS).
**Risk:** money part is mostly collection (score M=3). Lift it with the refund and porter payout lines. **Strength:** best
live audience participation of all ten. **Unique:** commerce between people who cannot understand each other, which is
exactly Bengaluru's reality.

### T4. Haath-Se-Haath: the payee claims by voice, name-verified

**One line:** you send money to someone who has no UPI ID handy; they open a link, *say* their details in their language,
the agent reads them back, verifies the name, and the money lands.

**Why it matters:** wrong or missing beneficiary details are the top reason payouts fail or get reversed. This fixes the
payee side.

**Flow:** (1) the payer says "send ₹500 to Raju" (Hindi); the agent creates a **claim link** (our own signed URL; Cashfree's
Cashgram does the same job with SMS, email or WhatsApp delivery ⚠ may need enablement); (2) Raju opens it and speaks his UPI
ID or account details. Saaras plus **deterministic** parsing turns "raju dot kumar at oksbi" into `raju.kumar@oksbi`
(never trust the LLM for IDs); (3) Bulbul reads it back character by character; Raju confirms; (4) Cashfree **name
verification** (Payouts bank/UPI validation, or Secure ID bank account verification ⚠ check which keys you have) compares the
bank's name with "Raju Kumar"; (5) Payouts V2 transfer; (6) spoken receipt in his language.
**Also try:** Cashfree can pay with only a **phone number plus beneficiary name** (or the last 4 card digits) ⚠ per the
"Payouts Through Phone Number" docs, which would skip the claim step for known contacts.
**Sandbox gifts:** test accounts that return *timeout then success*, *pending then failure* and *success then reversed*
let us show waiting and reversal states on purpose. **Risk:** spoken IDs are error-prone; the readback and name check are
the answer. **Unique:** nobody else fixes the beneficiary-capture problem.

### T5. Mandi Munim: weighbill to farmer payout in seconds

**One line:** the farmer speaks the sale, a photo of the weighbill confirms it, and the money reaches them before they
leave the yard.

**Problem:** commission agents often pay farmers days or weeks late. **Flow:** farmer speaks crop, quantity and grade;
Vision reads the printed or handwritten weighbill; the agent cross-checks the two, applies a visible rate table and the
commission, and shows the farmer's net in their language; Payouts V2 sends it by UPI or phone number; an evening
**batch transfer** settles small items. A "days of delay avoided" counter makes the point.
**Cashfree:** Payouts V2 (single and batch), webhooks. **Sarvam:** Saaras, Vision, Bulbul, 105B.
**Cuts:** rate table is mock and labelled as such; one commodity. **Risk:** no live price data (be upfront). **Unique:**
farmer-side money problem nobody else will pick; strong pitch.

### T6. Invoice Fraud Shield: pay vendors by voice, catch changed bank details

**One line:** upload or photograph an invoice, say "pay it"; before sending, the agent checks the bank details against the
vendor's known account and stops a fake "we changed our account" invoice.

**Flow:** Vision parses the invoice (Hindi or English, printed or handwritten); the agent matches the vendor and compares
bank or UPI details with the saved beneficiary; if they differ, it speaks a warning in the owner's language and requires a
second confirmation; name match against the bank's record; then Payouts V2. A limit rule sends big amounts for a second
approval by voice.
**Cashfree:** Payouts V2, name verification (⚠), Payout Protect style rules in our own code. **Sarvam:** Vision, Saaras,
Bulbul, 105B. **Risk:** "invoice to pay" will be built by others (K1 on its own); the fraud check is what saves it. **Unique:**
medium.

### T7. Mazdoor Mitra v2: the worker asks, the crew is paid by phone number

**One line:** the worker says "aaj ka paisa chahiye"; the contractor approves by voice; the money arrives; a lump sum can
be split across a whole crew by attendance.

**Warning:** this is BolPay's idea. It is the fastest to build (score F=5) and the least original (U=2). It also carries the
"code written on the day" risk, so it must be **rebuilt from scratch** and not copied. Keep it only as an emergency fallback.
**Cashfree:** Payouts V2 (single and batch), phone-number payouts (⚠). **Sarvam:** Saaras, Bulbul, 105B.

### T8. Committee: voice treasurer for chit funds and SHGs

**One line:** a rotating savings group where an agent collects each member's monthly share, runs the draw or auction by
voice, and pays the winner at once.

**Why it is special:** informal committees (chit, kuri, bishi) and self-help groups move huge sums on trust. **Flow:** members
join by phone number; the agent sends a payment link to each every month; tracks who has paid and chases the rest in
their language; the winner is drawn (show the seed) or bids are taken by voice; the payout goes through Payouts V2 after a
second member confirms by voice. **Demo trick:** an "advance one month" button compresses a year into a few minutes.
**Cashfree:** Payment Links, Payouts, webhooks. **Sarvam:** Saaras, Bulbul, Mayura, 105B. **Risk:** the most state to build
(F=2) and a regulatory note (chit-fund law). Demo it as a "savings circle" and say so. **Unique:** the highest of all ten.

### T9. Amma's Bills: the elder pays bills by voice under a family mandate

**One line:** a family approves an agent once, with a monthly limit; the elder just says "bijli ka bill bharo".

**Flow:** this is built on Cashfree's **AgentPay MCP**: an agent pays BBPS bills (electricity, water, mobile, broadband) from
a Cashfree wallet after the user approves a **one-time consent mandate** with an OTP and a monthly limit; there are 17 tools
and a sandbox. Wallet top-ups use UPI AutoPay (beta). Our layer: Saaras and Bulbul in Tamil or Hindi, bill amount and due
date read aloud, family WhatsApp-style summary, the limit shown as "₹2,400 of ₹5,000 used".
**Risk (score R=2):** access to the AgentPay sandbox on the day and the OTP consent page. Ask a Cashfree engineer at 11:30.
If they hand over keys quickly, this jumps to the top three because it showcases their newest product.

### T10. KYC-by-Voice: onboard a merchant in Hindi, first payment live

**One line:** a kirana owner completes onboarding by talking and photographing documents, and ends with a working payment
link and a first collection.

**Flow:** Vision reads the PAN or Udyam photo; Cashfree **Secure ID** verifies PAN, GSTIN and bank account (penny drop),
runs a face match with liveness, then creates the first payment link. **Cashfree:** Secure ID (separate sandbox keys ⚠),
Payment Links. **Sarvam:** Vision, Saaras, Bulbul, 105B. **Risk:** sandbox keys and mock responses; money moves only as a
₹1 verification and the first link (M=3). **Unique:** it attacks Cashfree's own onboarding drop-off, so judges from
Cashfree will care. Good, but it depends on keys we may not get.

---

## 4. Where Khata-to-Cash is weakest (honest red team)

- **Handwriting accuracy.** If Vision misreads "1200" as "7200", a wrong payment link is sent. Mitigation: editable table,
  confidence highlights, and **no money step without a spoken or tapped confirm**.
- **"A collection is not an agent moving money."** The brief says "moves the money". Our answer is the payables side plus
  the netting and the live webhook reconciliation. Make sure the demo shows a **payout**, not only a payment link.
- **Someone else builds a khata app.** Plausible, but a voice-only khata does not read paper, does not pay suppliers, and
  does not remind debtors in their own language. Own those three.

---

## 5. Demo-readiness rules (judges will try random things)

1. **No login.** The first screen is the product. A "Reset demo" button restores seed data in one click.
2. **Suggested prompts as tap-to-run chips** in all four languages, so a judge can succeed in 10 seconds.
3. **Every money step shows exact figures and waits for confirm.** Judges respect this; it is also what Cashfree's own
   agent checkout docs say about consequential actions.
4. **A money-trail view:** requested, sent to Cashfree, webhook received, reference number. It proves the money is real API
   traffic. Keep a Cashfree dashboard tab open beside it.
5. **Planner on Sarvam 105B**, so the pitch can say "every model is Sarvam, every rail is Cashfree". (BolPay used Groq for
   planning; its free tier is 8,000 tokens a minute and would fall over under 30 teams of judges.)
6. **Failure is a feature.** Use the sandbox accounts that fail, time out, or reverse, and show the agent handling it.
7. **A pre-recorded 90-second fallback video** and cached results behind a hidden switch, in case Wi-Fi or an API dies.
8. **Language order for the demo:** open in the judges' likely language, then switch mid-demo to a second one.

---

## 6. Council verdict (simulated personas)

| Persona | Verdict on T1 | What it makes us do |
|---|---|---|
| **Cashfree judge** | "Good: collection and payout in one flow, reconciled by webhook. Show us idempotency and failure." | Show a failed payout (`failure@upi`) and a retry, webhook-driven status, and no double pay |
| **Sarvam judge** | "Vision on handwriting is the interesting part. Do not hide it behind a mock." | Run real Vision live; keep the cache only as a fallback; mention the five models used |
| **Sceptical investor** | "Is a kirana really going to photograph a notebook?" | Pitch the 60-second story: no typing, no new habit, their own notebook |
| **Rival team lead** | "We are building voice UPI and EMI calls too." | Differentiate on paper input, supplier payouts, netting and debtor-language reminders |
| **Reliability engineer** | "Vision is async and slow; webhooks may not arrive." | Progress animation, cache, polling backup, offline video |
| **Real kirana owner** | "My handwriting is bad and customers' numbers are not in the book." | Editable table, voice-add of phone numbers, seeded contacts for the demo |

If the council had to bet on one alternative: **Bharosa (T2)**. It is the cleanest "someone says what they need, money
moves, agent answers back" story and needs no document model.

---

## 7. What to do about BolPay (the rule: "Code is written on the day")

The Luma rules say code is written on the day; templates and open-source libraries are fine. BolPay is a private, mostly
finished app, which is not a template. **Do not reuse its code.** The safe, honest approach:

- Ask in Discord `#buildathon` tonight: "Is it OK to use a pre-existing personal project as a base, or must the repo start
  empty at 11:30?" Treat anything but a clear yes as a no.
- **Start a brand-new repo at 11:30.** Use only: official SDKs, the Sarvam cookbooks, open-source frameworks.
- What you *can* bring is **knowledge**, which is not code. The Cashfree lessons learned this week:
  - Payouts has its own API keys; Payment Gateway keys return 401 on Payouts.
  - Payouts **Test environment needs no KYC**: use *Switch to Test* in the Payouts top bar, not "Try Test Environment".
  - Every Payouts call needs an identity check even in sandbox. IP whitelisting breaks when your IP changes (venue Wi-Fi!).
    Use the **public key signature** method instead: generate the key, then click *Switch Method*, then send `X-Cf-Signature`
    = base64(RSA-OAEP-SHA1(publicKey, `<clientId>.<unix seconds>`)).
  - `MANUALLY_REJECTED` is a failed state; a failed UPI beneficiary can report `INVALID` before any transfer.
  - **Never mark a payment failed when the answer was lost** (timeout, 5xx): ask Cashfree first, or a Retry double-pays.
  - Webhooks: V2 uses `x-webhook-signature` plus `x-webhook-timestamp` over the raw body; the "test" ping arrives in the older
    body-signature style. Accept both, and never let a "pending" event undo a finished payment.
  - Sandbox charges a service fee on test transfers (about ₹6 plus tax seen on a ₹1 transfer).
  - Test the money paths with `success@upi` and `failure@upi`.

### Prep tonight (accounts and keys are not code)
- [ ] Cashfree: Payouts test keys, **public key plus Switch Method done**, PG sandbox keys, ask for Secure ID keys.
- [ ] Sarvam: API key works, claim the 500 credits, test Saaras, Bulbul and a Vision job once.
- [ ] A tunnel for webhooks (ngrok or cloudflared) installed and logged in. Phone hotspot as backup network.
- [ ] Photo ID, Luma ticket, charger, phone for OTPs, Cashfree account login (all listed on the event page).
- [ ] Join Discord, post your team's intro, find teammates, ask the engineers which keys they hand out at 11:30.
- [ ] Notebook plus pen, in case we pick T1.
- [ ] Rehearse a 3-minute pitch and a 13-minute demo flow once.

### Questions to ask on Discord or at 11:30
1. What are the tracks and the scoring rubric?
2. Can we get AgentPay MCP and Secure ID sandbox keys on the day?
3. Is pre-existing code allowed as a base? (See above.)
4. Is Cashgram enabled for hackathon accounts?
5. Is there a hackathon Cashfree test environment with preloaded balance, to skip the sandbox top-up?

---

## 8. Sources and repositories

**Event:** https://luma.com/azuhrzuj (private event, approval required; tracks and rubric not published)
**Cashfree**
- Docs index: https://www.cashfree.com/docs/llms.txt
- Relay (AI Super Agent for SMB payment ops): https://www.cashfree.com/docs/tools-ai/relay/overview and https://www.cashfree.com/blog/ai-superagent-that-runs-smb-payment-operations/
- AgentPay MCP (BBPS bills, consent mandate): https://www.cashfree.com/docs/tools-ai/agentpay-mcp/overview
- Checkout for AI Agents (WebMCP): https://www.cashfree.com/docs/tools-ai/webmcp
- Payouts test data (success/failure/timeout/reversal accounts, phone-number payouts): https://www.cashfree.com/docs/payouts/payouts/integrations/data-to-test
- Cashgram integration: https://www.cashfree.com/docs/payouts/cashgram/integration/cashgram-integration
- Verify beneficiary name: https://www.cashfree.com/docs/payouts/cashgram/verify-bene-name
- Sample kits: https://www.cashfree.com/docs/payouts/payouts/integrations/samples
- GitHub: https://github.com/cashfree/cashfree-payout-sdk-nodejs · https://github.com/cashfree/cashfree-sdk-nodejs · https://github.com/cashfree/cashfree-verification-sdk-nodejs · https://github.com/cashfree/cashfree-cashgram-node · https://github.com/cashfree/cashfree-payout-python · https://github.com/cashfree/agent-skills

**Sarvam**
- Models and languages: https://docs.sarvam.ai/api/getting-started/models
- Pricing and rate limits: https://docs.sarvam.ai/api/getting-started/pricing
- Document Intelligence (Vision 2.1): https://docs.sarvam.ai/api/api-guides-tutorials/document-intelligence/overview
- Token Factory (OpenAI-compatible chat, `sarvam-105b`): https://docs.sarvam.ai/api/token-factory
- Voice Agents platform (Samvaad, telephony): https://docs.sarvam.ai/voice-agents/why-voice-agents · premium collection example: https://www.sarvam.ai/voice-agents/premium-collection
- Sarvam × Razorpay (what the competition may copy): https://www.sarvam.ai/partnerships/razorpay
- Docs MCP server: https://docs.sarvam.ai/_mcp/server
- GitHub: https://github.com/sarvamai/sarvam-ai-cookbook (LiveKit and Pipecat voice-agent notebooks) · https://github.com/livekit/agents (`livekit-plugins-sarvam`) · https://github.com/pipecat-ai/pipecat (Sarvam services)
- Real-time voice option: https://docs.sarvam.ai/api/integration/build-voice-agent-with-live-kit · https://docs.sarvam.ai/api/integration/build-voice-agent-with-pipecat

---

## 9. Appendix: BolPay onboarding gap (your earlier question)

BolPay has **only a login form**. Roles (owner, supervisor, worker) exist in a `members` table, but the three demo accounts
were inserted by `supabase/seed.sql`. There is no sign-up, no way for an owner to invite a supervisor, for a supervisor to
add workers, or for a worker to claim a record. That workflow was never built. It does not matter for the new idea, which
has no login by design (section 5), but it's the honest answer if anyone asks about BolPay.

### Tally (counted by script from the table in section 2)

- **100** ideas generated. **61** killed, **39** kept or merged into the ten finalists.
- Kill reasons: K1 18 (obvious or already shipped); K2 3 (too big for 4 hours); K3 11 (needs access we will not have); K4 2 (fragile live demo); K5 6 (no money moves); K6 12 (regulated or trust-heavy); K7 9 (gimmick).
- Ideas folded into each finalist (first mapping of each idea): T1 5, T2 5, T3 3, T4 3, T5 2, T6 3, T7 5, T8 4, T9 6, T10 3.
