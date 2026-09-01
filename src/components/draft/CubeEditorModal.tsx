import { useEffect, useState } from 'react'
import { getCardsByIdentifiers, getDisplayImage, searchCards } from '../../api/scryfall'
import type { ScryfallCard } from '../../api/scryfallTypes'
import { parseCubeList, resolveCubeList, type ParsedCubeLine } from '../../draft/cubeImport'
import type { Cube, CubeCard } from '../../draft/types'
import { loadCube, saveCube } from '../../storage/cubeRepository'
import { getCardImageUrl } from '../../utils/cardSize'
import './draft.css'

type Props = {
  profileId: string
  cubeId?: string
  onClose: () => void
}

type Status = 'idle' | 'loading' | 'resolving' | 'error'
type SuggestionState = 'loading' | 'error' | ScryfallCard[]

const SUGGESTION_LIMIT = 8
const DEFAULT_NAME = 'New Cube'

/** Renders a cube's cards back into pasteable "Nx Name" lines — used when reopening an
 *  existing cube for editing, and needs the resolved names, which the stored `Cube` doesn't
 *  keep (only scryfallIds + quantity) — so this is populated after loading via `resolvedNames`. */
function cubeToText(cube: CubeCard[], resolvedNames: Map<string, string>): string {
  return cube
    .map((c) => {
      const name = resolvedNames.get(c.scryfallId) ?? c.scryfallId
      return c.quantity > 1 ? `${c.quantity}x ${name}` : name
    })
    .join('\n')
}

