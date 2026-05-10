# Setup Instructions - Rabona Expense Tracker Rebuild

## Prerequisites
- Node.js 16+ installed
- Git installed
- Supabase account (already created)

## Step 1: Install Dependencies

```bash
npm install
```

This installs:
- React 18 + React DOM
- Vite (fast build tool)
- Supabase client library
- Axios (API calls)

## Step 2: Initialize Database Schema

**Important:** Run this ONCE to set up the database.

1. Go to Supabase dashboard: https://supabase.com/dashboard
2. Navigate to your project: `tvtphxnztfrltnbedhhk`
3. Click **SQL Editor** in the left sidebar
4. Click **New Query**
5. Copy the entire contents of `DATABASE_SCHEMA.sql`
6. Paste into the SQL editor
7. Click **Run**

This creates all tables:
- companies (Rabona Holdings, Espargos)
- accounts (Current, Mastercard for each company)
- expenses (main expense table)
- bank_transactions
- shareholders (YK, BK)
- And more...

**Status Check:**
- Go to **Table Editor** in Supabase
- You should see all new tables listed

## Step 3: Start Development

```bash
npm run dev
```

This starts:
- **Frontend:** http://localhost:3000 (React dev server)
- Watch mode for hot reload

## What's Working

✅ Company selector (loads from Supabase)
✅ Month/Year selector
✅ Tab navigation
✅ Connection to Supabase verified

## What's Next (Phase 1)

- [ ] Dashboard KPI calculations
- [ ] Add Expense form
- [ ] View Expenses table
- [ ] Bank statement parser integration

---

## Troubleshooting

**"Missing Supabase credentials"**
- Check `.env.local` file has both values
- Restart dev server after creating `.env.local`

**"Connection failed"**
- Verify Supabase project is active
- Check Project URL and Anon Key are correct
- Database schema must be initialized

**"Tables not showing"**
- Run DATABASE_SCHEMA.sql again in SQL Editor
- Check for SQL errors in the output

---

## File Structure

```
Rabona expense tracking sistem/
├── src/
│   ├── App.jsx              # Main React component
│   ├── App.css              # Component styles
│   ├── index.css            # Global styles
│   ├── main.jsx             # React entry point
│   └── supabaseClient.js    # Supabase config
├── index.html               # HTML template
├── package.json             # Dependencies
├── vite.config.js           # Vite configuration
├── .env.local               # Supabase credentials (secret)
├── DATABASE_SCHEMA.sql      # Database setup script
├── REBUILD_PLAN.md          # Architecture overview
├── CHANGELOG.md             # Version history
├── README.md                # Project overview
└── .git/                    # Git version control
```

---

## Git Workflow

Every evening:
1. Code is committed with clear messages
2. Daily summary created showing changes
3. You review and approve deletions
4. Next day starts fresh

To see history:
```bash
git log --oneline
```

To revert a change:
```bash
git revert [commit-hash]
```

---

## Support

If something isn't working:
1. Check this document first
2. Review DAILY_SUMMARY for recent changes
3. All changes are reversible via Git

