/**
 * Espargos company logo — loads the JPG asset from src/assets/espargos-logo.jpg.
 *
 * Mirrors the RabonaLogo API:
 *   <EspargosLogo height={100} className="espargos-logo" />
 *
 * Note: this is a bitmap (JPG) rather than inline SVG. It looks great at the
 * letterhead size we use (80–100px). If/when an SVG version becomes available,
 * swap the import and the <img> for inline <svg> like RabonaLogo.
 */
import logoUrl from './espargos-logo.jpg'

export function EspargosLogo({ height = 60, className = '', ...rest }) {
  return (
    <img
      src={logoUrl}
      alt="Espargos"
      style={{ height, width: 'auto', display: 'block', ...(rest.style || {}) }}
      className={`espargos-logo-img ${className}`}
      {...rest}
    />
  )
}
