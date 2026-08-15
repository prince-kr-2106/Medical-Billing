# MedStock — real deployed version

A pharmacy inventory, billing, invoice-import, and daily-report system with:
- A real Postgres database (persists independently of the app server)
- A live URL you can open from any device
- A cron job that emails you a daily report automatically (expired stock, expiring-soon, low stock, revenue, top sellers)

This is genuinely different from the earlier in-browser version: state lives in a real
database, not your browser, so multiple devices see the same data, and the report goes
out even if you never open the app that day.

---

## 1. Get a free Postgres database (5 min)

Pick one:

**Option A — Supabase** (supabase.com)
1. Sign up, "New project", pick a password, wait ~2 min for it to provision.
2. Project Settings → Database → Connection string → **URI**. Copy it.
3. It looks like: `postgresql://postgres:[PASSWORD]@db.xxxx.supabase.co:5432/postgres`

**Option B — Neon** (neon.tech)
1. Sign up, "Create a project".
2. On the dashboard, copy the **Connection string** shown.

Either way, you end up with one `DATABASE_URL` value. Save it somewhere — you'll paste
it into Render in step 3.

## 2. Get an email sender (5 min)

Easiest path if you have Gmail:
1. Turn on 2-Step Verification on your Google account (if not already on).
2. Go to Google Account → Security → **App passwords**.
3. Create one for "Mail" — you'll get a 16-character password. That's your `SMTP_PASS`.
4. `SMTP_USER` is your Gmail address. `SMTP_HOST` is `smtp.gmail.com`, `SMTP_PORT` is `587`.

(Any other SMTP provider — Zoho, Outlook, a transactional email service — works the same
way; just change `SMTP_HOST`/`SMTP_PORT` accordingly.)

## 3. Deploy to Render (10 min)

1. Push this folder to a GitHub repo (or upload it directly — Render supports both;
   GitHub is easier for future updates).
2. On [render.com](https://render.com), **New → Web Service**, connect the repo.
3. Render should detect `render.yaml` and pre-fill settings. If not, set manually:
   - Build command: `npm install`
   - Start command: `npm start`
4. Under **Environment**, add these variables (values from steps 1–2):
   - `DATABASE_URL`
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
   - `REPORT_FROM_EMAIL`, `REPORT_TO_EMAIL` (can both be your own email)
   - `REPORT_HOUR` — e.g. `8` for 8am
   - `TZ` — e.g. `Asia/Kolkata` so "8am" means your actual 8am
5. Deploy. Render gives you a URL like `https://medstock-xxxx.onrender.com` — that's
   your independent, always-on app.

**Free-tier note:** Render's free web services sleep after ~15 min of no traffic and take
~30–60 seconds to wake on the next request. Your data is safe (it's in Postgres, not on
the sleeping server), and the cron job for the daily email still needs the service to be
awake at the scheduled hour — Render's free tier does wake services for scheduled
requests, but if you want guaranteed on-time emails with zero delay, either upgrade to a
paid Render instance (~$7/mo) later, or use an external cron pinger to hit your URL a
minute before `REPORT_HOUR` to make sure it's awake.

## 4. First run

Open your Render URL. The database tables are created automatically on first boot
(`initDb()` in `server.js`). Add a medicine, or go to **Import invoice** and load the
`gp-sales-invoice-2026279786.json` file from your earlier conversation to bulk-load your
248-item stock in one shot.

## 5. Local development (optional)

```
cp .env.example .env      # fill in your real values
npm install
npm start
```
Visit `http://localhost:3000`.

---

## What's real here vs. what to know

- **Database**: real Postgres, independent of the app server. Survives redeploys,
  restarts, server sleep — anything short of you deleting the database.
- **Multi-device**: yes — open the Render URL from your phone and your computer, both
  see the same live data.
- **Daily email**: sent automatically by a server-side cron job at `REPORT_HOUR` your
  time, whether or not you open the app.
- **What this still isn't**: a native mobile app, SMS alerts, or a custom domain (though
  you can point your own domain at Render for free in its settings if you own one).
  It also doesn't do real OCR on scanned/photographed invoices — only text-layer PDFs or
  the JSON import path.
