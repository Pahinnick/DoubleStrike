import type { CSSProperties } from 'react'
import type { FoilKind } from '../../state/types'
import { isKnownFoil } from '../../utils/foil'
import './foilShine.css'

type Props = {
  foil: FoilKind
  /** Cursor position as a 0–1 ratio across the card art — see hooks/useHoverPreview's `foilPoint`.
   *  Drives the shine's origin so it tracks the cursor like light off a real foil card. Ignored
   *  (animates on its own) when `preview` is set. */
  point?: { x: number; y: number }
  /** Picker-swatch mode (SimilarCardsView's Foil row): nothing to hover, so the shine auto-sweeps
   *  via CSS animation instead of tracking a cursor point. */
  preview?: boolean
}

/** Purely presentational holographic overlay. Absolutely fills its parent, which must establish a
 *  positioning context (and ideally overflow:hidden + matching border-radius so the shine clips to
 *  the card) — every render site already has this from its own layout, so this component adds
 *  nothing beyond the gradient itself. pointer-events:none keeps it from stealing drag/click/hover. */
function FoilShine({ foil, point, preview }: Props) {
  // A deck saved with a since-retired style would otherwise render an overlay with no gradient
  // behind it — invisible, but still a live blend/mask layer over the art.
  if (!isKnownFoil(foil)) return null
  const style = point ? ({ '--foil-x': point.x * 100, '--foil-y': point.y * 100 } as CSSProperties) : undefined
  return <div className={`foil-shine foil-shine--${foil} ${preview ? 'foil-shine--preview' : ''}`} style={style} aria-hidden="true" />
}

export default FoilShine
