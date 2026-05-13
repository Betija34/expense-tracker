import { RabonaLogo } from '../../assets/RabonaLogo'
import { EspargosLogo } from '../../assets/EspargosLogo'
import './PrintLetterhead.css'

/**
 * PrintLetterhead — shared letterhead block for ALL report tabs (Client Report,
 * Travel Log, Shareholder Report, Dashboard, View Expenses).
 *
 * Visible on screen AND in print. Universal layout rule:
 *   - Text (company name / report title / period) on the LEFT
 *   - Logo on the RIGHT
 *
 * Layout:
 *   ┌──────────────────────────────────────────┐
 *   │  Company name                            │
 *   │  Report title                  [ LOGO ]  │
 *   │  Period                                  │
 *   ├──────────────────────────────────────────┤
 *
 * Props:
 *   companyName  — currently selected company ("Rabona Holdings" or "Espargos")
 *   reportTitle  — short title for the report (e.g. "Client Report")
 *   periodLabel  — period descriptor (e.g. "Period: 01/2026")
 */
export function PrintLetterhead({ companyName, reportTitle, periodLabel }) {
  const isEspargos = companyName === 'Espargos'
  return (
    <div className="print-letterhead">
      <div className="print-letterhead-logo">
        {isEspargos ? (
          <EspargosLogo height={100} className="espargos-logo" />
        ) : (
          <RabonaLogo height={100} className="rabona-logo" />
        )}
      </div>
      <div className="print-letterhead-meta">
        <div className="company-name">{companyName}</div>
        {reportTitle && <div className="report-title">{reportTitle}</div>}
        {periodLabel && <div className="period-label">{periodLabel}</div>}
      </div>
    </div>
  )
}
