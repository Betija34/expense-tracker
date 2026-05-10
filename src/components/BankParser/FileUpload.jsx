import { useState } from 'react'
import { supabase } from '../../supabaseClient'
import Tesseract from 'tesseract.js'
import './BankParser.css'

export function FileUpload({ selectedCompany, onUploadSuccess }) {
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [processingStatus, setProcessingStatus] = useState('')

  const handleDragOver = (e) => {
    e.preventDefault()
    e.currentTarget.classList.add('drag-over')
  }

  const handleDragLeave = (e) => {
    e.currentTarget.classList.remove('drag-over')
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.currentTarget.classList.remove('drag-over')
    const droppedFiles = Array.from(e.dataTransfer.files)
    handleFiles(droppedFiles)
  }

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files)
    handleFiles(selectedFiles)
  }

  const handleFiles = (newFiles) => {
    const validFiles = newFiles.filter(file => {
      const type = file.type
      const name = file.name.toLowerCase()
      return (
        type === 'text/csv' ||
        type === 'application/pdf' ||
        type.startsWith('image/')
      )
    })

    if (validFiles.length === 0) {
      setError('Please upload CSV, PDF, or image files only')
      return
    }

    setFiles(prev => [...prev, ...validFiles])
    setError(null)
  }

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  // Extract month from filename
  const extractMonthFromFilename = (filename) => {
    // Format: RMC/RCC January 2026 ...
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
                        'july', 'august', 'september', 'october', 'november', 'december']

    const lowerFilename = filename.toLowerCase()
    let monthIndex = -1
    let monthName = ''

    for (const [index, month] of monthNames.entries()) {
      if (lowerFilename.includes(month)) {
        monthIndex = index + 1
        monthName = month
        break
      }
    }

    // Extract year (4 digit number after month name)
    const yearMatch = lowerFilename.match(new RegExp(`${monthName}\\s+(\\d{4})`))
    const year = yearMatch ? yearMatch[1] : null

    return monthIndex > 0 && year ? { month: monthIndex, year: parseInt(year), name: monthName } : null
  }

  // Validate transaction dates against filename month
  const validateTransactionDates = (transactions, fileMonth) => {
    if (!fileMonth) return { valid: true, issues: [] }

    const issues = []
    for (const tx of transactions) {
      const txDate = new Date(tx.date)
      const txMonth = txDate.getMonth() + 1
      const txYear = txDate.getFullYear()

      if (txMonth !== fileMonth.month || txYear !== fileMonth.year) {
        issues.push(`Transaction on ${tx.date} doesn't match file month (${fileMonth.name} ${fileMonth.year})`)
      }
    }

    return {
      valid: issues.length === 0,
      issues: issues.slice(0, 3) // Show first 3 issues
    }
  }

  // Detect account type from OCR text
  const detectAccountType = (text) => {
    const lowerText = text.toLowerCase()
    if (lowerText.includes('mastercard') || lowerText.includes('credit')) {
      return 'Mastercard'
    }
    return 'Current Account'
  }

  // Extract transactions from OCR text
  const extractTransactions = (text) => {
    const transactions = []

    // Match patterns like: DATE VENDOR AMOUNT
    // This is a basic pattern - adjust based on your bank statement format
    const patterns = [
      /(\d{1,2}\/\d{1,2}\/\d{4})\s+(.+?)\s+(€|USD|\$)\s*([\d,]+\.?\d*)/gi,
      /(\d{2}-\d{2}-\d{4})\s+(.+?)\s+(€|USD|\$)\s*([\d,]+\.?\d*)/gi,
    ]

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(text)) !== null) {
        const [, date, vendor, currency, amount] = match
        if (vendor && vendor.trim().length > 0) {
          transactions.push({
            date: date.replace(/\//g, '-').replace(/-/g, '/'),
            vendor: vendor.trim(),
            amount: parseFloat(amount.replace(',', '')),
            currency: currency,
            type: amount.includes('-') ? 'debit' : 'credit',
            status: 'pending'
          })
        }
      }
    }

    return transactions
  }

  // Process image with OCR
  const processImageWithOCR = async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = async (e) => {
        try {
          setProcessingStatus(`Processing ${file.name}...`)

          const result = await Tesseract.recognize(
            e.target.result,
            'eng',
            { logger: (m) => console.log('OCR Progress:', m) }
          )

          const text = result.data.text
          const transactions = extractTransactions(text)
          const accountType = detectAccountType(text)

          resolve({
            file: file.name,
            text: text,
            transactions: transactions,
            accountType: accountType,
            transactionCount: transactions.length
          })
        } catch (err) {
          reject(err)
        }
      }
      reader.readAsDataURL(file)
    })
  }

  const handleUpload = async () => {
    if (files.length === 0) {
      setError('Please select at least one file')
      return
    }

    try {
      setUploading(true)
      setError(null)
      setProcessingStatus('Starting OCR processing...')

      // Get company_id
      const { data: company } = await supabase
        .from('companies')
        .select('id')
        .eq('name', selectedCompany)
        .single()

      if (!company) throw new Error('Company not found')

      // Get account for the company
      const { data: accounts } = await supabase
        .from('accounts')
        .select('id, name')
        .eq('company_id', company.id)

      if (!accounts || accounts.length === 0) throw new Error('No accounts found for company')

      // Process each file
      let totalTransactions = 0
      const processedData = []

      for (const file of files) {
        const isImage = file.type.startsWith('image/')

        // Extract month from filename
        const fileMonth = extractMonthFromFilename(file.name)
        if (fileMonth) {
          setProcessingStatus(`Validating ${file.name} (${fileMonth.name} ${fileMonth.year})...`)
        }

        let fileData = {
          file: file,
          transactions: [],
          accountType: 'Current Account'
        }

        if (isImage) {
          fileData = await processImageWithOCR(file)
        } else if (file.type === 'text/csv') {
          // Basic CSV parsing - adjust based on your CSV format
          const text = await file.text()
          const lines = text.split('\n')
          const transactions = lines
            .slice(1) // Skip header
            .filter(line => line.trim())
            .map(line => {
              const [date, vendor, amount, type] = line.split(',')
              return {
                date: date?.trim() || '',
                vendor: vendor?.trim() || '',
                amount: parseFloat(amount) || 0,
                type: type?.trim() || 'debit',
                status: 'pending'
              }
            })
          fileData.transactions = transactions
          fileData.transactionCount = transactions.length
        }

        // Validate transaction dates match filename month
        if (fileMonth && fileData.transactions && fileData.transactions.length > 0) {
          const validation = validateTransactionDates(fileData.transactions, fileMonth)
          if (!validation.valid) {
            console.warn(`⚠️ Month mismatch in ${file.name}:`, validation.issues)
            // Still allow upload but log the warning
            fileData.monthWarning = validation.issues
          }
          fileData.fileMonth = fileMonth
        }

        totalTransactions += fileData.transactionCount || 0
        processedData.push(fileData)
        setProcessingStatus(`Processed ${processedData.length}/${files.length} files...`)
      }

      // Find appropriate account based on detected type
      const primaryAccount = accounts.find(a => {
        if (processedData[0]?.accountType === 'Mastercard') {
          return a.name === 'Mastercard'
        }
        return a.name === 'Current Account'
      }) || accounts[0]

      // Generate file name: COMPANY-MONTH-YEAR-TRANSACTIONCOUNT.png
      const now = new Date()
      const monthYear = `${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`
      const fileName = `${selectedCompany.split(' ')[0]}-${monthYear}-${totalTransactions}.png`

      // Create bank import record
      setProcessingStatus('Saving to database...')

      const { data: bankImport, error: importError } = await supabase
        .from('bank_imports')
        .insert({
          company_id: company.id,
          account_id: primaryAccount.id,
          import_date: new Date().toISOString().split('T')[0],
          file_name: fileName,
          file_type: files[0].type.startsWith('image/') ? 'image' : 'csv',
          transaction_count: totalTransactions,
          status: 'completed'
        })
        .select()
        .single()

      if (importError) throw importError

      // Insert all transactions
      const transactionsToInsert = processedData.flatMap(data =>
        (data.transactions || []).map(t => ({
          bank_import_id: bankImport.id,
          company_id: company.id,
          account_id: primaryAccount.id,
          transaction_date: t.date,
          description: t.vendor,
          amount: t.amount,
          transaction_type: t.type,
          status: 'unmatched',
          created_at: new Date().toISOString()
        }))
      )

      if (transactionsToInsert.length > 0) {
        const { error: transError } = await supabase
          .from('bank_transactions')
          .insert(transactionsToInsert)

        if (transError) throw transError
      }

      setProcessingStatus('')
      setSuccess(`Successfully imported ${totalTransactions} transactions from ${files.length} file(s)!`)
      setFiles([])

      // Trigger callback to refresh
      if (onUploadSuccess) {
        onUploadSuccess(bankImport.id)
      }

      setTimeout(() => setSuccess(null), 5000)
    } catch (err) {
      console.error('Upload error:', err)
      setError(err.message || 'Upload failed')
      setProcessingStatus('')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="file-upload-section">
      <h3>Upload Bank Statements</h3>

      {error && <div className="message error">{error}</div>}
      {success && <div className="message success">{success}</div>}
      {processingStatus && <div className="message info">{processingStatus}</div>}

      <div
        className="upload-area"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="upload-content">
          <p>📎 Drag & drop bank statements here or click to select</p>
          <p style={{ fontSize: '12px', color: '#999', marginTop: '5px' }}>
            Supports: Images (JPG, PNG), PDF, CSV - OCR will extract transactions automatically
          </p>
          <input
            type="file"
            multiple
            accept=".csv,.pdf,.jpg,.jpeg,.png"
            onChange={handleFileSelect}
            className="file-input"
          />
        </div>
      </div>

      {files.length > 0 && (
        <div className="file-list">
          <h4>Selected Files ({files.length})</h4>
          <ul>
            {files.map((file, idx) => (
              <li key={idx}>
                <span>📎 {file.name} ({(file.size / 1024).toFixed(2)} KB)</span>
                <button
                  onClick={() => removeFile(idx)}
                  className="btn-remove"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          <button
            onClick={handleUpload}
            disabled={uploading}
            className="button"
            style={{ cursor: uploading ? 'not-allowed' : 'pointer' }}
          >
            {uploading ? '⏳ Processing with OCR...' : '✓ Upload & Process'}
          </button>
        </div>
      )}
    </div>
  )
}
