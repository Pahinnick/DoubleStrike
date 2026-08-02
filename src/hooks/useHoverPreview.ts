import { useCallback, useState } from 'react'
import type { TaggableCard } from '../api/scryfallTypes'
import { useHoverPreviewContext, type HoverCounters } from '../components/shared/HoverPreviewContext'
import type { FoilKind } from '../state/types'

type PointerTarget = { clientX: number; clientY: number; currentTarget: Element }
type FocusTarget = { currentTarget: Element }

const CENTER = { x: 0.5, y: 0.5 }

/** Spread the returned handlers (element 0 of the tuple) onto any card thumbnail to drive the
 *  single shared preview portal. `face` lets a caller that's flipped a double-faced card (playtest
 *  battlefield) preview the matching side instead of always the front. `counters` (playtest
 *  battlefield only) shows the card's live counter totals on the large preview too. `foil`, when
 *  the card has a shader set, makes this hook also track the cursor's 0–1 ratio across the hovered
 *  element (element 1 of the tuple, for the caller's own small-card FoilShine) and forwards both
 *  into the shared hover state so the enlarged preview can render a matching shine.
 *
 *  Returns a tuple rather than one flat object specifically so `foilPoint` (a plain data value)
 *  can never get spread onto a DOM element alongside the handlers — every call site does
 *  `{...hoverHandlers}` on a real element, and a `foilPoint` prop there would render as an invalid
 *  DOM attribute. */
export function useHoverPreview(
  card: TaggableCard,
  face: 'front' | 'back' = 'front',
  counters?: HoverCounters,
  foil?: FoilKind,
): [
  { onMouseEnter: (event: PointerTarget) => void; onMouseMove: (event: PointerTarget) => void; onMouseLeave: () => void; onFocus: (event: FocusTarget) => void; onBlur: () => void },
  { x: number; y: number },
] {
  const { setHover } = useHoverPreviewContext()
  const [foilPoint, setFoilPoint] = useState(CENTER)

  const showAtCursor = useCallback(
    (event: PointerTarget) => {
      if (foil) {
        const rect = event.currentTarget.getBoundingClientRect()
        const point = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
        setFoilPoint(point)
        setHover({ card, point: { x: event.clientX, y: event.clientY }, face, counters, foil, foilPoint: point })
        return
      }
      setHover({ card, point: { x: event.clientX, y: event.clientY }, face, counters })
    },
    [card, face, counters, foil, setHover],
  )

  // Keyboard focus has no cursor position, so fall back to the anchor's edge.
  const showAtAnchor = useCallback(
    (event: FocusTarget) => {
      const rect = event.currentTarget.getBoundingClientRect()
      setHover({ card, point: { x: rect.right, y: rect.top }, face, counters, foil, foilPoint: foil ? CENTER : undefined })
    },
    [card, face, counters, foil, setHover],
  )

  const hide = useCallback(() => setHover(null), [setHover])

  return [
    {
      onMouseEnter: showAtCursor,
      onMouseMove: showAtCursor,
      onMouseLeave: hide,
      onFocus: showAtAnchor,
      onBlur: hide,
    },
    foilPoint,
  ]
}
