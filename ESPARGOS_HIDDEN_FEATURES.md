# Espargos — Hidden Features Reference

This file is the **single source of truth** for everything that's been hidden
or made Espargos-specific in the app. Espargos was set up by cloning Rabona's
structure, then hiding the parts that don't apply to Espargos's current
operations. All hidden features remain in the codebase (just visually
hidden) and can be re-enabled at any time by removing one conditional.

**Use this file whenever Espargos's business model changes** — e.g. if
shareholders start travelling for Espargos, if Espargos opens a second bank
account, or if Espargos starts reimbursing client expenses.

---

## Espargos's current business reality (as of May 2026)

| Aspect | Espargos status | What's hidden because of it |
|---|---|---|
| **Bank accounts** | Single account (357035271533) | Internal Account Movements section in Dashboard |
| **Client reimbursements** | Not currently reimbursing clients | Client Report tab; Reimbursable Tracking in Dashboard |
| **Shareholder travel** | Shareholders don't travel for Espargos | Travel Log tab; Allowances section in Shareholder Report |
| **Reference numbers** | Distinguish from Rabona refs | Stays — E-prefix on every Espargos main ref |
| **Logo** | No proper logo yet | Text placeholder "ESPARGOS HOLDINGS" used in print reports |

---

## How re-enabling works (general pattern)

Every hidden feature is wrapped in one of these conditional patterns:

```jsx
{selectedCompany !== 'Espargos' && (
  // ... the feature ...
)}
```

or

```jsx
{companyName !== 'Espargos' && (
  // ... the feature ...
)}
```

**To re-enable any hidden feature**: delete the wrapping `{selectedCompany !== 'Espargos' && (` line and the matching closing `)}` line. The feature inside is left exactly as-is — no other changes needed. Travel data, reimbursement logic, account movement queries — everything is already coded, just not shown.

---

## 1. Travel Log tab

**Location**: `src/App.jsx`, around line 137

**Why hidden**: Shareholders don't travel for Espargos. Travel Log auto-derives travel days for the Shareholder Report's Allowances section, so there's nothing to display if there's no travel.

**Current (hidden)**:
```jsx
{selectedCompany !== 'Espargos' && (
  <button
    className={`tab-button ${currentTab === 'travel' ? 'active' : ''}`}
    onClick={() => setCurrentTab('travel')}
  >
    Travel Log
  </button>
)}
```

**To re-enable** — remove the wrapping conditional so the button always renders:
```jsx
<button
  className={`tab-button ${currentTab === 'travel' ? 'active' : ''}`}
  onClick={() => setCurrentTab('travel')}
>
  Travel Log
</button>
```

**Also remove the auto-bounce** at `src/App.jsx` line ~52 (or update it to not include `'travel'`):
```jsx
useEffect(() => {
  if (selectedCompany === 'Espargos' && (currentTab === 'client' || currentTab === 'travel')) {
    setCurrentTab('dashboard')
  }
}, [selectedCompany, currentTab])
```
If you only re-enable Travel (not Client), change `(currentTab === 'client' || currentTab === 'travel')` to `currentTab === 'client'` (drop the `'travel'` part).

---

## 2. Client Report tab

**Location**: `src/App.jsx`, around line 149

**Why hidden**: Espargos doesn't currently reimburse client expenses. The Client Report is a pure view over expenses tagged as reimbursable with a client name — if Espargos has no such expenses, the report would be empty.

**Current (hidden)**:
```jsx
{selectedCompany !== 'Espargos' && (
  <button
    className={`tab-button ${currentTab === 'client' ? 'active' : ''}`}
    onClick={() => setCurrentTab('client')}
  >
    Client Report
  </button>
)}
```

**To re-enable** — remove the wrapping conditional:
```jsx
<button
  className={`tab-button ${currentTab === 'client' ? 'active' : ''}`}
  onClick={() => setCurrentTab('client')}
>
  Client Report
</button>
```

**Also update the auto-bounce** at `src/App.jsx` line ~52 — same as above, drop `'client'` from the condition if you only re-enable Client.

---

## 3. Allowances section in Shareholder Report

**Location**: `src/components/ShareholderReport/ShareholderReport.jsx`, around line 362

**Why hidden**: Allowances are based on travel days. No Espargos travel → no allowances. The `allowances` table and all related logic stays intact.

**Current (hidden)**:
```jsx
{companyName !== 'Espargos' && (
  <AllowanceSection
    selectedCompany={companyName}
    selectedMonth={selectedMonth}
    selectedYear={selectedYear}
    travelPeriods={travelPeriods}
  />
)}
```

**To re-enable** — remove the wrapping conditional:
```jsx
<AllowanceSection
  selectedCompany={companyName}
  selectedMonth={selectedMonth}
  selectedYear={selectedYear}
  travelPeriods={travelPeriods}
/>
```

---

## 4. Allowances row in the Net Balance breakdown

**Location**: `src/components/ShareholderReport/ShareholderReport.jsx`, around line 628

**Why hidden**: Same reason — no Espargos travel allowances to add to the Net Balance.

**Current (hidden)** — search for `companyName !== 'Espargos'` around line 628; it wraps the row that adds Allowances to the Net Balance "increases" column.

