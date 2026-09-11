# Rabona Expense Tracking System

**Status:** 🟢 Live & private
**Stack:** React + Vite · Supabase (PostgreSQL) · deployed on Vercel

Expense, invoicing, and travel tracking for **Rabona Holdings** and **Espargos**.

---

## Using the app

**Live URL:** https://expense-tracker-six-neon-72.vercel.app

Open the link, sign in with your email + password, and you're in — it works from any device (laptop, phone, another computer). No local setup is needed for everyday use.

> **If the app shows "failed to load" everywhere:** the Supabase project has auto-paused (this happens on the free plan after ~7 days of no use). Open the Supabase dashboard and click **Resume project** — it's free and takes about a minute. Upgrading Supabase to Pro stops the pauses (optional).

---

## Security

The system is private:
- **Login:** Supabase Auth. There is one account; new sign-ups are disabled.
- **Database:** Row-Level Security is enabled on every table, so data can only be read or written by a signed-in user (see `DATABASE_SCHEMA_V35_MIGRATION.sql`).

---

## What's inside

Tabs: **Dashboard**, **Monthly Checklist**, **Bank Statement Parser**, **Add Expense**, **View Expenses**, **Client Invoicing**, **Shareholder Report**, **Travel Log**, **Client Report**.

Highlights include multi-file bank-statement import with OCR, client invoicing with a Statement-of-Account (.xlsx) generator, month locking (closed periods), and a Travel Log with per-trip pre-paid tracking and month-deferral history.

---

## Running locally (only for development)

Local dev is needed only when changing the code — not for normal use.

```
cd "path/to/Rabona expense tracking sistem"
npm install   # first time only
npm run dev
```

Then open the URL it prints (http://localhost:3000). Leave the terminal open; closing it stops the dev server.

## Deploying changes

The site auto-deploys when you push to the `main` branch on GitHub (`Betija34/expense-tracker`):

```
git add -A && git commit -m "your message" && git push
```

Vercel rebuilds within a minute or two.

---

## Files

- `src/` — the application (React components + `lib/` helpers)
- `DATABASE_SCHEMA*.sql` — the database schema and its numbered migrations
- `CHANGELOG.md`, `SETUP.md`, `QUICK_START.md`, `RUN_LOCALLY.md` — current reference docs
- `docs_archive/` — historical daily/session summaries, feature notes, and status files (kept for reference, not needed day-to-day)
