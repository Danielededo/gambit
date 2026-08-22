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

// Behind a proxy/load balancer (Render, Fly, etc.) the real client IP is in
// X-Forwarded-For. Only trust it when explicitly enabled, otherwise a client
// could spoof its IP to bypass the per-IP caps.
const TRUST_PROXY = process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true";
// Comma-separated exact origins allowed to open control WebSockets. When
// unset, same-origin requests (Origin host === Host) and non-browser clients
// (no Origin header) are allowed — which is correct for a single-origin deploy.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
const MAX_CONNECTIONS_PER_IP = Number(process.env.MAX_CONNECTIONS_PER_IP) || 20;
const MAX_MESSAGE_BYTES = 4 * 1024;

/** Client IP for rate/quota accounting. */
function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers["x-forwarded-for"];
    if (xff) return String(xff).split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

/** Whether a browser Origin may open a control WebSocket. */
function isAllowedOrigin(origin, host) {
  if (!origin) return true; // non-browser client (no ambient credentials to abuse)
  if (ALLOWED_ORIGINS.length > 0) return ALLOWED_ORIGINS.includes(origin);
  try {
    return new URL(origin).host === host; // same-origin as the page we served
  } catch {
    return false;
  }
}

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

// Entry files must never be served stale, or a redeploy leaves visitors on an
// old shell/module until they hard-refresh. These always revalidate; heavier
// assets (wasm/images) whose contents effectively don't change get cached.
const REVALIDATE_EXT = new Set([".html", ".js", ".css", ".json"]);
function cacheControlFor(ext) {
  if (REVALIDATE_EXT.has(ext)) return "no-cache";
  return "public, max-age=86400"; // svg, png, wasm, ico, txt
}

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
    const ext = extname(filePath);
    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": cacheControlFor(ext),
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
});

// --- WebSocket protocol ---
// Client -> server: create | join {pin} | resume {token} | move {from,to,promotion} | resign
//                   | chat {text} | draw_offer | draw_accept | draw_decline
//                   | rematch_offer | rematch_accept | rematch_decline
// Server -> client: created {pin,token} + state | joined {token} + state | state
//                   | chat {from,text} | error {code,message}

const wss = new WebSocketServer({
  server: httpServer,
  path: "/ws",
  maxPayload: MAX_MESSAGE_BYTES,
  verifyClient: ({ origin, req }) => isAllowedOrigin(origin, req.headers.host),
});

// Live WebSocket connections per IP, to bound how many sockets one client
// can hold open at once.
const connectionsPerIp = new Map();

