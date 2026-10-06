# Bug sweep — 2026-10-06

Seven-reviewer sweep of DoubleStrike at 1.9.0, followed by a fix pass. This file is the ticket
list: every finding, where it lives, and whether it has been fixed. Nothing here is committed
yet — all fixes are uncommitted changes in the working tree.

**Status key:** `[x]` fixed and passing type-check + tests · `[~]` code written, not yet
compiled/tested · `[ ]` not started · `[-]` deliberately not doing (reason given)

Baseline before the fix pass: 570/570 tests, `tsc -b` clean, lint 0 errors.

## Where this stands

Every ticket below is fixed except the two under "Not doing". Final run: `npx tsc -b` clean,
597/597 tests (27 new regression tests), `npx eslint .` 0 errors and the same 13 fast-refresh
warnings as before the sweep.

What that does and does not prove:

- Checked live in the browser build: the app loads with no console errors; an import mixing
  `1x Name (set) 123 *F* [Tag]`, `1 Name (set) 123`, `1x Name`, a bare name, an etched `*E*`
  line and a nonsense line brought in every real card and listed the nonsense one as unresolved
  with its entry selected; Escape closed the modal.
- Everything else is verified by type-check and unit tests only. **Not exercised in a running
  app:** the Electron storage changes (atomic writes, locks, single-instance), the two-window
  deck sync, every multiplayer/reconnect change, the radio, and draft mode. Those need a manual
  pass before a release — a two-window session and a real pod with a forced disconnect cover
  most of it.
- The PeerJS-specific reasoning (which errors accompany a signaling drop, that destroying a peer
  closes its channel synchronously) comes from reading the installed PeerJS source, not from
  reproducing the failure.

## Storage and Electron

- [x] **Saves weren't atomic; a file read mid-write was quarantined as corrupted** —
  `electron/storage.cjs`. Now temp-file + rename, with a per-file lock and a lock around the
  app-data read-modify-write handlers. Likely the real cause of the old "Recovered Profile N"
  profile loss (not confirmed).
- [x] **Two windows overwrote each other's deck** — `src/state/DeckListContext.tsx`, new
  `src/storage/deckSync.ts`. Windows now announce saves over a BroadcastChannel and adopt the
  newer copy.
- [x] **Deck autosave cancelled instead of flushed** on deck switch / profile switch / close —
  `DeckListContext.tsx`. Also no longer re-saves a deck that hasn't changed.
- [x] **No single-instance lock** — `electron/main.cjs`.
- [x] **Malformed URL crashed the packaged static server** — `electron/main.cjs`.
- [x] **Updater sent to a destroyed window** — `electron/updater.cjs`.
- [x] **"Cache card data" setting ignored when adding a card / swapping a printing** —
  `src/storage/cardCache.ts` (setting now enforced inside `saveSnapshots`).

## Scryfall, import, export

- [x] **Failed Scryfall batch was indistinguishable from "card not found"** —
  `src/api/scryfall.ts` (`resolveCardsByIdentifiers` reports failed identifiers). Import and
  Export now show an error instead of a short result.
- [x] **Import silently dropped lines it couldn't parse** — `src/engine/deckImport.ts`. Now
  accepts `1 Name (set) 123`, `1x Name`, bare names, any `*X*` finish marker, section headers,
  comments, BOM; name-only lines are looked up by name.
- [x] **Import modal: first failed card selected with a blank suggestions pane** —
  `src/components/deck/ImportDeckModal.tsx`.
- [x] **Reversible-layout printings crashed Export and threw on add** —
  `src/engine/deckExport.ts`, `src/engine/cardCategory.ts`.
- [x] **Art picker showed only the newest 175 printings** — `getCardPrints` now pages.
- [x] **Etched-only printings had no price** — `src/utils/price.ts`.
- [x] **A typed `or` in search escaped the format/colour filters** — `src/utils/scryfallQuery.ts`.

## Rules and stats

- [x] **Snow basics flagged as singleton violations** — `src/engine/legality.ts`.
- [x] **Two printings of one card passed the singleton check** — `legality.ts`.
- [x] **Every card flagged off-identity while the commander was still loading** — `legality.ts`.
- [x] **Castability: one dual land paid both colours** — `src/engine/castability.ts`.
- [x] **Castability: hybrid pips needed no colour** — `castability.ts`.
- [x] **Transform cards with a land back face counted as lands** — new
  `src/engine/cardTypes.ts`, used by `cardCategory.ts` and `DeckStatsPanel.tsx`. Modal
  double-faced spell//land cards still count as lands on purpose.
