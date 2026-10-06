import { useEffect, useLayoutEffect, useRef, useState } from 'react'

type Props = {
  x: number
  y: number
  label: string
  onSubmit: (value: number) => void
  onClose: () => void
  /** Lets the input accept a negative value (e.g. a counter delta that removes counters).
   *  Off by default, matching cascade's mana-value use (never negative). */
  allowNegative?: boolean
}

/** Floating numeric input, positioned like CardContextMenu, for prompts (e.g. cascade's X, or a
 *  bulk counter delta) where the value can be anything rather than a short fixed list of choices. */
function NumberInputPrompt({ x, y, label, onSubmit, onClose, allowNegative }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [value, setValue] = useState('')

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const rect = box.getBoundingClientRect()
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)),
    })
  }, [x, y])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    function dismissIfOutside(event: Event) {
      if (boxRef.current?.contains(event.target as Node)) return
      onClose()
    }
    const id = requestAnimationFrame(() => {
      window.addEventListener('pointerdown', dismissIfOutside)
      window.addEventListener('contextmenu', dismissIfOutside)
    })
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('pointerdown', dismissIfOutside)
      window.removeEventListener('contextmenu', dismissIfOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  function submit() {
    // An empty box is not zero. Number('') is 0, so pressing Enter on a blank Cascade prompt
    // "cascaded for 0", which matches nothing and laid the entire library out in order. Whole
    // numbers only, too: Enter calls this directly, past the input's own step validation.
    if (value.trim() === '') return
    const parsed = Number(value)
    if (!Number.isInteger(parsed)) return
    if (!allowNegative && parsed < 0) return
    onSubmit(parsed)
    onClose()
  }

  return (
    <div ref={boxRef} className="card-context-menu number-input-prompt" style={{ left: pos.x, top: pos.y }}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <input
          ref={inputRef}
          type="number"
          min={allowNegative ? undefined : 0}
          step={1}
          inputMode="numeric"
          aria-label={label}
          placeholder={label}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
        <button type="submit">Go</button>
      </form>
    </div>
  )
}

export default NumberInputPrompt
