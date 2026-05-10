import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'

export function UploadedFiles({ bankImportId, selectedCompany, onRefresh }) {
  const [imports, setImports] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!selectedCompany) return
    loadImports()
  }, [selectedCompany, bankImportId, onRefresh])

  const loadImports = async () => {
    try {
      setLoading(true)

      // Get company
      const { data: company } = await supabase
        .from('companies')
        .select('id')
        .eq('name', selectedCompany)
        .single()

      if (!company) return

      // Get all imports for this company
      const { data: importsData, error } = await supabase
        .from('bank_imports')
        .select('*')
        .eq('company_id', company.id)
        .order('created_at', { ascending: false })

      if (error) throw error

      setImports(importsData || [])
    } catch (err) {
      console.error('Failed to load imports:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (importId) => {
    if (!window.confirm('Delete this import and all its transactions?')) return

    try {
      // Delete transactions first
      await supabase
        .from('bank_transactions')
        .delete()
        .eq('bank_import_id', importId)

      // Delete import
      const { error } = await supabase
        .from('bank_imports')
        .delete()
        .eq('id', importId)

      if (error) throw error

      setImports(prev => prev.filter(i => i.id !== importId))

      // Trigger refresh in parent component
      if (onRefresh) onRefresh()
    } catch (err) {
      console.error('Failed to delete import:', err)
      alert('Failed to delete import')
    }
  }

  if (loading) {
    return <div className="uploaded-files-section loading">Loading imports...</div>
  }

  return (
    <div className="uploaded-files-section">
      <h3>📁 Uploaded Files (Newest First)</h3>

      {imports.length === 0 ? (
        <div className="empty-state">No files imported yet</div>
      ) : (
        <div className="files-table">
          <table>
            <thead>
              <tr>
                <th>Icon</th>
                <th>File Name</th>
                <th>Upload Date</th>
                <th>Transactions</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {imports.map(imp => (
                <tr key={imp.id}>
                  <td className="icon">📄</td>
                  <td className="file-name">{imp.file_name}</td>
                  <td className="date">
                    {new Date(imp.import_date).toLocaleDateString()}
                  </td>
                  <td className="transactions">{imp.transaction_count}</td>
                  <td className="status">
                    <span className={`status-badge ${imp.status}`}>
                      {imp.status === 'completed' ? '✓' : '⏳'} {imp.status}
                    </span>
                  </td>
                  <td className="action">
                    <button
                      onClick={() => handleDelete(imp.id)}
                      className="btn-delete"
                      title="Delete this import"
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