**To re-enable** — remove the wrapping conditional. The row will then appear alongside Transfers from Shareholder, Cash Expenses, and any other allowances.

---

## 5. Internal Account Movements (Dashboard)

**Location**: `src/components/Dashboard/Dashboard.jsx`, around line 399

**Why hidden**: Espargos has only one bank account (357035271533), so there's nothing to move between. Rabona has both RCC (Current) and RMC (Mastercard).

**Current (hidden)**:
```jsx
{selectedCompany !== 'Espargos' && (
  <>
    <SectionHeader title="Internal Account Movements" subtitle={`Money moved between ${selectedCompany}'s own accounts (RMC ↔ RCC)`} />
    <div style={threeColumnGrid}>
      <StatCard title="Mastercard → Current" ... />
      <StatCard title="Current → Mastercard" ... />
      ...
    </div>
  </>
)}
```

**To re-enable** — remove the wrapping conditional and the closing fragment.

**Important if Espargos opens a second account**: you'll also need to add the second account to the database (`accounts` table) and possibly map its number in `src/components/BankParser/FileUpload.jsx` inside `accountMappings`. See file for the format.

---

## 6. Reimbursable Tracking (Dashboard)

**Location**: `src/components/Dashboard/Dashboard.jsx`, around line 457

**Why hidden**: Same as Client Report tab — Espargos doesn't reimburse clients.

**Current (hidden)**:
```jsx
{selectedCompany !== 'Espargos' && (
  <>
    <SectionHeader title="Reimbursable Tracking" subtitle="Expenses paid for clients — what's owed back" />
    <div style={threeColumnGrid}>
      <StatCard title="Reimbursable Expenses (out)" ... />
      <StatCard title="Reimbursements Received (in)" ... />
      <StatCard title="Outstanding (owed back)" ... />
    </div>
    {/* Per-client breakdown list */}
  </>
)}
```

**To re-enable** — remove the wrapping conditional and the closing fragment.

---

## 7. Espargos logo placeholder

**Location**: `src/components/ClientReport/ClientReport.jsx`, around line 334

**Why this exists**: Espargos doesn't have a proper SVG logo yet, so we use a text-based placeholder for the letterhead in print reports. Rabona has a green RabonaLogo SVG component.

**Current (showing text placeholder)**:
```jsx
{companyName === 'Espargos' && (
  <div className="espargos-logo" style={{
    fontSize: 18, fontWeight: 700, color: '#1f2937', textAlign: 'center', lineHeight: 1.1,
  }}>
    ESPARGOS
    <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2 }}>HOLDINGS</div>
  </div>
)}
```

**When you get a proper Espargos logo** — create a new `<EspargosLogo />` component in `src/components/Logos/` (mirror the existing Rabona logo) and replace the placeholder div above with `<EspargosLogo />`. The print CSS at `src/App.css` already styles `.espargos-logo` for the larger print version — you'd update that to target the new SVG instead.

---

## 8. E-prefix on main references (KEEP — not hidden, this is the standing convention)

**Location**: `src/lib/refUtils.js`, around line 45

**Purpose**: Espargos refs are visually distinct from Rabona refs (E26/1/4 vs 26/1/4).

**Code (keep as-is)**:
```js
export function companyRefPrefix(companyName) {
  if (companyName === 'Espargos') return 'E'
  return ''
}
```

**To add a third company later** — extend the function:
```js
export function companyRefPrefix(companyName) {
  if (companyName === 'Espargos') return 'E'
  if (companyName === 'NewCompanyName') return 'N'
  return ''
}
```

The `buildMainRef()` helper picks up the new prefix automatically across all 5 INSERT sites (TransactionTable, FinalizeTransaction × 2, AddExpense × 2). No other code changes needed.

---

## 9. Bank Parser account mapping

**Location**: `src/components/BankParser/FileUpload.jsx`, the `accountMappings` object inside `extractAccountNumber()`

**Current**:
```js
const accountMappings = {
  // Rabona Holdings
  '357032438089': { type: 'Current Account', company: 'Rabona Holdings' },  // RCC
  '357535881125': { type: 'Mastercard',      company: 'Rabona Holdings' },  // RMC
  // Espargos
  '357035271533': { type: 'Current Account', company: 'Espargos' },         // Espargos's single account
}
```

**To add another account** (Espargos credit card, third company, etc.) — append a new entry. The OCR account-detection + the upload layer-2 mismatch check will pick up the new account automatically.

---

## Quick test after re-enabling anything

1. Hard-refresh the app (Cmd+Shift+R)
2. Switch to Espargos in the top bar
3. Confirm the previously-hidden tab/section now appears
4. Switch back to Rabona Holdings
5. Confirm Rabona's view is unchanged (it should be — none of these hides affected Rabona)

---

## Future enhancement ideas (not yet implemented)

- **Per-company feature flags in the database** — instead of hardcoded `selectedCompany !== 'Espargos'`, store a `feature_flags` JSON column on the `companies` table (e.g. `{travel: false, client_reimbursement: false, multi_account: false}`). Then conditionals become `{currentCompany.feature_flags.travel && ...}`. Cleaner for adding a third company.
- **Admin UI to toggle these flags** — a settings page where you can flip features on/off per company without touching code.

These are nice-to-haves; the current approach works fine for two companies.
