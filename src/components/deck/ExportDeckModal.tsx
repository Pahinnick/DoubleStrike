import { useEffect, useMemo, useState } from 'react'
import { getCardsByIdentifiers } from '../../api/scryfall'
import type { ScryfallCard } from '../../api/scryfallTypes'
import { EXPORT_FORMATS, formatDeckExport, type ExportFormat } from '../../engine/deckExport'
import { useDeck } from '../../state/DeckContext'
import './exportDeck.css'

type Props = {
  onClose: () => void
}

type Status = 'loading' | 'ready' | 'error'

function ExportDeckModal({ onClose }: Props) {
  const { deck } = useDeck()
  const [cardsById, setCardsById] = useState<Map<string, ScryfallCard>>(new Map())
  const [status, setStatus] = useState<Status>('loading')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [format, setFormat] = useState<ExportFormat>('archidekt')

  const uniqueIds = useMemo(() => [...new Set(deck.cards.map((c) => c.scryfallId))], [deck.cards])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    // Fetched fresh (rather than read from the CardSnapshot cache) so the export always has
    // set/collector number even for cards cached before those fields were tracked here —
    // already-cached cards are served locally by getCardsByIdentifiers without a network call.
    getCardsByIdentifiers(uniqueIds.map((id) => ({ id })))
      .then((cards) => {
        if (cancelled) return
        setCardsById(new Map(cards.map((card) => [card.id, card])))
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
    // Runs once on open; uniqueIds is derived from the deck at mount time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const text = useMemo(() => formatDeckExport(format, deck.cards, cardsById), [format, deck.cards, cardsById])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopyState('copied')
    } catch {
      // Clipboard permission can be denied by the browser/OS — the textarea itself is still
      // selectable, so fall back to pointing the user at manual copy instead of doing nothing.
      setCopyState('failed')
    }
    setTimeout(() => setCopyState('idle'), 1500)
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Export deck" onClick={onClose}>
      <div className="modal-content export-deck-modal" onClick={(event) => event.stopPropagation()}>
        <h2>Export Deck</h2>
        <label className="export-deck-modal__field">
          <span>Format</span>
          <select value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)}>
            {EXPORT_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <p className="search-status">
          {format === 'archidekt'
            ? "Plain-text decklist, compatible with Archidekt's import format."
            : 'Mainboard only — sideboard/maybeboard cards are left out since this format has no way to mark them excluded.'}
        </p>
        {status === 'loading' && <p className="search-status">Resolving cards…</p>}
        {status === 'error' && <p className="search-status search-status--error">Couldn't resolve cards — check your connection.</p>}
        {copyState === 'failed' && (
          <p className="search-status search-status--error">Couldn't access the clipboard — select the text above and copy it manually.</p>
        )}
        <textarea className="export-deck-modal__textarea" readOnly value={text} rows={10} onFocus={(event) => event.target.select()} />
        <div className="export-deck-modal__actions">
          <button type="button" onClick={handleCopy} disabled={status !== 'ready' || text.length === 0}>
            {copyState === 'copied' ? 'Copied!' : 'Copy to Clipboard'}
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default ExportDeckModal
