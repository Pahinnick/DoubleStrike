import { useState } from 'react'
import { fetchArchidektDeckJson } from '../../api/archidekt'
import { getCardsByIdentifiers, getDisplayImage, searchCards } from '../../api/scryfall'
import type { CardIdentifier, ScryfallCard } from '../../api/scryfallTypes'
import { TOKEN_CARDS_LABEL } from '../../engine/deckGrouping'
import { matchParsedCards, parseArchidektDeckId, parseArchidektDeckJson, parseArchidektExport, type ParsedDeckCard } from '../../engine/deckImport'
import { collectDeckTokens } from '../../engine/deckTokens'
import { useDeck } from '../../state/DeckContext'
import { useDeckList } from '../../state/DeckListContext'
import { saveSnapshots, toSnapshot } from '../../storage/cardCache'
import { getCardImageUrl } from '../../utils/cardSize'
import { FORMATS, type Format } from '../../utils/scryfallQuery'
import './importDeck.css'

type Props = {
  onClose: () => void
}

type Status = 'idle' | 'importing' | 'error'

/** Suggested replacements for one unresolved card name — fetched lazily (only once its entry is
 *  selected in the left-hand list) and cached by lowercased name so re-selecting it, or another
 *  entry sharing the same misspelled name, doesn't re-query. */
type SuggestionState = 'loading' | 'error' | ScryfallCard[]

const DEFAULT_DECK_NAME = 'Imported Deck'
const SUGGESTION_LIMIT = 8

