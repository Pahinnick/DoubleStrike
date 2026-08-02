import { computeDeckLegality, type DeckCardRef } from '../../engine/legality'
import type { CardSnapshot } from '../../storage/cardCache'
import { useJumpToCardContext } from '../../state/JumpToCardContext'
import type { Format } from '../../utils/scryfallQuery'

type Props = {
  cards: DeckCardRef[]
  snapshots: Map<string, CardSnapshot>
  format: Format | undefined
}

function LegalityBanner({ cards, snapshots, format }: Props) {
  const { jumpToCard } = useJumpToCardContext()
  if (!format) return null

  const { isLegal, issues } = computeDeckLegality(cards, snapshots, format)

  return (
    <div className={`legality-banner ${isLegal ? 'is-legal' : 'is-illegal'}`}>
      <span>{isLegal ? `Legal in ${format}` : `${issues.length} issue${issues.length > 1 ? 's' : ''} in ${format}`}</span>
      {!isLegal && (
        <ul>
          {issues.map((issue) => {
            // Deck-wide issues (no commander, wrong deck size) use synthetic ids and
            // aren't tied to a card that exists in the list, so they stay plain text.
            const isCardIssue = snapshots.has(issue.scryfallId)
            return (
              <li key={`${issue.scryfallId}-${issue.reason}`}>
                {isCardIssue ? (
                  <button type="button" className="legality-banner__issue" onClick={() => jumpToCard(issue.scryfallId)}>
                    {issue.name} — {issue.reason}
                  </button>
                ) : (
                  <>
                    {issue.name} — {issue.reason}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default LegalityBanner
