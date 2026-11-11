import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { ScryfallCard } from '../api/scryfallTypes'
import BootstrapError from '../components/shared/BootstrapError'
import { getAutoCategory } from '../engine/cardCategory'
import { saveSnapshots } from '../storage/cardCache'
import {
  deleteDeck as deleteDeckFromStore,
  listDecks,
  loadDeck,
  saveDeck,
} from '../storage/deckRepository'
import { storage } from '../storage/storage'
import { loadOrBuildTagIndex, type TagIndexData } from '../storage/tagIndex'
import { DeckContext } from './DeckContext'
import { createEmptyDeck } from './deckReducer'
import { deckHistoryReducer, initDeckHistory } from './deckHistory'
import type { Board, DeckSummary } from './types'

const AUTOSAVE_DEBOUNCE_MS = 500

type DeckListContextValue = {
  decks: DeckSummary[]
  activeDeckId: string
  switchDeck: (id: string) => Promise<void>
  /** Creates, saves and switches to a new empty deck; resolves with its id. */
  createDeck: (name: string) => Promise<string>
  deleteDeck: (id: string) => Promise<void>
  renameDeck: (id: string, name: string) => Promise<void>
}

const DeckListContext = createContext<DeckListContextValue | null>(null)

export function useDeckList(): DeckListContextValue {
  const ctx = useContext(DeckListContext)
  if (!ctx) throw new Error('useDeckList must be used within a DeckWorkspaceProvider')
  return ctx
}

