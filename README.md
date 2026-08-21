# Gambit ♞

Interactive chess game playable in the browser. Frontend only — no backend, no accounts, no build step.

**Live demo:** https://danielededo.github.io/gambit/ *(requires GitHub Pages to be enabled — see [Deployment](#deployment))*

## Features

- **Human vs AI** — powered by Stockfish 18 (WASM, runs entirely in your browser)
- **Human vs Human** — take turns on the same device
- **Difficulty 1-8** — from casual beginner to full engine strength
- **4 themes** — Light, Dark, Blue, Sepia
- **4 piece sets** — Standard, Medieval, Minimal, Unicode
- Legal-move highlighting, last-move highlighting, move history in algebraic notation
- Full rules via [chess.js](https://github.com/jhlywa/chess.js): check, checkmate, stalemate, draws, castling, en passant, promotion (with piece picker)
- Preferences (theme, piece set, mode, difficulty) persist in `localStorage`

## How to play

1. Pick a **Mode**: *Human vs AI* (you play White) or *Human vs Human*.
2. In AI mode, set the **Difficulty** slider (1 = beginner, 8 = strongest). The level combines Stockfish's Skill Level, search depth, and thinking time.
3. Click a piece to select it — legal destinations are highlighted — then click the destination square.
4. When a pawn reaches the last rank, a picker appears to choose the promotion piece.
5. **New game** resets the board at any time.

## Customization

- **Theme**: use the *Theme* dropdown in the header. Themes are pure CSS variable sets in `styles/themes/`; your choice is saved and restored on the next visit.
- **Pieces**: use the *Pieces* dropdown. SVG sets live in `assets/pieces/<set>/pieces.svg` as sprites; the Unicode set needs no assets at all.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add your own themes and piece sets.

## Local development

No build step, no dependencies to install. Serve the folder with any static server:

```bash
python -m http.server
# or
npx serve
```

Then open http://localhost:8000 (or the port shown).

> Opening `index.html` directly from the filesystem will not work: ES modules and the Stockfish Web Worker require an HTTP origin.

## Deployment

The site is deployed with GitHub Pages via GitHub Actions, no build required:

1. Repository **Settings → Pages** → Source: *GitHub Actions*.
2. Every push to `main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which publishes the repository root as-is.
3. The game is served at `https://<user>.github.io/gambit/`.

## Project structure

```
index.html          entry page and controls
styles/main.css     layout and board styles (theme-agnostic)
styles/themes/      one CSS-variable file per theme
js/main.js          wiring: controls, AI orchestration
js/game.js          game state (chess.js wrapper)
js/board.js         board rendering, move input, promotion picker
js/ai.js            Stockfish worker, difficulty mapping
js/theme.js         theme switching + persistence
js/pieces.js        piece set switching + rendering
js/vendor/          vendored chess.js and Stockfish builds
assets/pieces/      SVG sprite per piece set
```

## Roadmap

- Multiplayer with PIN (requires backend)
- Game history / replay moves
- Engine analysis (best move suggestions)
- Move timer / blitz modes
- ELO rating system
- Move animations and sound effects
- Play as Black vs AI (board flip)
- Import PGN files
- Tournaments

## License

The project code is released under the [MIT License](LICENSE).

Bundled third-party components keep their own licenses:

- [chess.js](https://github.com/jhlywa/chess.js) — BSD-2-Clause (`js/vendor/chess.js.LICENSE`)
- [Stockfish.js](https://github.com/nmrugg/stockfish.js) — GPLv3 (`js/vendor/stockfish/Copying.txt`)
- Standard piece set — SVGs by Cburnett et al. from [Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces/Standard), CC BY-SA 3.0, via [cm-chessboard](https://github.com/shaack/cm-chessboard) (license header inside the sprite file)
- Medieval and Minimal piece sets — original artwork for this project, MIT
