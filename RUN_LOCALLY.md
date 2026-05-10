# How to Run the System Locally

## Prerequisites
- Node.js 16+ installed
- Supabase account (already set up)
- Terminal/command line access

## Step 1: Open Terminal

Navigate to your project folder:
```bash
cd "Rabona expense tracking sistem"
```

## Step 2: Install Dependencies (First Time Only)

```bash
npm install
```

Wait for it to complete (~2-3 minutes)

## Step 3: Start Development Server

```bash
npm run dev
```

You should see:
```
VITE v4.4.0  ready in XXX ms

  ➜  Local:   http://localhost:3000/
```

## Step 4: Open in Browser

Click the link or manually open: **http://localhost:3000**

---

## What You'll See

✅ Clean, empty system  
✅ Company selector (loads from database)  
✅ Bank Statement Parser tab (active)  
✅ 7-tab navigation  
✅ Upload area (empty, ready for your test)  
✅ Transaction table (empty, will populate on import)

---

## To Stop the Server

Press `Ctrl+C` in the terminal

---

## Troubleshooting

**"npm: command not found"**
- Node.js not installed
- Install from https://nodejs.org

**"Cannot find module 'react'"**
- Run `npm install` first
- If still failing: `rm -rf node_modules && npm install`

**"Cannot connect to Supabase"**
- Check `.env.local` file exists with credentials
- Restart dev server

**Port 3000 already in use**
- Kill other processes on port 3000
- Or Vite will use 3001 automatically

---

## Testing the Bank Parser

1. Click "Bank Statement Parser" tab (should be active)
2. Drag & drop a CSV file (or click to select)
3. Click "Upload Files"
4. See transactions appear in the table below
5. Select transactions and click "Import..."

---

## Next Step

Once running and tested, tell me:
- ✅ What's working well
- ❌ What needs to change
- 🔄 What needs adjustment
- ➕ What's missing

I'll iterate based on your feedback!

