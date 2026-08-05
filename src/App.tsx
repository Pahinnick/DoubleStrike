import { useEffect, useState } from 'react'
import './App.css'
import CardHoverPreview from './components/shared/CardHoverPreview'
import { CategoryRecommendationsProvider } from './components/shared/CategoryRecommendationsContext'
import CategoryRecommendationsView from './components/shared/CategoryRecommendationsView'
import { HoverPreviewProvider } from './components/shared/HoverPreviewContext'
import { SimilarCardsProvider } from './components/shared/SimilarCardsContext'
import SimilarCardsView from './components/shared/SimilarCardsView'
import SearchPanel from './components/search/SearchPanel'
import DeckPanel from './components/deck/DeckPanel'
import DeckManagerModal from './components/deck/DeckManagerModal'
import ExportDeckModal from './components/deck/ExportDeckModal'
import FormatSelector from './components/deck/FormatSelector'
import ImportDeckModal from './components/deck/ImportDeckModal'
import DeckStatsPanel from './components/stats/DeckStatsPanel'
import HelpModal from './components/help/HelpModal'
import PlaytestView from './components/playtest/PlaytestView'
import ProfileSwitcher from './components/profile/ProfileSwitcher'
import WelcomeNameModal from './components/profile/WelcomeNameModal'
import SettingsModal from './components/settings/SettingsModal'
import { useCardSize } from './hooks/useCardSize'
import { getPlaytestWindowMode } from './hooks/usePlaytestWindowMode'
import { useProfileSettings } from './hooks/useProfileSettings'
import { useProximityGlow } from './hooks/useProximityGlow'
import { useDeck } from './state/DeckContext'
import { DeckWorkspaceProvider } from './state/DeckListContext'
import { JumpToCardProvider } from './state/JumpToCardContext'
import { ProfileProvider, useProfiles } from './state/ProfileContext'
import { isPlaytestWindow, onSwitchToInlineRequested, openDedicatedPlaytestWindow } from './utils/playtestWindowBridge'

const WELCOME_NAME_PROMPTED_KEY = 'mtgdb:welcomeNamePrompted'
const DEFAULT_PROFILE_NAME_PATTERN = /^(Player 1|Recovered Profile \d+)$/

function addTagToken(searchText: string, slug: string): string {
  const token = `otag:${slug}`
  const tokens = searchText.trim().split(/\s+/).filter(Boolean)
  if (tokens.includes(token)) return searchText
  return tokens.length > 0 ? `${searchText.trim()} ${token}` : token
}

