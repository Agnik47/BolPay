# Deploy BolPay on Vercel

**Status: not deployed.** The deployment needs your Vercel account, which I can't sign in to (no Vercel CLI or login on this machine). Everything the app needs on Vercel is below; it takes about 10 minutes.

## Read this first: what works on Vercel and what doesn't

BolPay keeps its business data in JSON files (`.data/`), not a database. Vercel's project folder is read-only, so the app needs `DATA_DIR=/tmp/bolpay-data` (support for this variable is in the code now). `/tmp` has three consequences:

- **Data resets on cold starts.** The demo dataset re-seeds itself (fine). The Zoho dataset, the stored Zoho connection and any payouts you made disappear; press **Sync now** again. To keep the Zoho connection across restarts, put a Zoho Self Client refresh token in `ZOHO_REFRESH_TOKEN` (see `.env.example`) instead of using Connect Zoho.
- **Each serverless instance has its own `/tmp`.** If Vercel runs two instances, one can miss data the other wrote (for example a payout approved on instance A, polled on instance B). With a single judge clicking through it usually works; it is not reliable.
- **Cashfree webhooks** are best skipped on Vercel for the same reason; the app's own status sync works without them. Also note that Cashfree **production** payouts need a whitelisted server IP, and Vercel serverless functions have no fixed outbound IP, so stay on the sandbox here.

So treat the Vercel URL as a **best-effort live preview**. The judged proof is the video plus the README's run steps (a hosted demo or run instructions are both acceptable; confirm against the event rules). The proper hosted fix is a persistent database (the Supabase schema already exists in `supabase/migrations/`) or a host with a persistent disk such as Render (REMAINING S-09).

## Steps

1. **Before deploying:** stop `npm run dev`, run `npm run build` locally and confirm it passes. (I did not run a production build in this session, because it would overwrite the running dev server's output.)
2. **Import the project:** vercel.com → **Add New → Project** → import the GitHub repo (the BolPay repo; your GitHub account needs access, otherwise fork it first). Framework: Next.js (auto). Build command `npm run build`. Node 20 or newer.
3. **Environment variables** (Project → Settings → Environment Variables, Production):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | from your Supabase project (same as `.env`) |
| `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET` | the Cashfree **Payouts** test keys |
| `CASHFREE_ENVIRONMENT` | `sandbox` |
| `SARVAM_API_KEY` | from `.env` |
| `GROQ_API_KEY` (optionally `GROQ_MODEL`, `VOICE_PLANNER_MODELS`) | from `.env` |
| `DATA_DIR` | `/tmp/bolpay-data` |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_ACCOUNTS_URL`, `ZOHO_PEOPLE_URL`, `ZOHO_SCOPES` | as in `.env` |
| `ZOHO_REDIRECT_URI` | `https://<your-app>.vercel.app/api/zoho/callback` |
| `ZOHO_REFRESH_TOKEN` | optional but recommended on Vercel (survives cold starts) |
| `ALLOW_LIVE_PAYOUTS` | leave unset |

   Never put real keys in the repo; `.env` is git-ignored.
4. **Deploy.** Open the URL once it is ready.
5. **Supabase:** Authentication → URL Configuration → set the **Site URL** to the Vercel URL and add it to the redirect URLs, so sign-in works there.
6. **Zoho:** in https://api-console.zoho.in add `https://<your-app>.vercel.app/api/zoho/callback` as another Authorized Redirect URI (it must match `ZOHO_REDIRECT_URI` exactly).
7. **Check:** sign in as the owner, open Integrations → Sync now, then run the voice flow from [DEMO_VIDEO.md](./DEMO_VIDEO.md). Microphone capture needs HTTPS, which Vercel provides.

CLI alternative: `npm i -g vercel`, `vercel login`, `vercel --prod` from the project folder, then add the same variables with `vercel env add`.
