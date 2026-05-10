export function BankParserStats({ stats = {} }) {
  const {
    totalTransactions = 0,
    editedCount = 0,
    finalizedCount = 0
  } = stats

  const finalizationPercentage = totalTransactions > 0
    ? Math.round((finalizedCount / totalTransactions) * 100)
    : 0

  return (
    <div className="bank-parser-stats">
      <div className="stat-card total">
        <div className="stat-label">Total Bank Transactions</div>
        <div className="stat-value">{totalTransactions}</div>
      </div>

      <div className="stat-card edited">
        <div className="stat-label">Edited</div>
        <div className="stat-value">{editedCount}</div>
      </div>

      <div className="stat-card finalized">
        <div className="stat-label">Finalized</div>
        <div className="stat-value">{finalizedCount}</div>
      </div>

      <div className="stat-card finalization-status">
        <div className="stat-label">Finalization Status</div>
        <div className="stat-value warning">⚠️ {finalizationPercentage}%</div>
      </div>
    </div>
  )
}