function AppShell() {
  const { deck, addCard, undo, redo } = useDeck()
  const [managerOpen, setManagerOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Only used in 'inline' playtest-window mode (see usePlaytestWindowMode) — 'window' mode
  // never touches this, it opens a separate OS/browser window instead of swapping this one.
  const [playtestOpen, setPlaytestOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [statsExpanded, setStatsExpanded] = useState(true)
  const [cardSize, setCardSize] = useCardSize()
  // Also the one place that keeps the active profile's theme applied to <html data-theme="...">
  // at all times — see useProfileSettings' own doc for why this call staying mounted matters.
  const { theme } = useProfileSettings()
  useProximityGlow(theme === 'vaporwave')

  // Ctrl/Cmd+Z = undo, Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z = redo, for deck edits. Skipped while a
  // text field is focused (so native text undo works), on the dedicated Playtest window (that
  // view has its own separate game state, not the deck, and this window never renders the
  // deck editor at all), and while playtesting inline in 'inline' mode (same reason, just
  // sharing this window with the deck editor instead of getting its own).
  useEffect(() => {
    if (isPlaytestWindow || playtestOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo, playtestOpen])

  // Seamless window→inline handoff: the dedicated Playtest window asks us (the main window)
  // to take over in inline mode, then closes itself — see PlaytestView's toggle button and
  // utils/playtestWindowBridge. Only meaningful here, never on the dedicated window itself.
  useEffect(() => {
    if (isPlaytestWindow) return
    return onSwitchToInlineRequested(() => setPlaytestOpen(true))
  }, [])

  if (isPlaytestWindow) {
    // window.close() closes this whole window (Electron: the dedicated Playtest
    // BrowserWindow; plain browser dev fallback: the window.open() popup) rather than
    // navigating back to a deck editor that was never rendered here in the first place.
    if (deck.cards.length === 0) {
      return (
        <div className="app-loading">
          Add cards to your deck to playtest.
          <button type="button" onClick={() => window.close()}>
            Close
          </button>
        </div>
      )
    }
    return <PlaytestView onClose={() => window.close()} />
  }

  if (playtestOpen) {
    return <PlaytestView onClose={() => setPlaytestOpen(false)} />
  }

  function handleOpenPlaytest() {
    // Read fresh at click time (see getPlaytestWindowMode) rather than a hook — this button
    // doesn't render the toggle itself, so there's nothing here that needs to re-render when
    // the preference changes, just the current value at the moment of the click.
    if (getPlaytestWindowMode() === 'inline') {
      setPlaytestOpen(true)
      return
    }
    openDedicatedPlaytestWindow()
  }

  function handleSearchTextChange(next: string) {
    setSearchText(next)
    setSearchExpanded(true)
  }

  function handleAddTagToSearch(slug: string) {
    setSearchText((prev) => addTagToken(prev, slug))
    setSearchExpanded(true)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>DoubleStrike</h1>
        <ProfileSwitcher />
        <span className="app-header__deck-name">{deck.name}</span>
        <FormatSelector />
        <button type="button" onClick={handleOpenPlaytest} disabled={deck.cards.length === 0}>
          Playtest
        </button>
        <button type="button" onClick={() => setImportOpen(true)}>
          Import
        </button>
        <button type="button" onClick={() => setExportOpen(true)}>
          Export
        </button>
        <button type="button" onClick={() => setManagerOpen(true)}>
          My Decks
        </button>
        <button type="button" className="app-header__help" aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}>
          ⚙
        </button>
        <button type="button" className="app-header__help" aria-label="Help" onClick={() => setHelpOpen(true)}>
          ?
        </button>
      </header>
      <main
        className={['app-main', !searchExpanded && 'search-collapsed', !statsExpanded && 'stats-collapsed']
          .filter(Boolean)
          .join(' ')}
      >
        <SearchPanel
          onAddCard={addCard}
          text={searchText}
          onTextChange={handleSearchTextChange}
          expanded={searchExpanded}
          onExpand={() => setSearchExpanded(true)}
          onCollapse={() => setSearchExpanded(false)}
          cardSize={cardSize}
          onCardSizeChange={setCardSize}
        />
        <DeckPanel cardSize={cardSize} onCardSizeChange={setCardSize} />
        <DeckStatsPanel
          expanded={statsExpanded}
          onExpand={() => setStatsExpanded(true)}
          onCollapse={() => setStatsExpanded(false)}
        />
      </main>
      {managerOpen && <DeckManagerModal onClose={() => setManagerOpen(false)} />}
      {importOpen && <ImportDeckModal onClose={() => setImportOpen(false)} />}
      {exportOpen && <ExportDeckModal onClose={() => setExportOpen(false)} />}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <SimilarCardsView onAddTagToSearch={handleAddTagToSearch} />
      <CategoryRecommendationsView />
    </div>
  )
}

function Workspace() {
  const { activeProfileId, profiles, renameProfile } = useProfiles()
  const [welcomeDismissed, setWelcomeDismissed] = useState(false)

  // First-run only: replaces the silent "Player 1"/"Recovered Profile N" default with an
  // actual question, one time, gated by a localStorage flag so it never nags again — including
  // if the user picks "Skip for now" and keeps the default name on purpose.
  const activeProfile = profiles.find((p) => p.id === activeProfileId)
  const needsWelcome =
    !welcomeDismissed &&
    activeProfile !== undefined &&
    profiles.length === 1 &&
    DEFAULT_PROFILE_NAME_PATTERN.test(activeProfile.name) &&
    localStorage.getItem(WELCOME_NAME_PROMPTED_KEY) !== 'true'

  function dismissWelcome() {
    localStorage.setItem(WELCOME_NAME_PROMPTED_KEY, 'true')
    setWelcomeDismissed(true)
  }

  return (
    <>
      <DeckWorkspaceProvider key={activeProfileId} profileId={activeProfileId}>
        <HoverPreviewProvider>
          <SimilarCardsProvider>
            <CategoryRecommendationsProvider>
              <JumpToCardProvider>
                <AppShell />
                <CardHoverPreview />
              </JumpToCardProvider>
            </CategoryRecommendationsProvider>
          </SimilarCardsProvider>
        </HoverPreviewProvider>
      </DeckWorkspaceProvider>
      {needsWelcome && activeProfile && (
        <WelcomeNameModal
          currentName={activeProfile.name}
          onSubmit={(name) => {
            if (name !== activeProfile.name) void renameProfile(activeProfile.id, name)
            dismissWelcome()
          }}
          onSkip={dismissWelcome}
        />
      )}
    </>
  )
}

function App() {
  return (
    <ProfileProvider>
      <Workspace />
    </ProfileProvider>
  )
}

export default App
