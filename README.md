# DoubleStrike

A Magic: The Gathering deck builder and playtest virtual tabletop. Runs as a
desktop app (Electron) or in the browser. Everything is stored locally — no
accounts, no server, no telemetry.

## Features

**Deck building**

- Card search backed by the Scryfall API, with advanced filters
- Import from Archidekt plain text, `.dec`, MTG Arena, and MTGO; export to all four
- Alternate art / printing selection per card, with optional foil shaders
- Categories, color-coded card marks, undo/redo
- Stats: mana curve, color pip distribution, pip-accurate castability, format
  legality, mana base recommendations, USD prices, and EDHREC salt scores
- "Find similar cards" driven by Scryfall Oracle Tags, with sortable suggestions

**Playtesting**

- Solo goldfishing, or up to 4 players over WebRTC (peer-to-peer, no game server)
- Pan/zoom battlefield with zones, counters, tokens, and face-down cards
- Scry, surveil, cascade, tutoring, and a single-level undo
- Life, commander damage, poison, dice rolls, pings, and emoji reactions
- Themes, battlefield skins, and a shared table radio

## Getting started

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Then open the printed localhost URL.

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run electron:dev` | Dev server + Electron window |
| `npm run build` | Type-check and build the web bundle |
| `npm run electron:build` | Build the packaged desktop app into `release/` |
| `npm test` | Run the test suite |
| `npm run lint` | ESLint |

Windows users can also double-click `build.bat` to produce a packaged build.

## Where your data lives

Deck and profile data is stored locally and never leaves your machine.

- **Desktop:** under the app's `userData` folder, mirrored to
  `Documents/DoubleStrike Backups` on every save
- **Browser:** IndexedDB

Card data is fetched from Scryfall's public API and cached locally.

## Tech stack

React 18, TypeScript, Vite, Electron, PeerJS for multiplayer, `idb-keyval` for
browser storage, Vitest for tests.

## Credits

- Card data and images from [Scryfall](https://scryfall.com)
- Salt scores from [EDHREC](https://edhrec.com)

## License

Source code is released under the [MIT License](LICENSE).

That license covers this repository's code only. It grants no rights to Magic:
The Gathering intellectual property — card names, rules text, mana symbols, and
card art belong to Wizards of the Coast. Card images are served by Scryfall and
are not redistributed by this project.

## Fan Content notice

DoubleStrike is unofficial Fan Content permitted under the Fan Content Policy.
Not approved/endorsed by Wizards. Portions of the materials used are property of
Wizards of the Coast. ©Wizards of the Coast LLC.
