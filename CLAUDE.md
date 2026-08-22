# Gambit — project notes for Claude

## Git conventions

- Default branch: `main`. Feature work happens on dedicated branches; keep `main` deployable.
- Commit author for all commits made by Claude: name `danielededo`, email as set in the repository's local git config (`git config user.email`). Never write personal email addresses into repository files; where attribution in a file is needed, use the full name "Daniele De Dominicis" at most.
- Deployment: GitHub Pages via `.github/workflows/deploy.yml` publishes the static `client/` only (local modes). Full deployment (online play) needs a Node host running `npm start`.

## Project conventions

- `client/`: vanilla JavaScript (ES modules), no frameworks, no build tools; all code and docs in English.
- `server/`: Node.js (>=20, ESM), dependency-light (`ws` only). The server is authoritative on the rules — every online move is re-validated server-side with chess.js; never trust the client. Online games are in memory; `MAX_ACTIVE_GAMES` caps parallel games.
- Vendored dependencies live in `client/js/vendor/` with their license files (chess.js BSD-2-Clause, Stockfish GPLv3). The server imports chess.js from the client's vendored copy — single source of truth.
- Piece sets are single SVG sprites in `client/assets/pieces/<set>/pieces.svg` (40×40 viewBox, ids `wk…bp`); themes are complete CSS-variable files in `client/styles/themes/`.
- Testing is manual gameplay testing; see the checklist in CONTRIBUTING.md. For automated checks during development, drive the app with Playwright (Chromium) against `npm start`, and exercise the WebSocket protocol directly with the `ws` client.
