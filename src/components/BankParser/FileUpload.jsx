import { useState } from 'react'
import { supabase } from '../../supabaseClient'
import './BankParser.css'

export function FileUpload({ selectedCompany, onUploadSuccess }) {
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

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
    // Filter valid file types
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

  const handleUpload = async () => {
    if (files.length === 0) {
      setError('Please select at least one file')
      return
    }

    try {
      setUploading(true)
      setError(null)

      // Get company_id
      const { data: company } = await supabase
        .from('companies')
        .select('id')
        .eq('name', selectedCompany)
        .single()

      if (!company) throw new Error('Company not found')

      // Get first account (Current Account) for the company
      const { data: account } = await supabase
        .from('accounts')
        .select('id')
        .eq('company_id', company.id)
        .eq('name', 'Current Account')
        .single()

      if (!account) throw new Error('Account not found')

      // Create bank import record
      const { data: bankImport, error: importError } = await supabase
        .from('bank_imports')
        .insert({
          company_id: company.id,
          account_id: account.id,
          import_date: new Date().toISOString().split('T')[0],
          file_name: files.map(f => f.name).join(', '),
          file_type: 'mixed',
          transaction_count: files.length,
          status: 'processing'
        })
        .select()
        .single()

      if (importError) throw importError

      setSuccess(`Files uploaded successfully! Processing ${files.length} file(s)...`)
      setFiles([])

      // Trigger callback to refresh
      if (onUploadSuccess) {
        onUploadSuccess(bankImport.id)
      }

      setTimeout(() => setSuccess(null), 5000)
    } catch (err) {
      console.error('Upload error:', err)
      setError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="file-upload-section">
      <h3>Upload Bank Statements</h3>

      {error && <div className="message error">{error}</div>}
      {success && <div className="message success">{success}</div>}

      <div
        className="upload-area"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="upload-content">
          <p>Drag & drop bank statements here or click to select</p>
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
                <span>📎 {file.name}</span>
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
          >
            {uploading ? 'Uploading...' : 'Upload Files'}
          </button>
        </div>
      )}
    </div>
  )
}
