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
      // Parse ISO format date (YYYY-MM-DD)
      const [year, month, day] = tx.date.split('-')
      const txMonth = parseInt(month)
      const txYear = parseInt(year)

      if (txMonth !== fileMonth.month || txYear !== fileMonth.year) {
        const displayDate = new Date(`${year}-${month}-${day}T00:00:00Z`).toLocaleDateString()
        issues.push(`Transaction on ${displayDate} doesn't match file month (${fileMonth.name} ${fileMonth.year})`)
      }
    }

    return {
      valid: issues.length === 0,
      issues: issues.slice(0, 3) // Show first 3 issues
    }
  }

  // Extract account number from OCR text (appears at top of statement)
  // Returns { accountNumber, accountType } or { accountNumber: null, accountType: 'Unknown' }
  const extractAccountNumber = (text) => {
    // Account numbers for Rabona accounts
    const accountMappings = {
      '357032438089': 'Current Account',  // RCC
      '357535881125': 'Mastercard'         // RMC
    }

    // Try to find any known account number in the text
    for (const [accountNum, accountType] of Object.entries(accountMappings)) {
      if (text.includes(accountNum)) {
        return { accountNumber: accountNum, accountType }
      }
    }

    // If no account number found, return unknown
    return { accountNumber: null, accountType: 'Unknown' }
  }

  // Extract transactions from OCR text
  const extractTransactions = (text) => {
    const transactions = []

    // Match patterns for bank statement format:
    // DD/MM/YYYY  Description  Amount(EUR)
    // Amount format: European (comma as decimal, dot as thousands: 8.000,00)
    const patterns = [
      // Pattern 1: DD/MM/YYYY with European number format (8.000,00)
      /(\d{1,2}\/\d{1,2}\/\d{4})\s+(.+?)\s+([-]?[\d.]+,\d{2})/gi,
      // Pattern 2: DD-MM-YYYY with European number format
      /(\d{2}-\d{2}-\d{4})\s+(.+?)\s+([-]?[\d.]+,\d{2})/gi,
    ]

    console.log('📋 Extracting transactions from text. First 500 chars:', text.substring(0, 500))

    for (const pattern of patterns) {
      let match
      let patternMatches = 0
      while ((match = pattern.exec(text)) !== null) {
        patternMatches++
        const [, dateStr, vendor, amountStr] = match
        console.log(`  Match ${patternMatches}: Date=${dateStr}, Vendor="${vendor}", Amount=${amountStr}`)
        if (vendor && vendor.trim().length > 0) {
          // Parse European number format: 8.000,00 → 8000.00
          const parsedAmount = parseFloat(amountStr.replace(/\./g, '').replace(',', '.'))

          // Convert DD/MM/YYYY or DD-MM-YYYY to ISO 8601 format (YYYY-MM-DD)
          let isoDate
          if (dateStr.includes('/')) {
            const [day, month, year] = dateStr.split('/')
            isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          } else {
            const [day, month, year] = dateStr.split('-')
            isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          }

          transactions.push({
            date: isoDate,
            vendor: vendor.trim(),
            amount: parsedAmount,
            currency: 'EUR',
            type: parsedAmount < 0 ? 'debit' : 'credit',
            status: 'pending'
          })
        }
      }
      if (patternMatches > 0) {
        console.log(`✅ Pattern matched ${patternMatches} transactions`)
      }
    }

    console.log(`✅ Total extracted: ${transactions.length} transactions`)
    if (transactions.length > 0) {
      console.log('First transaction:', transactions[0])
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
          console.log('🔍 OCR extracted text (first 1000 chars):', text.substring(0, 1000))
          console.log('📏 Total text length:', text.length)

          const transactions = extractTransactions(text)
          const { accountNumber, accountType } = extractAccountNumber(text)

          console.log(`📝 File: ${file.name} | Transactions: ${transactions.length} | Account: ${accountType}`)

          if (!accountNumber) {
            throw new Error('Could not identify account number in statement. Ensure this is a valid Rabona bank statement.')
          }

          resolve({
            file: file.name,
            text: text,
            transactions: transactions,
            accountNumber: accountNumber,
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

    // Store files before upload (so we can show them after)
    const filesToUpload = [...files]

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

      // Process and upload each file SEPARATELY
      let totalTransactionsProcessed = 0
      let successfulUploads = 0
      const uploadErrors = []

      for (const file of files) {
        try {
          setProcessingStatus(`Processing ${file.name}...`)

          // CHECK FOR DUPLICATES - reject if file already uploaded
          const { data: existingFile } = await supabase
            .from('bank_imports')
            .select('id')
            .eq('company_id', company.id)
            .eq('file_name', file.name)
            .maybeSingle()

          if (existingFile) {
            uploadErrors.push(`❌ ${file.name} - Already uploaded. Duplicate files not allowed.`)
            continue
          }

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
            const text = await file.text()
            const lines = text.split('\n')
            const transactions = lines
              .slice(1)
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
            console.log(`📄 CSV File: ${file.name} | Found ${transactions.length} transactions`)
          }

          // Validate transaction dates match filename month
          if (fileMonth && fileData.transactions && fileData.transactions.length > 0) {
            const validation = validateTransactionDates(fileData.transactions, fileMonth)
            if (!validation.valid) {
              uploadErrors.push(`❌ ${file.name} - Month mismatch: ${validation.issues[0]}`)
              continue
            }
            fileData.fileMonth = fileMonth
          }

          // IMPORTANT: Match account for THIS file
          const primaryAccount = accounts.find(a => {
            if (fileData.accountType === 'Mastercard') {
              return a.name === 'Mastercard'
            }
            return a.name === 'Current Account'
          }) || accounts[0]

          // CREATE SEPARATE BANK IMPORT RECORD FOR THIS FILE
          setProcessingStatus(`Saving ${file.name} to database...`)

          const { data: bankImport, error: importError } = await supabase
            .from('bank_imports')
            .insert({
              company_id: company.id,
              account_id: primaryAccount.id,
              import_date: new Date().toISOString().split('T')[0],
              file_name: file.name,
              file_type: file.type.startsWith('image/') ? 'image' : 'csv',
              transaction_count: fileData.transactionCount || 0,
              status: 'completed'
            })
            .select()
            .single()

          if (importError) throw importError

          // INSERT TRANSACTIONS FOR THIS FILE
          if (fileData.transactions && fileData.transactions.length > 0) {
            const transactionsToInsert = fileData.transactions.map(t => ({
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

            const { error: transError } = await supabase
              .from('bank_transactions')
              .insert(transactionsToInsert)

            if (transError) throw transError
          }

          successfulUploads++
          totalTransactionsProcessed += fileData.transactionCount || 0
          setProcessingStatus(`Processed ${successfulUploads}/${files.length} files...`)
        } catch (fileErr) {
          uploadErrors.push(`❌ ${file.name} - ${fileErr.message}`)
        }
      }

      // Show results
      if (successfulUploads === 0) {
        throw new Error(`No files uploaded:\n${uploadErrors.join('\n')}`)
      }

      if (uploadErrors.length > 0) {
        setError(`⚠️ Partial upload:\n${uploadErrors.join('\n')}`)
      }

      setProcessingStatus('')
      setSuccess(`✅ Successfully uploaded ${successfulUploads} file(s) with ${totalTransactionsProcessed} transactions!`)
      // DON'T clear files - keep them visible so user can add more or see what was uploaded
      // setFiles([])

      // Trigger callback to refresh (pass company name since we don't have single bankImportId anymore)
      if (onUploadSuccess) {
        onUploadSuccess(selectedCompany)
      }

      setTimeout(() => setSuccess(null), 7000)
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
          <div className="file-list-header">
            <h4>Selected Files ({files.length})</h4>
            <button
              onClick={() => setFiles([])}
              className="btn-clear-all"
              title="Clear all files from list"
            >
              Clear All
            </button>
          </div>
          <ul>
            {files.map((file, idx) => (
              <li key={idx}>
                <span>📎 {file.name} ({(file.size / 1024).toFixed(2)} KB)</span>
                <button
                  onClick={() => removeFile(idx)}
                  className="btn-remove"
                  title="Remove this file"
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
