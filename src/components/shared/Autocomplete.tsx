import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './autocomplete.css'

type Props = {
  value: string
  onChange: (value: string) => void
  /** Called when a suggestion is picked (click, or Enter/Tab on the highlighted one). */
  onCommit: (value: string) => void
  /** Called on Enter when nothing is highlighted (no suggestions, or the list hasn't loaded yet)
   *  — lets a caller like the type-line multi-select accept a word its catalog doesn't know
   *  about instead of silently swallowing the keystroke. Omit to make Enter a no-op in that case. */
  onEnterFreeform?: (value: string) => void
  suggestions: string[]
  placeholder?: string
  ariaLabel?: string
  className?: string
  id?: string
  tutorialId?: string
}

/** Text input with a floating suggestion dropdown — portaled to document.body (same reasoning as
 *  CardContextMenu: the search pane scrolls via overflow-y:auto, which would clip an
 *  absolutely-positioned dropdown anchored inside it) and repositioned on scroll/resize while open.
 *  Deliberately dumb about *what* the suggestions mean — the caller owns fetching/filtering them
 *  and deciding what a commit does (replace the field, add a chip, etc.). */
function Autocomplete({
  value,
  onChange,
  onCommit,
  onEnterFreeform,
  suggestions,
  placeholder,
  ariaLabel,
  className,
  id,
  tutorialId,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null)

  const show = open && suggestions.length > 0

  useLayoutEffect(() => {
    if (!show || !inputRef.current) return
    const update = () => {
      const r = inputRef.current!.getBoundingClientRect()
      setRect({ left: r.left, top: r.bottom + 4, width: r.width })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [show])

  useEffect(() => {
    setHighlight(0)
  }, [suggestions])

  function commit(picked: string) {
    onCommit(picked)
    setOpen(false)
  }

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        data-tutorial-id={tutorialId}
        type="text"
        role="combobox"
        aria-expanded={show}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        // Deferred so a suggestion's onClick (which fires after blur) still lands before the
        // dropdown unmounts — mirrors CardContextMenu's outside-click handling.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && show) {
            event.preventDefault()
            setHighlight((h) => Math.min(h + 1, suggestions.length - 1))
          } else if (event.key === 'ArrowUp' && show) {
            event.preventDefault()
            setHighlight((h) => Math.max(h - 1, 0))
          } else if (event.key === 'Enter') {
            if (show && suggestions[highlight] !== undefined) {
              event.preventDefault()
              commit(suggestions[highlight])
            } else if (onEnterFreeform && value.trim().length > 0) {
              event.preventDefault()
              onEnterFreeform(value.trim())
              setOpen(false)
            }
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {show &&
        rect &&
        createPortal(
          <div className="autocomplete-menu" role="listbox" style={{ left: rect.left, top: rect.top, width: rect.width }}>
            {suggestions.map((suggestion, index) => (
              <button
                type="button"
                key={suggestion}
                role="option"
                aria-selected={index === highlight}
                className={`autocomplete-menu__item ${index === highlight ? 'is-highlighted' : ''}`}
                onMouseEnter={() => setHighlight(index)}
                // Prevents the input's blur (which would close the menu first) from beating this click.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

export default Autocomplete
