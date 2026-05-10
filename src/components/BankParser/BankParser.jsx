import { useState } from 'react'
import { FileUpload } from './FileUpload'
import { TransactionTable } from './TransactionTable'
import './BankParser.css'

export function BankParser({ selectedCompany }) {
  const [currentBankImportId, setCurrentBankImportId] = useState(null)

  const handleUploadSuccess = (bankImportId) => {
    setCurrentBankImportId(bankImportId)
  }

  return (
    <div className="bank-parser-section">
      <h2>Bank Statement Parser</h2>

      <div className="parser-container">
        <FileUpload
          selectedCompany={selectedCompany}
          onUploadSuccess={handleUploadSuccess}
        />

        <hr className="section-divider" />

        <TransactionTable
          bankImportId={currentBankImportId}
          selectedCompany={selectedCompany}
        />
      </div>
    </div>
  )
}
