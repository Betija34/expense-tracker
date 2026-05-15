import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { FileUpload } from './FileUpload'
import { BankParserStats } from './BankParserStats'
import { TransactionTable } from './TransactionTable'
import { UploadedFiles } from './UploadedFiles'
import './BankParser.css'

// Helper: build a [start, nextMonthStart) date range for the selected month + year
// so the same filter can be used across Supabase queries (.gte / .lt).
function monthRange(month, year) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const nextStart = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
  return { start, nextStart }
}

export function BankParser({ selectedCompany, selectedMonth, selectedYear }) {
  const [stats, setStats] = useState({ totalTransactions: 0, editedCount: 0, finalizedCount: 0 })
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  useEffect(() => {
    if (selectedCompany && selectedMonth && selectedYear) {
      loadStats()
    }
  }, [selectedCompany, selectedMonth, selectedYear, refreshTrigger])

  const loadStats = async () => {
    try {
      // Get company ID first
      const { data: company } = await supabase
        .from('companies')
        .select('id')
        .eq('name', selectedCompany)
        .single()

      if (!company) return

      // Query transactions for this company SCOPED TO THE SELECTED MONTH/YEAR
      const { start, nextStart } = monthRange(selectedMonth, selectedYear)
      const { data: transactions, error } = await supabase
        .from('bank_transactions')
        .select('*')
        .eq('company_id', company.id)
        .gte('transaction_date', start)
        .lt('transaction_date', nextStart)

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

  const handleUploadSuccess = () => {
    // Refresh stats after upload (doesn't matter which file was uploaded)
    setRefreshTrigger(prev => prev + 1)
  }

  const handleImportRefresh = () => {
    setRefreshTrigger(prev => prev + 1)
  }

  return (
    <div className="bank-parser-section">
      <h2>Bank Statement Parser</h2>

      <div className="parser-container">
        {/* File Upload Section */}
        <FileUpload
          selectedCompany={selectedCompany}
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          onUploadSuccess={handleUploadSuccess}
        />

        <hr className="section-divider" />

        {/* Uploaded Files Section - Moved up for better UX */}
        <UploadedFiles
          selectedCompany={selectedCompany}
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          onRefresh={handleImportRefresh}
          refreshTrigger={refreshTrigger}
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
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          // Bump refreshTrigger on any internal mutation so UploadedFiles
          // (live transaction count) and BankParserStats both stay in sync
          // with row-level edits / deletes / finalize.
          onStatusChange={() => setRefreshTrigger(prev => prev + 1)}
          refreshTrigger={refreshTrigger}
        />
      </div>
    </div>
  )
}
