# Transaction Query Fixes - Code Changes

Apply these changes to fix the "0 transactions" issue. The problem: the old code queries by `bankImportId` (which is now null), but we need to query by `company_id` instead.

---

## 1. BankParser.jsx

**REMOVE this line (line 10):**
```javascript
const [currentBankImportId, setCurrentBankImportId] = useState(null)
```

**REPLACE the useEffect (lines 14-19) with:**
```javascript
useEffect(() => {
  if (selectedCompany) {
    loadStats()
  }
}, [selectedCompany, refreshTrigger])
```

**REPLACE the loadStats function (lines 21-43) with:**
```javascript
const loadStats = async () => {
  try {
    // Get company ID first
    const { data: company } = await supabase
      .from('companies')
      .select('id')
      .eq('name', selectedCompany)
      .single()

    if (!company) return

    // Query all transactions for this company
    const { data: transactions, error } = await supabase
      .from('bank_transactions')
      .select('*')
      .eq('company_id', company.id)

    if (error) throw error

    const total = transactions?.length || 0
    const finalized = transactions?.filter(t => t.status === 'matched').length || 0
    const edited = transactions?.filter(t => t.status === 'unmatched').length || 0

    setStats({
      totalTransactions: total,
      editedCount: edited,
      finalizedCount: finalized
    })
  } catch (err) {
    console.error('Error loading stats:', err)
  }
}
```

**REPLACE the handleUploadSuccess function (lines 45-48) with:**
```javascript
const handleUploadSuccess = () => {
  // Refresh stats after upload (doesn't matter which file was uploaded)
  setRefreshTrigger(prev => prev + 1)
}
```

**REPLACE the JSX return section UploadedFiles and TransactionTable (lines 68-90) with:**
```javascript
{/* Uploaded Files Section - Moved up for better UX */}
<UploadedFiles
  selectedCompany={selectedCompany}
  onRefresh={handleImportRefresh}
/>

<hr className="section-divider" />

{/* Stats Section - Show if we have transactions */}
{stats.totalTransactions > 0 && (
  <>
    <BankParserStats stats={stats} />
    <hr className="section-divider" />
  </>
)}

{/* Transactions Section */}
<TransactionTable
  selectedCompany={selectedCompany}
  onStatusChange={loadStats}
  refreshTrigger={refreshTrigger}
/>
```

---

## 2. TransactionTable.jsx

**REPLACE the function signature (line 6) with:**
```javascript
export function TransactionTable({ selectedCompany, onStatusChange, refreshTrigger }) {
```

**REPLACE the useEffect (lines 13-17) with:**
```javascript
useEffect(() => {
  if (selectedCompany) {
    loadTransactions()
  }
}, [selectedCompany, refreshTrigger])
```

**REPLACE the loadTransactions function (lines 19-35) with:**
```javascript
const loadTransactions = async () => {
  try {
    setLoading(true)

    // Get company ID
    const { data: company } = await supabase
      .from('companies')
      .select('id')
      .eq('name', selectedCompany)
      .single()

    if (!company) {
      setTransactions([])
      setLoading(false)
      return
    }

    // Query all transactions for this company
    const { data, error } = await supabase
      .from('bank_transactions')
      .select('*, accounts(name)')
      .eq('company_id', company.id)
      .order('transaction_date', { ascending: false })

    if (error) throw error
    setTransactions(data || [])
  } catch (err) {
    console.error('Error loading transactions:', err)
  } finally {
    setLoading(false)
  }
}
```

---

## 3. UploadedFiles.jsx

**REPLACE the function signature (line 4) with:**
```javascript
export function UploadedFiles({ selectedCompany, onRefresh }) {

**REPLACE the useEffect (lines 8-11) with:**
```javascript
useEffect(() => {
  if (!selectedCompany) return
  loadImports()
}, [selectedCompany, onRefresh])

      // Get company ID
      const { data: company } = await supabase
        .from('companies')
        .select('id')
        .eq('name', selectedCompany)
        .single()

      if (!company) {
        setTransactions([])
        setLoading(false)
        return
      }

      // Query all transactions for this company
      const { data, error } = await supabase
        .from('bank_transactions')
        .select('*, accounts(name)')
        .eq('company_id', company.id)
        .order('transaction_date', { ascending: false })

      if (error) throw error
      setTransactions(data || [])
    } catch (err) {
      console.error('Error loading transactions:', err)
    } finally {
      setLoading(false)
    }
  
    }
  }, [selectedCompany, refreshTrigger])

---

## How to Apply These Changes

1. Open each file in your editor
2. Copy the exact replacement code from above
3. Find the section marked and replace it
4. Save each file
5. Commit and push:

```bash
git add src/components/BankParser/BankParser.jsx src/components/BankParser/TransactionTable.jsx src/components/BankParser/UploadedFiles.jsx
git commit -m "Fix: Query transactions by company_id instead of bankImportId"
git push origin main
```

6. Wait 2-3 minutes for Vercel to deploy
7. Refresh the app and try uploading files again — **transactions should now appear! ✅**
