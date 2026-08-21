# Contributing to Gambit

```bash
git clone https://github.com/Danielededo/gambit.git && cd gambit
python -m http.server   # or: npx serve
```

No build step, no dependencies. Open http://localhost:8000 and you're running.

## Conventions

- Vanilla JavaScript (ES modules), no frameworks or build tools; everything in English.
- Format with Prettier defaults: `npx prettier --write js/`.
- Keep modules focused — rules in `game.js`, rendering in `board.js`, engine in `ai.js`, themes in `theme.js`, piece sets in `pieces.js`.
- Vendored code goes to `js/vendor/` together with its license file.

## Testing (manual)

Before a PR, verify: a game vs the AI finishes without console errors; castling, en passant, and the promotion picker work; check/checkmate/stalemate show in the status bar; every theme and piece set renders (switch mid-game); preferences survive a reload; the layout holds at ~375px width.

## Add a theme

Copy `styles/themes/light.css` to `styles/themes/<name>.css` and adjust — **define every variable**, themes are swapped whole. Register the name in `THEMES` (`js/theme.js`) and in the inline theme list in `index.html`. Check piece contrast on both square colors.

## Add a piece set

Create `assets/pieces/<name>/pieces.svg`: one sprite, 40×40 viewBox, one group per piece with ids `wk wq wr wb wn wp bk bq br bb bn bp` (see `minimal/pieces.svg` for a template that shares shapes between colors). Register it in `PIECE_SETS` (`js/pieces.js`). Only use artwork you have rights to, and state its license in the sprite's header comment.

## Bugs & ideas

[Open an issue](https://github.com/Danielededo/gambit/issues) with what you did, what you expected, browser/OS, and any console errors. Roadmap contributions (see [README](README.md#roadmap)) are especially welcome.

By contributing you agree your contributions are licensed under the [MIT License](LICENSE).
