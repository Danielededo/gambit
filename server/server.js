// Gambit server: serves the static client and hosts online games over
// WebSocket. Run with `npm start` (see README). Everything is in memory —
// restarting the server ends ongoing online games.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { GameManager, GameError, MAX_ACTIVE_GAMES } from "./game-manager.js";

const PORT = Number(process.env.PORT) || 8080;
const CLIENT_DIR = resolve(fileURLToPath(new URL("../client/", import.meta.url)));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

const manager = new GameManager();

// --- Static file serving ---

const httpServer = createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, activeGames: manager.activeCount(), maxGames: MAX_ACTIVE_GAMES }));
    return;
  }

  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const relative = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const filePath = resolve(join(CLIENT_DIR, relative));
  if (filePath !== CLIENT_DIR && !filePath.startsWith(CLIENT_DIR + sep)) {
    res.writeHead(403).end();
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
});

// --- WebSocket protocol ---
// Client -> server: create | join {pin} | resume {token} | move {from,to,promotion} | resign
// Server -> client: created {pin,token} + state | joined {token} + state | state | error {code,message}

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", (socket) => {
  // The seat this socket occupies once created/joined/resumed.
  let seat = null; // { game, color }

  const send = (payload) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
  };
  const sendError = (code, message) => send({ type: "error", code, message });

  const attach = (game, color) => {
    seat = { game, color };
    const existing = game.players[color].socket;
    if (existing && existing !== socket) existing.close(4000, "replaced by a new connection");
    game.players[color].socket = socket;
  };

  const broadcastState = (game) => {
    for (const color of ["w", "b"]) {
      const player = game.players[color];
      if (player && player.socket && player.socket.readyState === player.socket.OPEN) {
        player.socket.send(JSON.stringify(game.stateFor(color)));
      }
    }
  };

  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      sendError("bad_message", "Messages must be JSON");
      return;
    }

    try {
      switch (msg.type) {
        case "create": {
          if (seat) throw new GameError("already_seated", "This connection is already in a game");
          const game = manager.createGame();
          attach(game, "w");
          send({ type: "created", pin: game.pin, token: game.players.w.token });
          send(game.stateFor("w"));
          break;
        }
        case "join": {
          if (seat) throw new GameError("already_seated", "This connection is already in a game");
          const game = manager.joinGame(msg.pin);
          attach(game, "b");
          send({ type: "joined", token: game.players.b.token });
          broadcastState(game);
          break;
        }
        case "resume": {
          if (seat) throw new GameError("already_seated", "This connection is already in a game");
          const found = manager.resume(msg.token);
          attach(found.game, found.color);
          send({ type: "resumed", token: msg.token });
          broadcastState(found.game);
          break;
        }
        case "move": {
          if (!seat) throw new GameError("no_game", "Create, join, or resume a game first");
          seat.game.playMove(seat.color, { from: msg.from, to: msg.to, promotion: msg.promotion });
          broadcastState(seat.game);
          break;
        }
        case "resign": {
          if (!seat) throw new GameError("no_game", "Create, join, or resume a game first");
          seat.game.resign(seat.color);
          broadcastState(seat.game);
          break;
        }
        default:
          sendError("unknown_type", `Unknown message type: ${String(msg.type)}`);
      }
    } catch (error) {
      if (error instanceof GameError) {
        sendError(error.code, error.message);
      } else {
        console.error(error);
        sendError("internal", "Internal server error");
      }
    }
  });

  socket.on("close", () => {
    if (!seat) return;
    const { game, color } = seat;
    if (game.players[color].socket === socket) {
      game.players[color].socket = null;
      game.touch();
      broadcastState(game); // tells the opponent you disconnected
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Gambit listening on http://localhost:${PORT} (max ${MAX_ACTIVE_GAMES} concurrent games)`);
});