function ImportDeckModal({ onClose }: Props) {
  const { dispatch } = useDeck()
  const { createDeck } = useDeckList()
  const [deckName, setDeckName] = useState(DEFAULT_DECK_NAME)
  const [format, setFormat] = useState<Format | ''>('commander')
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [unresolved, setUnresolved] = useState<ParsedDeckCard[]>([])
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [suggestionsByName, setSuggestionsByName] = useState<Record<string, SuggestionState>>({})

  async function loadSuggestions(name: string) {
    const key = name.toLowerCase()
    if (suggestionsByName[key] !== undefined) return
    setSuggestionsByName((prev) => ({ ...prev, [key]: 'loading' }))
    try {
      const result = await searchCards(name)
      setSuggestionsByName((prev) => ({ ...prev, [key]: result.data.slice(0, SUGGESTION_LIMIT) }))
    } catch {
      setSuggestionsByName((prev) => ({ ...prev, [key]: 'error' }))
    }
  }

  function selectUnresolved(index: number) {
    setActiveIndex(index)
    void loadSuggestions(unresolved[index].name)
  }

  /** User picked a suggested printing for a card that failed to resolve on its own — applies the
   *  exact same dispatch sequence a normally-matched import card gets (quantity/category/board/
   *  commander), then drops the entry from the unresolved list. */
  async function acceptSuggestion(entry: ParsedDeckCard, card: ScryfallCard) {
    const board = entry.isMaybeboard ? 'sideboard' : 'mainboard'
    if (entry.category) dispatch({ type: 'ADD_CATEGORY', name: entry.category })
    dispatch({ type: 'ADD_CARD', scryfallId: card.id, board })
    if (entry.quantity > 1) dispatch({ type: 'SET_QUANTITY', scryfallId: card.id, board, quantity: entry.quantity })
    if (entry.category) dispatch({ type: 'SET_CARD_CATEGORY', scryfallId: card.id, board, category: entry.category })
    if (entry.isCommander) dispatch({ type: 'SET_COMMANDER', scryfallId: card.id, board, isCommander: true })
    await saveSnapshots([card])

    setUnresolved((prev) => prev.filter((u) => u !== entry))
    setActiveIndex(null)
  }

  /** Resolves parsed cards against Scryfall, creates the deck, and dispatches the contents.
   *  Shared by both the link and paste import paths. `sourceName` is the deck's name from its
   *  source (e.g. Archidekt), used only when the user hasn't typed their own. */
  async function importParsed(parsed: ParsedDeckCard[], sourceName?: string) {
    if (parsed.length === 0) {
      setError("Couldn't find any cards to import — check the link or list and try again.")
      setStatus('error')
      return
    }

    setStatus('importing')
    setUnresolved([])
    setActiveIndex(null)
    setSuggestionsByName({})

    let resolved: ScryfallCard[]
    try {
      const identifiers: CardIdentifier[] = parsed.map((p) => ({ set: p.set, collector_number: p.collectorNumber }))
      resolved = await getCardsByIdentifiers(identifiers)
    } catch {
      setError("Couldn't reach Scryfall to look up the cards — check your connection and try again.")
      setStatus('error')
      return
    }

    // See matchParsedCards' own doc — correlated by (set, collector_number), not by name, so two
    // different printings/arts of the same card each get their own entry instead of colliding.
    const { matches, missing } = matchParsedCards(parsed, resolved)

    const typed = deckName.trim()
    const nameToUse = typed && typed !== DEFAULT_DECK_NAME ? typed : sourceName?.trim() || DEFAULT_DECK_NAME
    await createDeck(nameToUse)
    if (format) dispatch({ type: 'SET_FORMAT', format })

    const categoryNames = new Set<string>()
    for (const { parsed: entry } of matches) {
      if (entry.category) categoryNames.add(entry.category)
    }
    for (const name of categoryNames) dispatch({ type: 'ADD_CATEGORY', name })

    for (const { parsed: entry, card } of matches) {
      const board = entry.isMaybeboard ? 'sideboard' : 'mainboard'
      dispatch({ type: 'ADD_CARD', scryfallId: card.id, board })
      if (entry.quantity > 1) {
        dispatch({ type: 'SET_QUANTITY', scryfallId: card.id, board, quantity: entry.quantity })
      }
      if (entry.category) {
        dispatch({ type: 'SET_CARD_CATEGORY', scryfallId: card.id, board, category: entry.category })
      }
      if (entry.isCommander) {
        dispatch({ type: 'SET_COMMANDER', scryfallId: card.id, board, isCommander: true })
      }
    }

    await saveSnapshots(matches.map((m) => m.card))

    // Best-effort: pull in the tokens the deck's own cards can make, as reference cards in their
    // own pinned-last "Tokens" category. A failure here (e.g. offline) shouldn't undo the import
    // that already succeeded above.
    try {
      const tokens = collectDeckTokens(matches.map((m) => toSnapshot(m.card)))
      if (tokens.length > 0) {
        const tokenCards = await getCardsByIdentifiers(tokens.map((t) => ({ id: t.id })))
        await saveSnapshots(tokenCards)
        dispatch({ type: 'ADD_CATEGORY', name: TOKEN_CARDS_LABEL })
        for (const card of tokenCards) {
          dispatch({ type: 'ADD_CARD', scryfallId: card.id, board: 'mainboard', category: TOKEN_CARDS_LABEL, isToken: true })
        }
      }
    } catch {
      // Ignored — the real decklist already imported fine above.
    }

    setUnresolved(missing)
    setStatus('idle')
    if (missing.length === 0) {
      onClose()
    } else {
      selectUnresolved(0)
    }
  }

  async function handleImport() {
    setError(null)
    if (url.trim()) {
      const deckId = parseArchidektDeckId(url)
      if (!deckId) {
        setError("That doesn't look like an Archidekt deck link.")
        setStatus('error')
        return
      }
      setStatus('importing')
      let json: unknown
      try {
        json = await fetchArchidektDeckJson(deckId)
      } catch (err) {
        setError(err instanceof Error && err.message === 'Link import needs the desktop app'
          ? 'Link import only works in the desktop app — paste the export below instead.'
          : "Couldn't fetch that deck from Archidekt — check the link (and that the deck is public).")
        setStatus('error')
        return
      }
      const { name, cards } = parseArchidektDeckJson(json as Parameters<typeof parseArchidektDeckJson>[0])
      await importParsed(cards, name)
      return
    }
    await importParsed(parseArchidektExport(text))
  }

  const activeEntry = activeIndex !== null ? unresolved[activeIndex] : undefined
  const activeSuggestions = activeEntry ? suggestionsByName[activeEntry.name.toLowerCase()] : undefined

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Import deck" onClick={onClose}>
      <div className={`modal-content import-deck-modal ${unresolved.length > 0 ? 'import-deck-modal--wide' : ''}`} onClick={(event) => event.stopPropagation()}>
        <h2>Import Deck</h2>
        <label className="import-deck-modal__field">
          <span>Deck name</span>
          <input type="text" value={deckName} onChange={(event) => setDeckName(event.target.value)} />
        </label>
        <label className="import-deck-modal__field">
          <span>Format</span>
          <select value={format} onChange={(event) => setFormat(event.target.value as Format | '')}>
            <option value="">No format</option>
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="import-deck-modal__field">
          <span>Archidekt link</span>
          <input
            type="text"
            placeholder="https://archidekt.com/decks/19263728/…"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <div className="import-deck-modal__divider">
          <span>or paste a plain-text export</span>
        </div>
        <textarea
          className="import-deck-modal__textarea"
          placeholder="1x Sol Ring (lea) 1 [Ramp]..."
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={8}
          disabled={url.trim().length > 0}
        />
        {status === 'error' && error && <p className="search-status search-status--error">{error}</p>}
        {unresolved.length > 0 && (
          <div className="import-deck-modal__unresolved">
            <p className="search-status search-status--error">
              Couldn't find {unresolved.length} card{unresolved.length > 1 ? 's' : ''} — the rest of the deck imported fine. Pick a
              replacement below, or just leave them out.
            </p>
            <div className="import-deck-modal__unresolved-split">
              <ul className="import-deck-modal__missing-list">
                {unresolved.map((entry, index) => (
                  <li key={`${entry.name}-${index}`}>
                    <button type="button" className={index === activeIndex ? 'is-active' : ''} onClick={() => selectUnresolved(index)}>
                      {entry.quantity > 1 ? `${entry.quantity}× ` : ''}
                      {entry.name}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="import-deck-modal__suggestions">
                {!activeEntry && <p className="import-deck-modal__suggestions-hint">Select a card on the left to see suggestions.</p>}
                {activeEntry?.sourceLine && (
                  <p className="import-deck-modal__source-line" title="The original line from your pasted export — useful for spotting a typo'd set code or collector number">
                    <code>{activeEntry.sourceLine}</code>
                  </p>
                )}
                {activeEntry && activeSuggestions === 'loading' && (
                  <p className="import-deck-modal__suggestions-hint">Searching Scryfall for "{activeEntry.name}"…</p>
                )}
                {activeEntry && activeSuggestions === 'error' && (
                  <p className="import-deck-modal__suggestions-hint">Couldn't search Scryfall right now — try again in a moment.</p>
                )}
                {activeEntry && Array.isArray(activeSuggestions) && activeSuggestions.length === 0 && (
                  <p className="import-deck-modal__suggestions-hint">No close matches found for "{activeEntry.name}".</p>
                )}
                {activeEntry && Array.isArray(activeSuggestions) && activeSuggestions.length > 0 && (
                  <ul className="import-deck-modal__suggestion-list">
                    {activeSuggestions.map((card) => {
                      const image = getDisplayImage(card)
                      return (
                        <li key={card.id}>
                          <button type="button" onClick={() => acceptSuggestion(activeEntry, card)} title={`Use ${card.name} instead`}>
                            {image ? (
                              <img src={getCardImageUrl(image, 'small')} alt="" draggable={false} />
                            ) : (
                              <span className="import-deck-modal__suggestion-noimage" />
                            )}
                            <span>{card.name}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
        <div className="import-deck-modal__actions">
          <button
            type="button"
            onClick={handleImport}
            disabled={status === 'importing' || (url.trim().length === 0 && text.trim().length === 0)}
          >
            {status === 'importing' ? 'Importing…' : 'Import'}
          </button>
          <button type="button" onClick={onClose}>
            {unresolved.length > 0 ? 'Done' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ImportDeckModal
