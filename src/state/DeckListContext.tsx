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
import { announceDeckSaved, subscribeToDeckSaves } from '../storage/deckSync'
import { storage } from '../storage/storage'
import { loadOrBuildTagIndex, type TagIndexData } from '../storage/tagIndex'
import { DeckContext } from './DeckContext'
import { createEmptyDeck } from './deckReducer'
import { deckHistoryReducer, initDeckHistory } from './deckHistory'
import type { Board, Deck, DeckSummary } from './types'

const AUTOSAVE_DEBOUNCE_MS = 500

type DeckListContextValue = {
  decks: DeckSummary[]
  activeDeckId: string
  switchDeck: (id: string) => Promise<void>
  createDeck: (name: string) => Promise<void>
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
  // The exact deck object that last came from, or went to, storage. A deck equal to this by
  // reference has nothing to save — which is what stops a freshly loaded deck being written
  // straight back out, and a deck adopted from another window being echoed back to it.
  const savedDeckRef = useRef<Deck | null>(null)
  // The newest edit still waiting out the debounce, if any.
  const pendingSaveRef = useRef<Deck | null>(null)
  const deckRef = useRef(deck)
  deckRef.current = deck
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
      savedDeckRef.current = startingDeck
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

  const persistDeck = useCallback(
    async (toSave: Deck) => {
      await saveDeck(profileId, toSave)
      savedDeckRef.current = toSave
      announceDeckSaved({ profileId, deckId: toSave.id, updatedAt: toSave.updatedAt })
      await refreshDecks()
    },
    [profileId, refreshDecks],
  )

  /** Writes the waiting edit now instead of when its debounce runs out. */
  const flushPendingSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const pending = pendingSaveRef.current
    pendingSaveRef.current = null
    if (pending) void persistDeck(pending).catch((err: unknown) => console.error('[decks] failed to save', err))
  }, [persistDeck])

  useEffect(() => {
    if (!ready) return
    // A different deck has just become active with the previous one's last edit still waiting.
    // The debounce used to simply be cancelled here, so that edit was never written — rename a
    // deck and click straight onto another, and the rename was gone.
    if (pendingSaveRef.current && pendingSaveRef.current.id !== deck.id) flushPendingSave()
    if (deck === savedDeckRef.current) {
      // Back to exactly what storage holds: nothing to write, and nothing left waiting either.
      if (saveTimer.current) clearTimeout(saveTimer.current)
      pendingSaveRef.current = null
      return
    }
    pendingSaveRef.current = deck
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flushPendingSave, AUTOSAVE_DEBOUNCE_MS)
  }, [deck, ready, flushPendingSave])

  // Leaving (profile switch remounts this provider; the window can simply close) must not drop
  // the edit still inside its debounce window either.
  useEffect(() => {
    window.addEventListener('pagehide', flushPendingSave)
    return () => {
      window.removeEventListener('pagehide', flushPendingSave)
      flushPendingSave()
    }
  }, [flushPendingSave])

  // Another window of the app saved a deck (see storage/deckSync.ts). If it's the one open here,
  // and newer than what this window holds, adopt it — otherwise this window's next autosave
  // would write its stale copy back over that change.
  useEffect(() => {
    if (!ready) return
    return subscribeToDeckSaves((message) => {
      if (message.profileId !== profileId) return
      void refreshDecks()
      const isNewerThanOurs = () => message.deckId === deckRef.current.id && message.updatedAt > deckRef.current.updatedAt
      // An edit of our own still waiting to save wins: it is newer than anything on disk and is
      // about to be written.
      if (!isNewerThanOurs() || pendingSaveRef.current) return
      void loadDeck(profileId, message.deckId).then((fresh) => {
        if (!fresh || pendingSaveRef.current) return
        if (fresh.id !== deckRef.current.id || fresh.updatedAt <= deckRef.current.updatedAt) return
        savedDeckRef.current = fresh
        dispatch({ type: 'SYNC_DECK', deck: fresh })
      })
    })
  }, [ready, profileId, refreshDecks])

  const switchDeck = useCallback(
    async (id: string) => {
      const target = await loadDeck(profileId, id)
      if (!target) return
      savedDeckRef.current = target
      dispatch({ type: 'LOAD_DECK', deck: target })
      await storage.setLastOpenedDeckId(profileId, id)
    },
    [profileId],
  )

  const createDeck = useCallback(
    async (name: string) => {
      const newDeck = createEmptyDeck(name)
      await saveDeck(profileId, newDeck)
      savedDeckRef.current = newDeck
      dispatch({ type: 'LOAD_DECK', deck: newDeck })
      await storage.setLastOpenedDeckId(profileId, newDeck.id)
      await refreshDecks()
    },
    [profileId, refreshDecks],
  )

  const removeDeck = useCallback(
    async (id: string) => {
      // An edit to this deck still waiting to save would otherwise be written after the delete
      // and bring the deck straight back.
      if (pendingSaveRef.current?.id === id) {
        if (saveTimer.current) clearTimeout(saveTimer.current)
        pendingSaveRef.current = null
      }
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