wss.on("connection", (socket, request) => {
  const ip = clientIp(request);
  const openForIp = connectionsPerIp.get(ip) || 0;
  if (openForIp >= MAX_CONNECTIONS_PER_IP) {
    socket.close(4429, "Too many connections");
    return;
  }
  connectionsPerIp.set(ip, openForIp + 1);

  // Heartbeat: mark alive on any pong; the interval below terminates sockets
  // that miss a round, so half-open connections (dropped by a proxy without a
  // close frame) are detected instead of lingering as "connected".
  socket.isAlive = true;
  socket.on("pong", () => {
    socket.isAlive = true;
  });

  // The seat this socket occupies once created/joined/resumed. The color is
  // derived from the token on every use because a rematch swaps colors.
  let seat = null; // { game, token }
  const seatColor = () => seat.game.colorOf(seat.token);

  const send = (payload) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
  };
  const sendError = (code, message) => send({ type: "error", code, message });

  const attach = (game, token) => {
    seat = { game, token };
    const player = game.players[game.colorOf(token)];
    if (player.socket && player.socket !== socket) {
      player.socket.close(4000, "replaced by a new connection");
    }
    player.socket = socket;
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
          const game = manager.createGame(ip);
          attach(game, game.players.w.token);
          send({ type: "created", pin: game.pin, token: game.players.w.token });
          send(game.stateFor("w"));
          break;
        }
        case "join": {
          if (seat) throw new GameError("already_seated", "This connection is already in a game");
          const game = manager.joinGame(msg.pin, ip);
          attach(game, game.players.b.token);
          send({ type: "joined", token: game.players.b.token });
          broadcastState(game);
          break;
        }
        case "resume": {
          if (seat) throw new GameError("already_seated", "This connection is already in a game");
          const found = manager.resume(msg.token);
          attach(found.game, msg.token);
          send({ type: "resumed", token: msg.token });
          broadcastState(found.game);
          break;
        }
        case "move": {
          if (!seat) throw new GameError("no_game", "Create, join, or resume a game first");
          seat.game.playMove(seatColor(), { from: msg.from, to: msg.to, promotion: msg.promotion });
          broadcastState(seat.game);
          break;
        }
        case "resign": {
          if (!seat) throw new GameError("no_game", "Create, join, or resume a game first");
          seat.game.resign(seatColor());
          broadcastState(seat.game);
          break;
        }
        case "chat": {
          if (!seat) throw new GameError("no_game", "Create, join, or resume a game first");
          const color = seatColor();
          const text = seat.game.chatFrom(color, msg.text);
          const opponent = seat.game.opponentOf(color);
          if (opponent && opponent.socket && opponent.socket.readyState === opponent.socket.OPEN) {
            opponent.socket.send(JSON.stringify({ type: "chat", from: color, text }));
          }
          break;
        }
        case "draw_offer": {
          if (!seat) throw new GameError("no_game", "Create, join, or resume a game first");
          seat.game.offerDraw(seatColor());
          broadcastState(seat.game);
          break;
        }
        case "draw_accept": {
          if (!seat) throw new GameError("no_game", "Create, join, or resume a game first");
          seat.game.acceptDraw(seatColor());
          broadcastState(seat.game);
          break;
        }
        case "draw_decline": {
          if (!seat) throw new GameError("no_game", "Create, join, or resume a game first");
          seat.game.declineDraw(seatColor());
          broadcastState(seat.game);
          break;
        }
        case "rematch_offer": {
          if (!seat) throw new GameError("no_game", "Create, join, or resume a game first");
          seat.game.offerRematch(seatColor());
          broadcastState(seat.game);
          break;
        }
        case "rematch_accept": {
          if (!seat) throw new GameError("no_game", "Create, join, or resume a game first");
          seat.game.acceptRematch(seatColor());
          broadcastState(seat.game);
          break;
        }
        case "rematch_decline": {
          if (!seat) throw new GameError("no_game", "Create, join, or resume a game first");
          seat.game.declineRematch(seatColor());
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
    const remaining = (connectionsPerIp.get(ip) || 1) - 1;
    if (remaining > 0) connectionsPerIp.set(ip, remaining);
    else connectionsPerIp.delete(ip);

    if (!seat) return;
    const { game } = seat;
    const color = seatColor();
    if (color && game.players[color].socket === socket) {
      game.players[color].socket = null;
      game.touch();
      broadcastState(game); // tells the opponent you disconnected
    }
  });
});

// Proxies (Render, Fly, Railway, …) drop idle WebSockets after ~60s. Ping
// periodically and terminate any socket that didn't answer the previous ping.
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS) || 30 * 1000;
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, HEARTBEAT_MS);
heartbeat.unref?.();

httpServer.listen(PORT, () => {
  console.log(`Gambit listening on http://localhost:${PORT} (max ${MAX_ACTIVE_GAMES} concurrent games)`);
});

// Clean shutdown on redeploy/stop: stop timers, close sockets and the server.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down…`);
  clearInterval(heartbeat);
  manager.stop();
  // Hard-close sockets: in-memory games don't survive a restart anyway and
  // clients auto-reconnect, so there's nothing to drain gracefully.
  for (const socket of wss.clients) socket.terminate();
  httpServer.close(() => process.exit(0));
  httpServer.closeAllConnections?.(); // drop lingering keep-alive HTTP conns
  // Backstop in case a connection lingers.
  setTimeout(() => process.exit(0), 3000).unref?.();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