- [x] **Accented names got no EDHREC data** — `src/api/edhrec.ts` (`edhrecSlug`).
- [x] **Split-card salt / commander-count lookups ignored EDHREC redirects** — `edhrec.ts`.

## Deck editor

- [x] **Moving a card to a board that already had that printing made duplicate rows** —
  `src/state/deckReducer.ts` (`MOVE_CARD_BOARD` now merges).
- [x] **Renaming a category onto an existing name duplicated the group** — `deckReducer.ts`
  (now merges; reserved group names rejected).
- [x] **Choose Commander added a second copy of a card already in the deck** —
  `src/components/deck/CommanderBrowserModal.tsx` (matches by Oracle card).
- [x] **Deck list degraded to raw ids after "Clear cached card data"** —
  `src/hooks/useCardSnapshots.ts`, `SettingsModal.tsx`.
- [x] **Salt scores stuck missing for the session** — `src/hooks/useSaltScores.ts`.
- [x] **EDHREC Recommended stuck on "no recommendations"** —
  `src/hooks/useCommanderRecommendations.ts`.
- [x] **Similar Cards: art/foil swatches acted on the previous card** —
  `src/components/shared/SimilarCardsView.tsx`.
- [x] **"Load more" appended the old query's results; its errors were never shown** —
  `src/hooks/useCardSearch.ts`.
- [x] **Skipping the tour still dumped the precon into the open deck** — `src/App.tsx`.
- [x] **Ctrl+Z undid deck edits behind an open modal** — `App.tsx`.
- [x] **Escape closed almost no modal** — new `src/hooks/useEscapeToClose.ts`, wired into every
  modal, menu and popover (deck editor, Playtest and draft). Nested layers close one per press.
- [x] **Undo restored a deck with its old `updatedAt`** — `src/state/deckHistory.ts` (found while
  fixing the two-window sync).

## Multiplayer connection (`src/net/peerConnection.ts`)

- [x] **A signaling blip tore down a healthy guest connection, then the rejoin timer killed the
  fresh one** — guest error handling, stale-connection guards, rejoin timer.
- [x] **Signaling reconnect opened a second data channel** (found while fixing the above).
- [x] **Host treated any PeerJS error as fatal** — non-fatal once the room is up.
- [x] **Give Card destroyed the card when the send no-oped** — `giveCard` returns whether it was
  sent; the host bounces an undeliverable give back to the giver. Caller side is in the `[~]`
  block below.
- [x] **Rejoining guest never learned who left / that the radio was turned off** — new
  `welcomed` event clears mirrors before the replay; radio is always replayed.
