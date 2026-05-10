import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { FileUpload } from './FileUpload'
import { BankParserStats } from './BankParserStats'
import { TransactionTable } from './TransactionTable'
import { UploadedFiles } from './UploadedFiles'
import './BankParser.css'

export function BankParser({ selectedCompany }) {
  const [currentBankImportId, setCurrentBankImportId] = useState(null)
  const [stats, setStats] = useState({ totalTransactions: 0, editedCount: 0, finalizedCount: 0 })
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  // Load stats whenever bankImportId changes
  useEffect(() => {
    if (currentBankImportId) {
      loadStats()
    }
  }, [currentBankImportId, refreshTrigger])

  const loadStats = async () => {
    try {
      const { data: transactions, error } = await supabase
        .from('bank_transactions')
        .select('*')
        .eq('bank_import_id', currentBankImportId)

      if (error) throw error

      const total = transactions?.length || 0
      const finalized = transactions?.filter(t => t.status === 'matched').length || 0
      // edited count could be transactions that have been modified - for now, use pending unmatched
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

  const handleUploadSuccess = (bankImportId) => {
    setCurrentBankImportId(bankImportId)
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
          bankImportId={currentBankImportId}
          selectedCompany={selectedCompany}
          onRefresh={handleImportRefresh}
        />

        <hr className="section-divider" />

        {/* Stats Section - Only show if we have an import */}
        {currentBankImportId && (
          <>
            <BankParserStats stats={stats} />
            <hr className="section-divider" />
          </>
        )}

        {/* Transactions Section */}
        <TransactionTable
          bankImportId={currentBankImportId}
          selectedCompany={selectedCompany}
          onStatusChange={loadStats}
          refreshTrigger={refreshTrigger}
        />
      </div>
    </div>
  )
}
