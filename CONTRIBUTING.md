# Contributing to Gambit

Thanks for your interest in improving Gambit! This document explains the project conventions and the most common ways to contribute.

## Getting started

```bash
git clone https://github.com/Danielededo/gambit.git
cd gambit
python -m http.server   # or: npx serve
```

Open http://localhost:8000 and you are ready — there is no build step and no dependency install.

## Code style

- Vanilla JavaScript (ES modules), HTML5, CSS3 — no frameworks, no build tools.
- Format JavaScript with [Prettier](https://prettier.io/) defaults (`npx prettier --write js/`).
- All code, comments, and documentation in English.
- Keep modules focused: game rules in `game.js`, rendering in `board.js`, engine code in `ai.js`, and so on.
- Prefer small, dependency-free solutions; anything vendored goes to `js/vendor/` with its license file.

## Testing

Testing is manual gameplay testing. Before opening a PR, verify at least:

1. A full game vs the AI at difficulty 1 finishes without console errors.
2. Human vs Human mode: castling, en passant, and pawn promotion (the picker must appear).
3. Check, checkmate, and stalemate are reported in the status bar.
4. Every theme and every piece set renders correctly (switch them mid-game).
5. Preferences survive a page reload.
6. The layout works at mobile width (~375px).

## How to add a new theme

1. Create `styles/themes/<name>.css` by copying `light.css` and adjusting the values. **Define every variable** — themes are swapped whole, there is no fallback layer.
2. Register the theme in `js/theme.js` (`THEMES` map).
3. Add the theme name to the FOUC-prevention list in the inline script in `index.html`.
4. Check contrast: pieces must be readable on both square colors, in both piece colors.

## How to add a new piece set

1. Create `assets/pieces/<name>/pieces.svg`: a single SVG sprite with a 40×40 viewBox containing one group per piece with ids `wk, wq, wr, wb, wn, wp, bk, bq, br, bb, bn, bp`. Look at `assets/pieces/minimal/pieces.svg` for a template that shares shapes between the two colors.
2. Register the set in `js/pieces.js` (`PIECE_SETS` map).
3. Only use artwork you have the rights to, and state its license in a comment at the top of the sprite file.

## Reporting bugs

Open a [GitHub issue](https://github.com/Danielededo/gambit/issues) including:

- What you did (moves played, controls used) and what you expected.
- Browser and OS.
- Any errors from the browser console (F12 → Console).
- A screenshot if the problem is visual.

## Future feature ideas

Contributions towards the roadmap in the [README](README.md#roadmap) are especially welcome: multiplayer with PIN, move replay, engine analysis, timers, ELO tracking, animations, sounds, board flip, PGN import, tournaments.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
