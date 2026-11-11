import { useEffect, useState } from 'react'
import { getCardsByIdentifiers, getDisplayImage } from '../../api/scryfall'
import type { ImageUris } from '../../api/scryfallTypes'
import type { DeckToken } from '../../engine/deckTokens'
import { useEscapeToClose } from '../../hooks/useEscapeToClose'
import { useHoverPreview } from '../../hooks/useHoverPreview'
import { saveSnapshots } from '../../storage/cardCache'

type Props = {
  /** Distinct tokens the deck can make (from the cards' `related_tokens`). */
  tokens: DeckToken[]
  /** Called with the chosen token's Scryfall id — its snapshot is already cached by the time this fires. */
  onPick: (scryfallId: string) => void
  onClose: () => void
}

type Loaded = {
  images: Map<string, ImageUris | undefined>
  status: 'loading' | 'ready' | 'error'
}

/** Grid picker of "tokens your deck can make." Fetches the token cards on open to show their art and
 *  to cache their snapshots (so the battlefield can resolve the image once one is added). */
function TokenPickerModal({ tokens, onPick, onClose }: Props) {
  useEscapeToClose(onClose)
  const [loaded, setLoaded] = useState<Loaded>({ images: new Map(), status: 'loading' })

  useEffect(() => {
    let cancelled = false
    if (tokens.length === 0) {
      setLoaded({ images: new Map(), status: 'ready' })
      return
    }
    getCardsByIdentifiers(tokens.map((t) => ({ id: t.id })))
      .then(async (cards) => {
        if (cancelled) return
        // Cache the token snapshots now so PlaytestView's snapshot map resolves the art the
        // moment ADD_TOKEN puts one on the battlefield (useCardSnapshots only reads the cache).
        await saveSnapshots(cards)
        if (cancelled) return
        setLoaded({ images: new Map(cards.map((c) => [c.id, getDisplayImage(c)])), status: 'ready' })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ images: new Map(), status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [tokens])

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Create token" onClick={onClose}>
      <div className="modal-content token-picker" onClick={(event) => event.stopPropagation()}>
        <h2>Create a token</h2>
        {tokens.length === 0 ? (
          <p className="search-status">
            No tokens found for this deck's cards. (Tokens are read from Scryfall's related-cards data — freshly
            imported decks have it; older cached cards fill in after their next refresh.)
          </p>
        ) : (
          <>
            <p className="zone-viewer__note">Tokens your deck's cards can make. Click one to put it on the battlefield.</p>
            {loaded.status === 'error' && (
              <p className="search-status search-status--error">Couldn't load token art — check your connection.</p>
            )}
            <ul className="token-picker__grid">
              {tokens.map((token) => (
                <TokenTile
                  key={token.id}
                  token={token}
                  image={loaded.images.get(token.id)}
                  onPick={() => onPick(token.id)}
                />
              ))}
            </ul>
          </>
        )}
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

function TokenTile({ token, image, onPick }: { token: DeckToken; image: ImageUris | undefined; onPick: () => void }) {
  const [hoverHandlers] = useHoverPreview({ id: token.id, oracle_id: '', name: token.name, image_uris: image })

  return (
    <li className="token-picker__tile">
      <button type="button" onClick={onPick} {...(image ? hoverHandlers : {})}>
        {image ? <img src={image.small} alt="" /> : <span className="token-picker__img-placeholder" />}
        <span className="token-picker__name">{token.name}</span>
        <span className="token-picker__type">{token.type_line}</span>
        {token.sourceCount > 1 && <span className="token-picker__sources">{token.sourceCount} sources</span>}
      </button>
    </li>
  )
}

export default TokenPickerModal
