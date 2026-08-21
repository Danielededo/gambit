# Gambit — project notes for Claude

## Git conventions

- Default branch: `main`. Feature work happens on dedicated branches; keep `main` deployable.
- Commit author for all commits made by Claude: `danielededo`.
- Deployment: GitHub Pages via `.github/workflows/deploy.yml` — every push to `main` publishes the repository root. No build step.

## Project conventions

- Vanilla JavaScript (ES modules), no frameworks, no build tools; all code and docs in English.
- Vendored dependencies live in `js/vendor/` with their license files (chess.js BSD-2-Clause, Stockfish GPLv3).
- Piece sets are single SVG sprites in `assets/pieces/<set>/pieces.svg` (40×40 viewBox, ids `wk…bp`); themes are complete CSS-variable files in `styles/themes/`.
- Testing is manual gameplay testing; see the checklist in CONTRIBUTING.md.