export function DeckWorkspaceProvider({ profileId, children }: { profileId: string; children: ReactNode }) {
  const [decks, setDecks] = useState<DeckSummary[]>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryToken, setRetryToken] = useState(0)
  const [history, dispatch] = useReducer(deckHistoryReducer, undefined, () => initDeckHistory(createEmptyDeck('New Deck')))
  const deck = history.present
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  // Kicked off once on mount so it's very likely already resolved by the time the user adds their
  // first card (loadOrBuildTagIndex caches in IndexedDB for 30 days, so this is a no-op network
  // call after the first cold start). addCard reads whatever's in the ref at call time — if it's
  // still loading, new cards just fall back to type-based categorization for that add.
  const tagIndexRef = useRef<TagIndexData>()
  useEffect(() => {
    let cancelled = false
    void loadOrBuildTagIndex().then((index) => {
      if (!cancelled) tagIndexRef.current = index
    })
    return () => {
      cancelled = true
    }
  }, [])

  const refreshDecks = useCallback(async () => {
    setDecks(await listDecks(profileId))
  }, [profileId])

  useEffect(() => {
    let cancelled = false
    setError(null)

    async function bootstrap() {
      const lastId = await storage.getLastOpenedDeckId(profileId)
      const existing = lastId ? await loadDeck(profileId, lastId) : undefined
      // Bail before any writes: in dev, StrictMode mounts this effect twice,
      // and the discarded first run must not persist an orphan deck.
      if (cancelled) return
      const startingDeck = existing ?? createEmptyDeck('New Deck')
      if (!existing) {
        await saveDeck(profileId, startingDeck)
        if (cancelled) return
      }
      dispatch({ type: 'LOAD_DECK', deck: startingDeck })
      await storage.setLastOpenedDeckId(profileId, startingDeck.id)
      await refreshDecks()
      if (!cancelled) setReady(true)
    }

    bootstrap().catch((err: unknown) => {
      if (cancelled) return
      // Without this, any failure here left the app on an infinite, silent
      // "Loading your decks…" screen forever — no error, no way to retry.
      console.error('[decks] failed to load', err)
      setError(err instanceof Error ? err.message : String(err))
    })
    return () => {
      cancelled = true
    }
    // Runs once per profileId (this component is remounted with a fresh key on profile
    // switch) or on retry; refreshDecks is stable for a given profileId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, retryToken])

  useEffect(() => {
    if (!ready) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void saveDeck(profileId, deck).then(refreshDecks)
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [deck, ready, profileId, refreshDecks])

  const switchDeck = useCallback(
    async (id: string) => {
      const target = await loadDeck(profileId, id)
      if (!target) return
      dispatch({ type: 'LOAD_DECK', deck: target })
      await storage.setLastOpenedDeckId(profileId, id)
    },
    [profileId],
  )

  const createDeck = useCallback(
    async (name: string) => {
      const newDeck = createEmptyDeck(name)
      await saveDeck(profileId, newDeck)
      dispatch({ type: 'LOAD_DECK', deck: newDeck })
      await storage.setLastOpenedDeckId(profileId, newDeck.id)
      await refreshDecks()
      return newDeck.id
    },
    [profileId, refreshDecks],
  )

  const removeDeck = useCallback(
    async (id: string) => {
      await deleteDeckFromStore(profileId, id)
      const remaining = await listDecks(profileId)
      setDecks(remaining)
      if (id === deck.id) {
        if (remaining[0]) {
          await switchDeck(remaining[0].id)
        } else {
          await createDeck('New Deck')
        }
      }
    },
    [profileId, deck.id, switchDeck, createDeck],
  )

  // Renaming the active deck just dispatches into the same reducer that already
  // autosaves; renaming any other deck goes straight to storage (load, patch, save)
  // without disturbing what's currently open in the editor.
  const renameDeck = useCallback(
    async (id: string, name: string) => {
      if (id === deck.id) {
        dispatch({ type: 'RENAME_DECK', name })
        return
      }
      const target = await loadDeck(profileId, id)
      if (!target) return
      await saveDeck(profileId, { ...target, name, updatedAt: new Date().toISOString() })
      await refreshDecks()
    },
    [profileId, deck.id, refreshDecks],
  )

  const addCard = useCallback(
    (card: ScryfallCard, board: Board = 'mainboard', category?: string) => {
      // Auto-categorize only genuinely new entries — an explicit category (drag onto a category
      // header) always wins, and a repeat add of a card already on this board must never touch
      // its existing category (see the matching comment on deckReducer's ADD_CARD case).
      const isNewEntry = !deck.cards.some((c) => c.scryfallId === card.id && c.board === board)
      const resolvedCategory = category ?? (isNewEntry ? getAutoCategory(card, tagIndexRef.current) : undefined)
      dispatch({ type: 'ADD_CARD', scryfallId: card.id, board, category: resolvedCategory })
      void saveSnapshots([card])
    },
    [deck.cards],
  )

  const setCardPrinting = useCallback((card: ScryfallCard, fromScryfallId: string, board: Board) => {
    dispatch({ type: 'SET_PRINTING', fromScryfallId, toScryfallId: card.id, board })
    void saveSnapshots([card])
  }, [])

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), [])
  const redo = useCallback(() => dispatch({ type: 'REDO' }), [])
  const canUndo = history.past.length > 0
  const canRedo = history.future.length > 0

  const deckContextValue = useMemo(
    () => ({ deck, dispatch, addCard, setCardPrinting, undo, redo, canUndo, canRedo }),
    [deck, addCard, setCardPrinting, undo, redo, canUndo, canRedo],
  )

  const listContextValue = useMemo(
    () => ({
      decks,
      activeDeckId: deck.id,
      switchDeck,
      createDeck,
      deleteDeck: removeDeck,
      renameDeck,
    }),
    [decks, deck.id, switchDeck, createDeck, removeDeck, renameDeck],
  )

  if (error) {
    return (
      <BootstrapError
        message="Couldn't load your decks."
        detail={error}
        onRetry={() => setRetryToken((n) => n + 1)}
      />
    )
  }

  if (!ready) {
    return <div className="app-loading">Loading your decks…</div>
  }

  return (
    <DeckListContext.Provider value={listContextValue}>
      <DeckContext.Provider value={deckContextValue}>{children}</DeckContext.Provider>
    </DeckListContext.Provider>
  )
}
