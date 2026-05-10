# Rabona Expense Tracking System - Rebuild

**Status:** 🚀 In Progress  
**Timeline:** May 10 - May 24, 2026  
**Tech Stack:** React + Node.js + Supabase (PostgreSQL)

---

## Overview

Complete rebuild of the Rabona Holdings & Espargos expense tracking system with:
- ✅ Cloud-based data (Supabase PostgreSQL)
- ✅ Automatic daily backups
- ✅ Multi-device access
- ✅ Full Git version history
- ✅ Daily approval workflow
- ✅ Zero unprotected deletions

---

## How This Rebuild Works

### Daily Workflow
1. **Development:** Claude builds features, makes commits
2. **End of Day:** `DAILY_SUMMARY_[DATE].md` created with changes
3. **Review:** You review additions, changes, and pending deletions
4. **Approval:** You say YES (delete permanently) or NO (keep for now)
5. **Commit:** Approved state saved to Git
6. **Next Day:** Work continues from clean, approved state

### Safety Features
- **Git:** Full history, instant revert capability
- **Database:** Automatic backups, point-in-time recovery
- **Approval Gates:** Nothing deleted without your sign-off
- **Audit Trail:** Every change documented

---

## Getting Started

### Prerequisites
1. **Supabase Account** (free): https://supabase.com
2. **Node.js** 16+ (if running locally)
3. **Git** (for version control)

### Setup (Once)
1. Create Supabase project at https://supabase.com
2. Provide API credentials to Claude
3. Claude will initialize database schema

### Daily Use
1. Claude works on features
2. Review `DAILY_SUMMARY_[DATE].md` each evening
3. Approve/reject deletions
4. Next day continues from clean state

---

## Key Files

- **REBUILD_PLAN.md** - Architecture and phases
- **CHANGELOG.md** - High-level version history
- **DAILY_SUMMARY_[DATE].md** - Daily work summaries (created each day)
- **.git/** - Git repository (full change history)

---

## What Not to Do

❌ Manually edit the database (use the app)  
❌ Delete .git folder (loses all history)  
❌ Edit daily summaries after approval  
❌ Skip reviewing daily summaries  

---

## Contact & Questions

During rebuild, all work is documented in daily summaries. Review and approve at end of each day.

**Backup Schedule:**
- Daily Git commits
- Weekly CSV exports
- Supabase automatic backups (daily)

---

