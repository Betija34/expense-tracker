import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import Tesseract from 'tesseract.js'
import './BankParser.css'

// Month-name lookup for the pre-upload Layer 0 check.
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

export function FileUpload({ selectedCompany, selectedMonth, selectedYear, onUploadSuccess }) {
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [processingStatus, setProcessingStatus] = useState('')

  // Clear the pending-upload buffer (and any leftover messages) whenever the
  // top-bar context changes. Without this, a file you dragged in while on
  // "Espargos January 2026" would stay listed even after you switch to February,
  // which is confusing because that file no longer belongs to the current period.
  useEffect(() => {
    setFiles([])
    setError(null)
    setSuccess(null)
    setProcessingStatus('')
  }, [selectedCompany, selectedMonth, selectedYear])

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

  // Detect company from filename (Layer 1 of the double-filter company check).
  //
  // This is the FAST pre-OCR check — it just looks at the filename, so we can
  // reject a wrong-company upload BEFORE running expensive OCR. Layer 2 (the
  // account-number check inside extractAccountNumber) runs after OCR as the
  // authoritative confirmation.
  //
  // Filename conventions:
  //   - Rabona:   "RCC January 2026.pdf", "RMC January 2026.pdf", "Rabona ..."
  //   - Espargos: "Espargos January 2026.pdf"
  //
  // Returns: 'Rabona Holdings' | 'Espargos' | null (no clear signal)
  const detectCompanyFromFilename = (filename) => {
    const name = filename.toLowerCase()
    if (/espargos/.test(name)) return 'Espargos'
    if (/^(rcc|rmc|rabona)/.test(name)) return 'Rabona Holdings'
    return null
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
  // Returns { accountNumber, accountType, company } or { accountNumber: null, accountType: 'Unknown', company: null }
  //
  // To add a new account: append to accountMappings with format:
  //   '<account_number>': { type: '<Current Account|Mastercard|...>', company: '<Rabona Holdings|Espargos>' }
  const extractAccountNumber = (text) => {
    const accountMappings = {
      // Rabona Holdings
      '357032438089': { type: 'Current Account', company: 'Rabona Holdings' },  // RCC
      '357535881125': { type: 'Mastercard',      company: 'Rabona Holdings' },  // RMC
      // Espargos
      '357035271533': { type: 'Current Account', company: 'Espargos' },         // Espargos's single bank account
    }

    // Try to find any known account number in the text
    for (const [accountNum, info] of Object.entries(accountMappings)) {
      if (text.includes(accountNum)) {
        return { accountNumber: accountNum, accountType: info.type, company: info.company }
      }
    }

    // If no account number found, return unknown
    return { accountNumber: null, accountType: 'Unknown', company: null }
  }

  // Extract transactions from OCR text
  const extractTransactions = (text) => {
    const transactions = []

    // Helper: ISO date from DD/MM/YYYY or DD-MM-YYYY
    const toISODate = (dateStr) => {
      const [day, month, year] = dateStr.includes('/') ? dateStr.split('/') : dateStr.split('-')
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }

    // Helper: dedup check between Pattern 1/2 and Pattern 3.
    // We KEY on date + abs(amount) + vendor-prefix. The amount key is critical:
    // two legitimate transactions on the same day with the same vendor (e.g.
    // two Wolt Greece orders on 19/03) MUST NOT be deduped — they have
    // different amounts. Without the amount in the key, the second would be
    // silently dropped.
    const alreadyCaptured = (date, vendor, amount) => {
      const prefix = vendor.trim().toLowerCase().substring(0, 15)
      const targetAmount = Math.abs(amount).toFixed(2)
      return transactions.some(t =>
        t.date === date &&
        Math.abs(t.amount).toFixed(2) === targetAmount &&
        t.vendor.toLowerCase().startsWith(prefix)
      )
    }

    // Helper: keyword-based direction detection. OCR frequently drops minus
    // signs and there's no reliable visual cue (color) in the text — so we
    // look for direction-indicating words in the description.
    //   • "deposit", "refund", "credit", "received", "transfer from" → INCOMING
    //   • everything else → OUTGOING (safer default for card/account flows)
    // User can always flip via Edit Transaction in Bank Parser before
    // finalizing if a row is mis-classified.
    const detectDirection = (vendor) => {
      const v = vendor.toLowerCase()
      const incomingMarkers = /\b(deposit|refund|received|credit\s|transfer from|incoming|payment in)\b/i
      return incomingMarkers.test(v) ? 'credit' : 'debit'
    }

    // ---------- Pattern 1 & 2: European decimal format (preferred) ----------
    // DD/MM/YYYY or DD-MM-YYYY + description + amount like 8.000,00 or -35,45.
    // Used when OCR preserves the comma decimal.
    const decimalPatterns = [
      /(\d{1,2}\/\d{1,2}\/\d{4})\s+(.+?)\s+([-]?[\d.]+,\d{2})/gi,
      /(\d{2}-\d{2}-\d{4})\s+(.+?)\s+([-]?[\d.]+,\d{2})/gi,
    ]
    for (const pattern of decimalPatterns) {
      let match
      while ((match = pattern.exec(text)) !== null) {
        const [, dateStr, vendor, amountStr] = match
        if (!vendor || vendor.trim().length === 0) continue
        const parsedAmount = parseFloat(amountStr.replace(/\./g, '').replace(',', '.'))
        const isoDate = toISODate(dateStr)
        if (alreadyCaptured(isoDate, vendor, parsedAmount)) continue
        // Apply keyword-based direction (overrides OCR'd sign which is often
        // dropped). If the keyword detection says outgoing but the OCR'd sign
        // was already negative, both agree — leave it. If they disagree,
        // trust the keyword.
        const dir = detectDirection(vendor)
        const signedAmount = dir === 'credit'
          ? Math.abs(parsedAmount)
          : -Math.abs(parsedAmount)
        transactions.push({
          date: isoDate,
          vendor: vendor.trim(),
          amount: signedAmount,
          currency: 'EUR',
          type: dir,
          status: 'pending',
        })
      }
    }

    // ---------- Pattern 3: decimal-stripped fallback ----------
    // When OCR drops the comma decimal (and often the negative sign), each
    // row in the source statement comes out like:
    //   11/03/2026 GT GET TAXI SYSTEMS LT TEL AVIV-JAF ISR 125.60... N/A 3545
    //                                                                ↑
    //                                       trailing integer = amount × 100
    // We rely on the "N/A" reference-number column as an anchor: any integer
    // right after "N/A" is the amount with the last 2 digits being cents.
    //
    // The negative lookahead (?!,\d) prevents this pattern from grabbing the
    // INTEGER PART of a comma-decimal amount. E.g. for "N/A 101,80" we do NOT
    // want to match "101" and treat it as 1.01 cents — Pattern 1 already
    // captured the full 101,80 → 101.80 from that same line. Without this
    // guard, Pattern 3 produces a phantom €1.01 row alongside the real €101.80.
    //
    // Direction comes from the keyword detector — "Cash deposit" lines come
    // out as credit (incoming), everything else defaults to debit.
    const integerAmountPattern = /(\d{1,2}\/\d{1,2}\/\d{4})\s+(.+?)\s+N\/A\s+(\d+)(?!,\d)\b/gi
    let m3
    while ((m3 = integerAmountPattern.exec(text)) !== null) {
      const [, dateStr, vendor, intStr] = m3
      if (!vendor || vendor.trim().length === 0) continue
      const intNum = parseInt(intStr, 10)
      if (Number.isNaN(intNum)) continue
      const absAmount = intNum / 100
      const isoDate = toISODate(dateStr)
      if (alreadyCaptured(isoDate, vendor, absAmount)) continue
      const dir = detectDirection(vendor)
      const signedAmount = dir === 'credit' ? absAmount : -absAmount
      transactions.push({
        date: isoDate,
        vendor: vendor.trim(),
        amount: signedAmount,
        currency: 'EUR',
        type: dir,
        status: 'pending',
      })
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
          const { accountNumber, accountType, company: detectedCompany } = extractAccountNumber(text)

          // DEBUG: always dump the raw OCR'd text + extracted transaction list +
          // partial date/amount matches. Lets us spot missing rows (e.g. when
          // Tesseract drops a transaction line entirely or in a format the regex
          // doesn't catch) without re-instrumenting the code.
          console.warn(`📋 OCR debug for "${file.name}" — extracted ${transactions.length} transactions.`)
          console.log('--- Raw OCR text ---')
          console.log(text)
          console.log('--- Extracted transactions ---')
          console.table(transactions.map(t => ({ date: t.date, vendor: t.vendor?.substring(0, 40), amount: t.amount })))
          const dateMatches = text.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/g) || []
          const amountEU    = text.match(/[-]?[\d.]+,\d{2}/g) || []
          const amountUS    = text.match(/[-]?[\d,]+\.\d{2}/g) || []
          console.warn(`Dates in text: ${dateMatches.length}`, dateMatches.slice(0, 12))
          console.warn(`Euro-format amounts (1.234,56) in text: ${amountEU.length}`, amountEU.slice(0, 12))
          console.warn(`US-format amounts (1,234.56) in text: ${amountUS.length}`, amountUS.slice(0, 12))

          if (!accountNumber) {
            throw new Error('Could not identify account number in statement. Ensure this is a valid Rabona Holdings or Espargos bank statement.')
          }

          // Warn (but don't block) if the detected statement company doesn't match
          // the currently-selected company in the top bar. This catches the common
          // mistake of uploading an Espargos statement while viewing Rabona (or vice versa).
          if (detectedCompany && selectedCompany && detectedCompany !== selectedCompany) {
            throw new Error(
              `This appears to be a ${detectedCompany} statement, but you have "${selectedCompany}" selected at the top. ` +
              `Switch the company selector to ${detectedCompany} and re-upload.`
            )
          }

          resolve({
            file: file.name,
            text: text,
            transactions: transactions,
            accountNumber: accountNumber,
            accountType: accountType,
            company: detectedCompany,
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

          // === LAYER 0: FILENAME-BASED MONTH/YEAR CHECK (pre-OCR, fast) ===
          // Hard block: the filename's month + year MUST match the top-bar selector.
          // This prevents the confusing case where you upload "Espargos January 2026.png"
          // while the top bar is on May 2026 — the data would land correctly (Jan dates)
          // but be invisible until you switch the selector to January. Force the match
          // up front so what you upload is what you see.
          const filenameMonthYear = extractMonthFromFilename(file.name)
          if (filenameMonthYear) {
            if (filenameMonthYear.month !== selectedMonth || filenameMonthYear.year !== selectedYear) {
              const selectedMonthName = MONTH_NAMES[selectedMonth - 1]
              uploadErrors.push(
                `❌ ${file.name} — Filename indicates ${filenameMonthYear.name.charAt(0).toUpperCase() + filenameMonthYear.name.slice(1)} ${filenameMonthYear.year}, ` +
                `but the top-bar selector is set to ${selectedMonthName} ${selectedYear}. ` +
                `Switch the Month/Year selector to ${filenameMonthYear.name.charAt(0).toUpperCase() + filenameMonthYear.name.slice(1)} ${filenameMonthYear.year} and re-upload.`
              )
              continue
            }
          }
          // If filename has no month/year (e.g. a screenshot like "Screenshot 2026-01-15.png"),
          // we fall through. The post-OCR date-validation step still verifies that
          // transaction dates match the filename month — and if the filename has no month,
          // dates are validated against the OCR'd contents only.

          // === LAYER 1: FILENAME-BASED COMPANY CHECK (pre-OCR, fast) ===
          // Reject the file before running expensive OCR if the filename clearly
          // indicates the wrong company. (Layer 2 — the account-number check
          // inside processImageWithOCR — runs after OCR as authoritative confirmation.)
          const filenameCompany = detectCompanyFromFilename(file.name)
          if (filenameCompany && filenameCompany !== selectedCompany) {
            uploadErrors.push(
              `❌ ${file.name} — Filename indicates a ${filenameCompany} statement, ` +
              `but you have "${selectedCompany}" selected at the top. ` +
              `Switch the company selector to ${filenameCompany} and re-upload.`
            )
            continue
          }

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
      // Clear the pending-upload buffer — the file is in the system now, and the
      // "Uploaded Files" section below shows what was just imported. Keeping the
      // file listed here was confusing (looked like it was waiting to upload).
      setFiles([])

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
