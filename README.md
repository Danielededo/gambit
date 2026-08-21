# Gambit ♞

Interactive chess game playable in the browser. Frontend only — no backend, no accounts.

> **Status: work in progress.** Board rendering and move validation are done; AI opponent, themes, and piece sets are coming next.

## Play locally

No build step required. Serve the folder with any static server:

```bash
python -m http.server
# or
npx serve
```

Then open http://localhost:8000 (or the port shown).

> Note: opening `index.html` directly from the filesystem will not work because ES modules require an HTTP origin.

## Current features

- 8×8 chessboard with Unicode pieces
- Click-based moves with legal-move highlighting
- Full rules via [chess.js](https://github.com/jhlywa/chess.js): check, checkmate, stalemate, draws
- Move history in standard algebraic notation
- Game status display and reset button

## Roadmap

- Human vs AI with adjustable difficulty (Stockfish)
- Theme system (light, dark, blue, sepia)
- Multiple piece sets (standard SVG, medieval, minimal, Unicode)
- Multiplayer with PIN, game replay, PGN import, sounds, timers

## License

MIT — see [LICENSE](LICENSE).

## Authors

- danielededo
- Claude
