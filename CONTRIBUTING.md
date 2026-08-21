# Contributing to Gambit

```bash
git clone https://github.com/Danielededo/gambit.git && cd gambit
npm install && npm start
```

Open http://localhost:8080 — that's the full app (local + online play). For frontend-only work a static server also does: `python -m http.server -d client`.

## Layout & conventions

- `client/` — static frontend, vanilla JavaScript (ES modules), no build step: rules in `js/game.js`, rendering in `js/board.js`, engine in `js/ai.js`, online play in `js/online.js`, themes/pieces in `js/theme.js` / `js/pieces.js`.
- `server/` — Node.js game server (`server.js` transport + static files, `game-manager.js` game state). It is the authority on the rules: never trust the client.
- Everything in English; format with Prettier defaults (`npx prettier --write client/js server`).
- Vendored code goes to `client/js/vendor/` together with its license file.

## Testing (manual)

Before a PR, verify: a game vs the AI finishes without console errors; castling, en passant, and the promotion picker work; check/checkmate/stalemate show in the status bar; every theme and piece set renders (switch mid-game); preferences survive a reload; the layout holds at ~375px width. For online play: create/join with a PIN in two browser tabs, play moves both ways (Black sees a flipped board), reload one tab mid-game and confirm it resumes, leave and confirm the opponent is notified.

## Add a theme

Copy `client/styles/themes/light.css` to `<name>.css` and adjust — **define every variable**, themes are swapped whole. Register the name in `THEMES` (`client/js/theme.js`) and in the inline theme list in `client/index.html`. Check piece contrast on both square colors.

## Add a piece set

Create `client/assets/pieces/<name>/pieces.svg`: one sprite, 40×40 viewBox, one group per piece with ids `wk wq wr wb wn wp bk bq br bb bn bp` (see `minimal/pieces.svg` for a template that shares shapes between colors). Register it in `PIECE_SETS` (`client/js/pieces.js`). Only use artwork you have rights to, and state its license in the sprite's header comment.

## Bugs & ideas

[Open an issue](https://github.com/Danielededo/gambit/issues) with what you did, what you expected, browser/OS, and any console errors. Roadmap contributions (see [README](README.md#roadmap)) are especially welcome.

By contributing you agree your contributions are licensed under the [MIT License](LICENSE).