function CubeEditorModal({ profileId, cubeId, onClose }: Props) {
  const [name, setName] = useState(DEFAULT_NAME)
  const [text, setText] = useState('')
  const [status, setStatus] = useState<Status>(cubeId ? 'loading' : 'idle')
  const [error, setError] = useState<string | null>(null)
  const [resolvedCards, setResolvedCards] = useState<CubeCard[]>([])
  const [unresolved, setUnresolved] = useState<ParsedCubeLine[]>([])
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [suggestionsByName, setSuggestionsByName] = useState<Record<string, SuggestionState>>({})

  useEffect(() => {
    if (!cubeId) return
    let cancelled = false
    void loadCube(profileId, cubeId).then(async (cube) => {
      if (cancelled || !cube) return
      setName(cube.name)
      setResolvedCards(cube.cards)
      // Re-resolve by id to recover display names for the textarea — cheap, ids are already known.
      const looked = await getCardsByIdentifiers(cube.cards.map((c) => ({ id: c.scryfallId })))
      if (cancelled) return
      const names = new Map(looked.map((c) => [c.id, c.name]))
      setText(cubeToText(cube.cards, names))
      setStatus('idle')
    })
    return () => {
      cancelled = true
    }
  }, [profileId, cubeId])

  async function loadSuggestions(cardName: string) {
    const key = cardName.toLowerCase()
    if (suggestionsByName[key] !== undefined) return
    setSuggestionsByName((prev) => ({ ...prev, [key]: 'loading' }))
    try {
      const result = await searchCards(cardName)
      setSuggestionsByName((prev) => ({ ...prev, [key]: result.data.slice(0, SUGGESTION_LIMIT) }))
    } catch {
      setSuggestionsByName((prev) => ({ ...prev, [key]: 'error' }))
    }
  }

  function selectUnresolved(index: number) {
    setActiveIndex(index)
    void loadSuggestions(unresolved[index].name)
  }

  function acceptSuggestion(entry: ParsedCubeLine, card: ScryfallCard) {
    setResolvedCards((prev) => [...prev, { scryfallId: card.id, quantity: entry.quantity }])
    setUnresolved((prev) => prev.filter((u) => u !== entry))
    setActiveIndex(null)
  }

  async function handleResolve() {
    if (status === 'resolving') return
    setError(null)
    const lines = parseCubeList(text)
    if (lines.length === 0) {
      setError('Paste at least one card name.')
      return
    }
    setStatus('resolving')
    setUnresolved([])
    setActiveIndex(null)
    try {
      const result = await resolveCubeList(lines)
      setResolvedCards(result.cards)
      setUnresolved(result.missing)
      setStatus('idle')
      if (result.missing.length > 0) selectUnresolved(0)
    } catch {
      setError("Couldn't reach Scryfall to look up these cards — check your connection and try again.")
      setStatus('error')
    }
  }

  async function handleSave() {
    const trimmedName = name.trim() || DEFAULT_NAME
    const now = new Date().toISOString()
    const cube: Cube = {
      id: cubeId ?? crypto.randomUUID(),
      name: trimmedName,
      cards: resolvedCards,
      createdAt: now,
      updatedAt: now,
    }
    await saveCube(profileId, cube)
    onClose()
  }

  const totalCards = resolvedCards.reduce((sum, c) => sum + c.quantity, 0)
  const activeEntry = activeIndex !== null ? unresolved[activeIndex] : undefined
  const activeSuggestions = activeEntry ? suggestionsByName[activeEntry.name.toLowerCase()] : undefined

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Cube editor" onClick={onClose}>
      <div className={`modal-content cube-editor ${unresolved.length > 0 ? 'cube-editor--wide' : ''}`} onClick={(event) => event.stopPropagation()}>
        <h2>{cubeId ? 'Edit Cube' : 'New Cube'}</h2>
        <label className="cube-editor__field">
          <span>Cube name</span>
          <input type="text" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="cube-editor__field">
          <span>Card list — one per line, optional count ("3x Sol Ring")</span>
          <textarea
            className="cube-editor__textarea"
            placeholder={'Sol Ring\n2x Lightning Bolt\nCounterspell'}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={10}
          />
        </label>
        {error && <p className="search-status search-status--error">{error}</p>}
        {resolvedCards.length > 0 && <p className="cube-editor__count">{totalCards} cards resolved</p>}
        {unresolved.length > 0 && (
          <div className="cube-editor__unresolved">
            <p className="search-status search-status--error">
              Couldn't find {unresolved.length} card{unresolved.length > 1 ? 's' : ''} — pick a replacement below, or leave them out.
            </p>
            <div className="cube-editor__unresolved-split">
              <ul className="cube-editor__missing-list">
                {unresolved.map((entry, index) => (
                  <li key={`${entry.name}-${index}`}>
                    <button type="button" className={index === activeIndex ? 'is-active' : ''} onClick={() => selectUnresolved(index)}>
                      {entry.quantity > 1 ? `${entry.quantity}× ` : ''}
                      {entry.name}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="cube-editor__suggestions">
                {!activeEntry && <p className="cube-editor__suggestions-hint">Select a card on the left to see suggestions.</p>}
                {activeEntry?.sourceLine && (
                  <p className="cube-editor__source-line">
                    <code>{activeEntry.sourceLine}</code>
                  </p>
                )}
                {activeEntry && activeSuggestions === 'loading' && <p className="cube-editor__suggestions-hint">Searching Scryfall for "{activeEntry.name}"…</p>}
                {activeEntry && activeSuggestions === 'error' && <p className="cube-editor__suggestions-hint">Couldn't search Scryfall right now — try again in a moment.</p>}
                {activeEntry && Array.isArray(activeSuggestions) && activeSuggestions.length === 0 && (
                  <p className="cube-editor__suggestions-hint">No close matches found for "{activeEntry.name}".</p>
                )}
                {activeEntry && Array.isArray(activeSuggestions) && activeSuggestions.length > 0 && (
                  <ul className="cube-editor__suggestion-list">
                    {activeSuggestions.map((card) => {
                      const image = getDisplayImage(card)
                      return (
                        <li key={card.id}>
                          <button type="button" onClick={() => acceptSuggestion(activeEntry, card)} title={`Use ${card.name} instead`}>
                            {image ? <img src={getCardImageUrl(image, 'small')} alt="" draggable={false} /> : <span className="cube-editor__suggestion-noimage" />}
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
        <div className="cube-editor__actions">
          <button type="button" onClick={handleResolve} disabled={status === 'resolving' || text.trim().length === 0}>
            {status === 'resolving' ? 'Resolving…' : 'Resolve Cards'}
          </button>
          <button type="button" onClick={handleSave} disabled={resolvedCards.length === 0}>
            Save Cube
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export default CubeEditorModal
