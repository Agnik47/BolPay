# BolPay pitch numbers

Three kinds of numbers. Say which kind you are quoting.

- **[Source]**: from a published report (links at the end).
- **[Measured]**: what our app actually did today on the Cashfree sandbox.
- **[Example]**: a worked example with stated assumptions, not a survey.

## 1. The problem, in numbers

| Figure | Kind |
|---|---|
| **7.7 million** gig workers in India in 2020-21, projected to reach **23.5 million by 2029-30** (about 3x) | [Source] NITI Aayog, 2022 |
| About **1.3 million** of them work in transport (riders and drivers, our demo persona) | [Source] NITI Aayog, 2022 |
| Informal moneylenders charge **12% to 150% a year**; studies of small borrowers usually find **36% to 60% a year** | [Source] RBI, cited in a World Bank paper; Bihar and Tamil Nadu studies |
| In one survey of loan-app users, **63%** had a family income **under ₹10,000 a month** | [Source] survey reported by The Wire |
| Pay cycles are weekly, fortnightly or monthly, so the gap between an emergency and payday can be **up to 14 to 30 days** | [Example] BolPay supports these three cycles |

## 2. What BolPay changes

| Step | Today (assumed) | With BolPay | Kind |
|---|---|---|---|
| Ask for money | Find the manager in person or by phone | Speak in your own language, about 30 seconds | [Measured] voice clip limit is 28 s |
| Understand and read back | Not applicable | **About 1.5 to 2 seconds** | [Measured] AI reply took 1.4 to 2.0 s in our logs |
| Eligibility check | Manual, often skipped | **Under 1 second**, 9 checks with the working shown | [Measured] confirm step took about 0.6 s |
| Approval | Hours or days; stops while the manager is on leave | **Instant within delegated limits**; the owner taps once otherwise | [Measured] Manager Agent approved Ravi's ₹500 at once |
| Money in the account | Next payday: days to weeks | **About 1 minute from request to completed UPI transfer** | [Measured] Ravi's ₹1,500 request at 7:41 UTC was paid at 7:42 UTC (sandbox) |
| Paying it back | Moneylender interest plus chasing | **Automatic**: taken from the next salary, never more than 50% of it | [Measured] ₹1,900 recovered from ₹7,812.50 in the demo |

**Headline: an emergency advance goes from days or weeks to about 1 minute.** The minute is measured; the days are an assumption about how it works today.

## 3. Money saved for the worker [Example]

A worker borrows **₹2,000 for one month**:

| Source | Cost |
|---|---|
| Moneylender at 60% a year (5% a month) | **₹100** interest |
| Moneylender at 150% a year (12.5% a month) | **₹250** interest |
| BolPay advance (their own earned wages) | **₹0** interest |

For a rider earning about ₹600 a day (demo wages are ₹560 to ₹790), ₹100 to ₹250 is **one to five hours of work** they don't lose.

At scale [Example]: if just **1% of the 7.7 million gig workers** made one such ₹2,000 advance a month instead of borrowing at 60% a year, they would keep about **₹7.7 crore a month** (77,000 workers × ₹100).

## 4. For the owner

- **Approvals continue while the owner is on leave**, but only within the limits they set: per request, per day, and an expiry date. Anything else waits for them.
- **No unrecovered money:** advances are capped at 25% of earned wages and recovered from the next salary automatically.
- **A full audit trail** of who did what: worker, each agent, owner, Cashfree reference.

## 5. Proof it works

| Figure | Kind |
|---|---|
| **65 automated checks pass**: 23 on the rules and 42 end to end (delegation limits, duplicates, double approval sends 1 transfer, failed payment then retry, webhooks, salary recovery, hostile Relay calls, prompt injection) | [Measured] `npm run test:advances` |
| **4 agents built on Cashfree Relay**; Sarvam translates decisions on Relay | [Measured] Relay Runs |
| **3 languages** tested live (Bengali, Hindi, English); voice round trip in Bengali through Sarvam; Kannada and Marathi are supported by the model but not demo-tested | [Measured] |
| A request is never stuck: if Relay is down, BolPay finishes the step within **90 seconds** | [Measured] tested |

## Sources

- NITI Aayog, *India's Booming Gig and Platform Economy* (June 2022): https://www.niti.gov.in/sites/default/files/2022-06/Policy_Brief_India%27s_Booming_Gig_and_Platform_Economy_27062022.pdf
- World Bank working paper citing RBI (2011) on moneylender rates: https://documents1.worldbank.org/curated/en/619581491240135589/pdf/WPS8021.pdf
- SIDBI, *Study on Informal Sector Lending Practices in India*: https://www.sidbi.in/uploads/coca_reports/2019-03-29-165105-t9yg7-Study-on-Informal-Sector-Lending-Practices-in-India-Final-Report.pdf
- The Wire, survey of loan-app users: https://thewire.in/banking/micro-loans-are-driving-an-already-forsaken-population-further-into-distress
