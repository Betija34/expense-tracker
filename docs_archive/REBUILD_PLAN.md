# Rabona Expense Tracking System - Rebuild Plan

**Status:** In Progress  
**Start Date:** May 10, 2026  
**Target Completion:** May 24, 2026 (2 weeks)

---

## Architecture Overview

### Tech Stack
- **Frontend:** React 18 + Vite (fast, modern development)
- **Backend API:** Node.js + Express (lightweight, easy to maintain)
- **Database:** Supabase (PostgreSQL + auth + backups)
- **Authentication:** Supabase Auth (built-in)
- **Hosting:** Vercel (frontend) + Railway/Render (backend) — optional, can run locally

### Key Features to Rebuild
1. **Dashboard** - KPI cards, month/year selector
2. **Bank Statement Parser** - OCR-based import (Tesseract.js)
3. **Add Expense** - Form with validation
4. **View Expenses** - Table with filtering/sorting
5. **Shareholder Reports** - Summary reports
6. **Travel Log** - Travel expense tracking
7. **Client Report** - Client reimbursement tracking
8. **Export & Reports** - CSV/PDF exports
9. **Multi-company support** - Rabona Holdings + Espargos

### Complex Logic to Preserve
- Internal account transfers (Mastercard ↔ Current)
- Shareholder movements (YK, BK with transfers)
- Inter-company transfers (Rabona ↔ Espargos)
- Client reimbursement tracking
- Expense categorization and splitting

---

## Phase 1: Foundation (Day 1) ✅ COMPLETE
- [x] Supabase project setup
- [x] Database schema design (12 tables)
- [x] React + Vite project scaffolding
- [x] Supabase client configuration
- [x] Component structure scaffolding
- [x] Git workflow established

## Phase 2: Core Features (Days 2-15) 🚀 STARTING MAY 11

### Week 1: Data Import & Management
- [ ] Bank Statement Parser (Days 1-3)
  - [ ] File upload component
  - [ ] OCR extraction
  - [ ] Transaction display
  - [ ] Import to database
- [ ] View Expenses (Days 4-5)
  - [ ] Expense table
  - [ ] Bank transaction matching
  - [ ] Soft delete
  - [ ] Status tracking
- [ ] Add Expense (Days 6-7)
  - [ ] Manual entry form
  - [ ] Validation
  - [ ] Real-time sync

### Week 2: Analytics & Reports
- [ ] Dashboard (Days 8-9)
  - [ ] KPI cards
  - [ ] Real-time calculations
  - [ ] Month/year filtering
- [ ] Shareholder Report (Days 10-11)
  - [ ] YK/BK tracking
  - [ ] Print/PDF option
- [ ] Travel Log (Days 12-13)
  - [ ] Trip tracking
  - [ ] Prepaid vs actual
  - [ ] Print/PDF option
- [ ] Client Report (Days 14-15)
  - [ ] Client reimbursement tracking
  - [ ] Print/PDF option

## Phase 3: Polish & Testing (Days 16+)
- [ ] Integration testing
- [ ] Bug fixes from daily summaries
- [ ] Performance optimization
- [ ] Data migration from old system
- [ ] Documentation updates
- [ ] Production readiness

---

## Safety Protocols (CRITICAL)

### Daily Workflow
1. **End of Day:** Create `DAILY_SUMMARY_[DATE].md`
2. **Daily Summary includes:**
   - ✅ What was added/improved
   - 🔄 What was changed
   - ❌ What was deleted (pending approval)
3. **User reviews:** YES to delete permanently / NO to keep
4. **If YES:** Clean commit with approval documented
5. **If NO:** Revert deletions, save clean state
6. **Next day:** Start from approved version

### Git Protocol
- Every change is a commit
- Commit messages are descriptive
- All deletions are in separate commits (for easy revert)
- Weekly code review sessions

### No Data Loss Guarantees
- ✅ Daily Git commits
- ✅ Weekly full data exports (CSV)
- ✅ Supabase automatic backups
- ✅ Instant revert capability
- ✅ Approval gates on all deletions

---

## Next Steps
1. **User creates Supabase account** (free tier: https://supabase.com)
2. **User provides API credentials**
3. **Begin Phase 1 setup**
4. **First daily summary tonight**

---

## Questions/Decisions Pending
- [ ] Supabase credentials
- [ ] Preferred hosting (local dev vs. cloud deployment)
- [ ] Priority features (MVP vs. all features)
- [ ] Data migration strategy (import old expenses?)

