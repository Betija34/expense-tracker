import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { FileUpload } from './FileUpload'
import { BankParserStats } from './BankParserStats'
import { TransactionTable } from './TransactionTable'
import { UploadedFiles } from './UploadedFiles'
import './BankParser.css'

export function BankParser({ selectedCompany }) {
  const [stats, setStats] = useState({ totalTransactions: 0, editedCount: 0, finalizedCount: 0 })
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  useEffect(() => {
    if (selectedCompany) {
      loadStats()
    }
  }, [selectedCompany, refreshTrigger])

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
          onUploadSuccess={handleUploadSuccess}
        />

        <hr className="section-divider" />

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
      </div>
    </div>
  )
}
