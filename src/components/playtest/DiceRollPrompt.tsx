import { useEffect, useLayoutEffect, useRef, useState } from 'react'

type Props = {
  x: number
  y: number
  sizes: readonly number[]
  /** Pre-selected die size — the one a plain "Roll Die" click should already be pointing at. */
  defaultSides: number
  onRoll: (sides: number, count: number) => void
  onClose: () => void
}

/** Hard cap on a single roll: enough for any real Magic effect, low enough that the roll log
 *  entry stays readable and nobody can paste in a number that locks up the renderer. */
const MAX_DICE = 100

/**
 * Dice roller: pick a size, pick how many, roll them all at once.
 *
 * Replaces a plain list of die sizes that rolled exactly one die per click — fine for the usual
 * single d20, miserable for "roll eleven d6" (eleven clicks, eleven separate log entries, and
 * you add them up yourself). Size and count live in one small panel so the common single roll is
 * still one click on the die you want, while any count is one number away.
 *
 * Positioning/dismissal deliberately mirrors NumberInputPrompt (which mirrors CardContextMenu):
 * clamped into the viewport after measuring, closes on Escape or a click outside.
 */
function DiceRollPrompt({ x, y, sizes, defaultSides, onRoll, onClose }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [sides, setSides] = useState(defaultSides)
  const [count, setCount] = useState('1')

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

  // Clamped rather than rejected: a blank or nonsense box still rolls one die instead of doing
  // nothing at all, which is the friendlier failure for a button you clicked on purpose.
  const parsed = Math.floor(Number(count))
  const rollCount = Number.isFinite(parsed) ? Math.min(MAX_DICE, Math.max(1, parsed)) : 1

  function submit() {
    onRoll(sides, rollCount)
    onClose()
  }

  return (
    <div ref={boxRef} className="card-context-menu dice-prompt" style={{ left: pos.x, top: pos.y }}>
      <div className="dice-prompt__sizes">
        {sizes.map((s) => (
          <button
            key={s}
            type="button"
            className={`dice-prompt__size ${s === sides ? 'is-selected' : ''}`}
            onClick={() => setSides(s)}
            aria-pressed={s === sides}
          >
            d{s}
          </button>
        ))}
      </div>
      <form
        className="dice-prompt__row"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <label className="dice-prompt__count">
          <span>How many</span>
          <input
            type="number"
            min={1}
            max={MAX_DICE}
            step={1}
            inputMode="numeric"
            value={count}
            onChange={(event) => setCount(event.target.value)}
            // Select-on-focus so typing "11" replaces the default instead of making it "111".
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        <button type="submit" className="dice-prompt__roll">
          Roll {rollCount}d{sides}
        </button>
      </form>
    </div>
  )
}

export default DiceRollPrompt