- [x] **First-join failure left the attempt timer running** (message later replaced by "the game
  didn't respond").
- [x] **Wire support for commander flag/tax on a given card and for who went first** —
  `src/net/protocol.ts`, `useMultiplayer.ts`, `podLayout.ts`. Consumed by the `[~]` block below.

## Playtest view

All in `src/components/playtest/PlaytestView.tsx` and `src/state/gameReducer.ts` unless noted.

- [x] **Undo across a card handoff duplicated or deleted cards** — network-driven actions now go
  through `dispatchExternal`, which rewrites the undo history instead of joining it.
- [x] **Undo stack survived a deck switch** (old deck's board saved under the new deck).
- [x] **Resuming a saved game was itself undoable** (one Ctrl+Z threw the save away).
- [x] **Give Card / reclaim removed the card even when it wasn't sent** — caller side.
- [x] **A given commander came back as a plain card, tax lost** — `RECEIVE_GIVEN_CARD`,
  `isOwnCommander`, `src/net/publicBoard.ts`.
- [x] **Cards parked on an opponent's quadrant stayed parked after the pod ended** (drawn off the
  mat, skipped by Untap) — new `NORMALIZE_SEATS` action.
- [x] **Table Turn ticked at the wrong time and never reset; "Turn N" stuck at 1 in a pod.**
- [x] **Opponent zone viewer was a frozen snapshot** (revealed hand stayed readable).
- [x] **Click-played cards landed exactly on top of an existing card** — `autoPosition`.
- [x] **Marquee selection ignored where parked cards are drawn.**
- [x] **Playtest autosave dropped the last action before exit; unhandled save rejections.**
- [x] **Stale hover/selection after a card changed zone** (Delete/F hit the wrong card).
- [x] **Drop preview ghost disagreed with the real drop in pods.**
- [x] **Joining a game in progress fired the "X's Turn" banner and sound.**
- [x] **A rejoined guest was invisible for up to 15 s** (and skipped by Pass Turn).
- [x] **Remote tap / delete / return applied to a card that had left the battlefield** —
  `SET_TAPPED` guard in the reducer, zone checks in the handlers.
- [x] **Keyword counters showed "FLY×0" / "FLY×-1"** instead of going away.

## Playtest components

- [x] **Ghost radio audio after a quick station change or Off** —
  `src/components/playtest/TableRadio.tsx:113-123` (retry timer holds the old `<audio>` element
  and is never cancelled).
- [x] **Radio volume 0 not remembered** — `TableRadio.tsx:67-70` (`stored > 0` check).
- [x] **Radio shows "playing" forever after retries run out** — `TableRadio.tsx:113-123, 162`.
- [x] **Hover preview stuck when an opponent turns the hovered card face down** —
  `src/components/playtest/PlaytestCard.tsx:180-192` (handlers dropped when `snapshot` is
  undefined).
- [x] **Preview shows the old face after pressing F on a hovered card** —
  `PlaytestCard.tsx:119-128`, `src/hooks/useHoverPreview.ts:35-48`.
- [x] **Blank Cascade prompt submits as 0 and lists the whole library; Enter skips validation** —
  `src/components/playtest/NumberInputPrompt.tsx:57-63, 83-88`.

## Draft mode

- [x] **Guests see "Loading…" tiles instead of cards** — `src/components/draft/PackView.tsx:16-31`
  (reads IndexedDB only; must fetch missing ids from Scryfall).
- [x] **A guest connection blip stalls the draft** — `src/draft/useDraftSession.ts`. The
  connection now emits `guestSeated`; the host needs to re-send that seat's held packs on it,
  and the guest needs to de-duplicate packs and roll back a pick that never landed.
- [x] **Pick sent while disconnected loses the pack** — `useDraftSession.ts:229-241`
  (`sendDraftPick` now returns whether it was sent; `pickCard` must check it).
- [x] **Build Deck can create an empty/partial deck and clear the pool** —
  `src/components/draft/DraftDeckBuildingView.tsx:29-42` (use `resolveCardsByIdentifiers`, abort
  on `failed`).
- [x] **Fractional "Packs per player" means the draft never finishes** —
  `src/components/draft/DraftLobbyPanel.tsx:147, 155` (coerce to integers).
- [x] **Cube editor: bogus "Couldn't reach Scryfall" on resolve** —
  `src/components/draft/CubeEditorModal.tsx:102` (same stale-closure bug as the import modal).
- [x] **Cube editor: Save ignores textarea edits unless Resolve was clicked** —
  `CubeEditorModal.tsx:109-121, 198`.
- [x] **Cube editor: network failures reported as "couldn't find"** —
  `src/draft/cubeImport.ts:36-53` (use `resolveCardsByIdentifiers`).
- [x] **Cube resolve misses front-face / unaccented names; "1996 World Champion" parsed as a
  quantity** — `cubeImport.ts:8, 39, 44`.
- [x] **Double-click picks from two packs** — `useDraftSession.ts:229-241`.
- [x] **A dead connection is invisible once drafting has started** —
  `src/components/draft/DraftView.tsx:44-52`.
- [x] **Clicking the cube editor's backdrop also closes the cube manager** —
  `CubeEditorModal.tsx:128` (stop propagation).
- [x] **Saving an existing cube overwrites `createdAt`** — `CubeEditorModal.tsx:116`.
- [x] **Duplicate React keys when a pack holds two copies of a card** — `PackView.tsx:45`.
- [x] **Rejection rollback only removes the card if it is last in the pool; pending picks never
  cleared on success** — `useDraftSession.ts:70, 115, 236`.

## Not doing

- [-] **Commander nameplate portrait disappears while the commander is under another player's
  control** — cosmetic; a real fix means storing commander identity in `GameState`, which changes
  the saved-game shape. The flag and tax now survive the round trip, which was the real loss.
- [-] **Drafted pools saved as real decks** — already scheduled as its own rework. The only write
  path is `createDeck` at `src/components/draft/DraftDeckBuildingView.tsx:34`.

## Also fixed along the way

- [x] **"Couldn't search Scryfall right now" shown for any unresolved name with no matches** —
  a no-results search is a 404 from Scryfall, which the import and cube-editor suggestion panes
  treated as a failure. Found during the live smoke test.

## Left behind by the smoke test

A deck named "Sweep smoke test" exists in the browser build's storage (the Browser-pane profile,
not the installed app's data). Delete it from My Decks if you open the dev build in that pane.

## Added after the sweep

- [x] **Flip a double-faced card by click as well as by F** — a small flip button on every
  double-faced card you control (battlefield and hand, plus an opponent's card parked on your
  quadrant), in `PlaytestView.tsx` (`FlipFaceButton`) and `playtest.css`. F while hovering now
  works in hand too, and a card flipped in hand is played that side up (`FLIP_CARD` in
  `gameReducer.ts`). Checked live: clicking the button turned Delver of Secrets over in hand
  without playing it.

## Open: cards stop being movable/playable in a pod

Reported: after moving own cards onto other players' boards, hand and battlefield cards stopped
responding to drags and clicks. Rare, not reproduced, **cause not found**.

Ruled out by reading the code (not by reproducing):
- No CSS turns off pointer events on your own cards or on "foreign" (parked) cards, and nothing
  sets a drag-in-progress class.
- `draggable` is unconditional on your own cards; the click and drop handlers have no pod-state
  gate.
- The battlefield and hand drop targets always accept a drag.
- Per-card "ignore the click after a drag" flags can swallow one click on one card, not all.

Still plausible, unconfirmed:
- A modal or other full-screen layer open without being noticed (the Multiplayer modal opens by
  itself when a connection drops).
- Chromium left in drag mode after a drag was interrupted (window lost focus mid-drag).
- Local actions applying and then being overwritten. The undo/handoff history bug fixed in this
  sweep could do that to a card that had been given away, but not to a whole hand.

Next step if it happens again: note whether pan/zoom, the Draw button and tapping still worked,
whether pressing Escape or clicking empty table cleared it, and whether the other players saw
your board change.

### Update: live two-player test, still not reproduced

New detail from the report: in the bugged state the other players could still manipulate the
stuck player's cards, and it began right after that player moved their own cards onto other
boards.

Tested in a real host + guest game (two tabs, real PeerJS connection, current fixed code), with
drags driven by scripted drag events:
- Guest parks a battlefield card on the host's quadrant, then plays from hand and taps: works.
- Host untaps the parked card, then drags it to the host's hand zone (returns it to its owner):
  works, and the guest can still play and tap afterwards.
- Guest drags a hand card straight onto the host's quadrant, parks a second battlefield card
  there, then plays and taps again: works.
- Nothing was covering the guest's hand cards (hit-tested), and no full-screen layer was present.

What that establishes:
- The "my cards became someone else's" theory does not match the code. Nothing marks a card as
  another player's for the purposes of local input: your own cards are always drawn from your own
  game state as interactive cards. `ownerSeat` only draws the coloured ring, and `atSeat` only
  decides which quadrant a card is drawn in.
- Others being able to move the cards means the stuck client was still connected and still
  applying changes. So the lock is in that client's own mouse input, not in game state or the
  network.
- Scripted events exercise the app's handlers but not the browser's real drag-and-drop engine, and
  this test was two players, not four. Both remain untested.

### F9 debug snapshot (added to catch the freeze)

Pressing **F9** anywhere in Playtest copies a JSON snapshot to the clipboard; if the clipboard
refuses, the text opens on screen already selected so Ctrl+C copies it. Code:
`src/components/playtest/debugSnapshot.ts` and the F9 effect in `PlaytestView.tsx`. It only reads.

What to look at in a capture from a stuck client:
- `page.pointer.lastMouseMoveMsAgo` large while the mouse is moving, or `buttonsHeld` non-zero
  with no button down: mouse events are not reaching the page (browser stuck mid-drag).
- `page.recentEvents`: a `dragstart` with no later `dragend`/`drop`, or clicks landing on
  something other than a card.
- `page.ownHandCards` / `ownBattlefieldCards`: `hit` anything other than `card` names the element
  sitting on top of it.
- `page.largeInteractiveLayers` and `ui.open`: a layer or modal open that shouldn't be. The table
  surface is always in the first list.
- `ui.dragInProgress`, `panInProgress`, `marqueeInProgress`: an interaction that never ended.
- `connection`, `game.duplicateInstanceIds`, `recentActions`: state and network at that moment.

The snapshot holds card instance ids and counts, not card names — except that the labels of
on-screen cards (which include their names) appear in the `page` section.

