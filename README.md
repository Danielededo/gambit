# Gambit ♞

Chess in the browser: play against Stockfish, a friend on the same device, or **online with a 6-digit PIN** — no accounts, no tracking.

**▶ Play online (all modes): https://gambit-gky7.onrender.com** &nbsp;·&nbsp; single-player is also on [GitHub Pages](https://danielededo.github.io/gambit/)

[![Live site](https://img.shields.io/website?url=https%3A%2F%2Fgambit-gky7.onrender.com&label=render&up_message=live&down_message=asleep)](https://gambit-gky7.onrender.com)

> The online host is on a free plan that sleeps after ~15 min idle — the first visit then takes ~30s to wake.

![Gambit — mid-game against the AI](client/assets/screenshots/gameplay.png)

## Features

- **Three modes** — Human vs AI, Human vs Human (same device), Online via PIN
- **Difficulty 1-8** — Stockfish 18 running locally in your browser, from beginner to full strength
- **Full rules** — castling, en passant, promotion (with piece picker), check/checkmate/stalemate/draws, powered by [chess.js](https://github.com/jhlywa/chess.js)
- **Fair online play** — the server validates every move; reconnect and resume after a page reload
- **Helpful board** — legal-move highlighting, last-move marker, move history in algebraic notation
- **Your look** — 4 themes × 4 piece sets, remembered across visits

| Light · Standard | Dark · Medieval | Blue · Minimal | Sepia · Unicode |
|:---:|:---:|:---:|:---:|
| ![Light theme, standard pieces](client/assets/screenshots/light-standard.png) | ![Dark theme, medieval pieces](client/assets/screenshots/dark-medieval.png) | ![Blue theme, minimal pieces](client/assets/screenshots/blue-minimal.png) | ![Sepia theme, unicode pieces](client/assets/screenshots/sepia-unicode.png) |

## How to play

Click a piece, then one of its highlighted destinations. Pick mode, difficulty, theme, and pieces from the header — **New game** restarts anytime.

**Online:** choose *Online (PIN)*, press *Create game*, and share the 6-digit PIN; your friend joins with it and plays Black (board flipped on their side). Closing the tab by accident? Reload and the game resumes. The server hosts a limited number of parallel games.

![Online game — waiting for the opponent with the PIN on screen](client/assets/screenshots/online-pin.png)

## Run locally

```bash
npm install && npm start   # full app (local + online play) on http://localhost:8080
```

Static-only alternative (local modes, no online): `python -m http.server -d client` — an HTTP server is required either way, ES modules and the Stockfish worker don't run from `file://`.

## Architecture & deployment

- `client/` — static frontend (vanilla JS, no build step). Runs anywhere; Stockfish plays in the visitor's browser.
- `server/` — Node.js WebSocket server for online games: it serves `client/` and is the authority on the rules (every move re-validated server-side). In-memory for now, `MAX_ACTIVE_GAMES` caps parallel games (default 20).

Full deployment needs a Node host (`npm start`, honors `PORT`). The GitHub Pages workflow ([`deploy.yml`](.github/workflows/deploy.yml)) publishes the static client only — local modes work there, online play does not. The client detects this at runtime (a `/healthz` probe) and **hides the Online option when no server is present**, so the same codebase ships as two releases: a static single-player build (Pages) and the full app (a Node host).

### Deploy the server on Render (free)

The repo ships a [`render.yaml`](render.yaml) blueprint:

1. Push to GitHub, then in [Render](https://render.com) → **New + → Blueprint** → pick this repo.
2. Render reads `render.yaml`, builds with `npm install`, starts with `npm start`, and health-checks `/healthz`. `TRUST_PROXY=1` is set for you.
3. The app is served at `https://<name>.onrender.com` — local **and** online modes, over `wss://` automatically.

**Cost:** the free web-service plan is free with no time limit, but it **sleeps after ~15 minutes without traffic** — the next visit takes ~30s to wake, and any in-memory online game is lost on wake. That's the trade-off for paying nothing; persistence (roadmap) removes the data-loss part, and a paid plan (or a keep-alive ping) removes the sleep. Any other Node host works too — just set `TRUST_PROXY=1`.

### Server configuration

All optional, set via environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP/WebSocket port |
| `MAX_ACTIVE_GAMES` | `20` | Global cap on concurrent online games |
| `MAX_GAMES_PER_IP` | `3` | Live games one client (IP) may own — stops one person exhausting the global cap |
| `MAX_CONNECTIONS_PER_IP` | `20` | Concurrent WebSocket connections per IP |
| `JOIN_FAILURE_LIMIT` | `10` | Failed PIN joins per IP per minute before a short lockout (anti brute-force) |
| `ALLOWED_ORIGINS` | same-origin | Comma-separated origins allowed to open control sockets |
| `HEARTBEAT_MS` | `30000` | WebSocket ping interval; keeps connections alive through proxies and detects dead sockets |
| `TRUST_PROXY` | `0` | Set to `1` when behind a proxy/load balancer so the client IP is read from `X-Forwarded-For` |

See [`.env.example`](.env.example) for a copy-ready template. The server shuts down cleanly on `SIGTERM`/`SIGINT` (redeploys, Ctrl-C).

> **Behind a proxy (Render, Fly, Railway, …): set `TRUST_PROXY=1`.** Otherwise every request appears to come from the proxy's IP and the per-IP limits apply to all players at once.

## Roadmap

Persistence for online games (SQLite) · accounts & ELO · replay & PGN import · engine analysis · timers · animations & sounds · play as Black vs AI.

## Contributing & license

See [CONTRIBUTING.md](CONTRIBUTING.md) — adding a theme or a piece set is a one-file job.

Project code is [MIT](LICENSE). Vendored components keep their own licenses: chess.js (BSD-2-Clause), [Stockfish.js](https://github.com/nmrugg/stockfish.js) (GPLv3), standard piece SVGs by [Cburnett et al.](https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces/Standard) (CC BY-SA 3.0); medieval and minimal sets are original MIT artwork.
