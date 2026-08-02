import { CARD_SIZES, type CardSizeKey } from '../../utils/cardSize'
import './cardSizeToggle.css'

const LABELS: Record<CardSizeKey, string> = { small: 'S', medium: 'M', large: 'L' }

type Props = {
  value: CardSizeKey
  onChange: (size: CardSizeKey) => void
}

function CardSizeToggle({ value, onChange }: Props) {
  return (
    <div className="card-size-toggle" role="group" aria-label="Card size">
      {(Object.keys(CARD_SIZES) as CardSizeKey[]).map((key) => (
        <button
          key={key}
          type="button"
          className={value === key ? 'is-active' : ''}
          aria-pressed={value === key}
          title={`${key[0].toUpperCase()}${key.slice(1)} cards`}
          onClick={() => onChange(key)}
        >
          {LABELS[key]}
        </button>
      ))}
    </div>
  )
}

export default CardSizeToggle
