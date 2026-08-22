// Online game state. The server is the single authority on the rules:
// every move is validated here with chess.js, whatever the client claims.
// Phase 1 keeps everything in memory; persistence comes later.

import { randomInt, randomUUID } from "node:crypto";
import { Chess } from "../client/js/vendor/chess.js";

export const MAX_ACTIVE_GAMES = Number(process.env.MAX_ACTIVE_GAMES) || 20;
// Per-IP cap on live (waiting or active) games a single client may own, so
// one person cannot open many connections and exhaust the global cap.
export const MAX_GAMES_PER_IP = Number(process.env.MAX_GAMES_PER_IP) || 3;

// PIN brute-force throttle: after this many failed joins from one IP within
// the window, further joins are refused until the window elapses.
const JOIN_FAILURE_LIMIT = Number(process.env.JOIN_FAILURE_LIMIT) || 10;
const JOIN_FAILURE_WINDOW_MS = 60 * 1000;

const WAITING_TTL_MS = 30 * 60 * 1000; // waiting game with no opponent
const FINISHED_TTL_MS = 10 * 60 * 1000; // finished game kept for late clients
const ABANDON_MS = 5 * 60 * 1000; // both players disconnected mid-game

export class GameManager {
  constructor() {
    /** @type {Map<string, Game>} pin -> game */
    this.byPin = new Map();
    /** @type {Map<string, {game: Game, color: string}>} player token -> seat */
    this.byToken = new Map();
    /** @type {Map<string, {count: number, first: number}>} ip -> recent join failures */
    this.joinFailures = new Map();
    this.sweeper = setInterval(() => this.sweep(), 60 * 1000);
    this.sweeper.unref?.();
  }

  activeCount() {
    return this.byPin.size;
  }

  /** Live games (not finished) owned by an IP. */
  gamesOwnedBy(ip) {
    let n = 0;
    for (const game of this.byPin.values()) {
      if (game.ownerIp === ip && game.status !== "finished") n += 1;
    }
    return n;
  }

  createGame(ownerIp) {
    if (this.byPin.size >= MAX_ACTIVE_GAMES) {
      throw new GameError("server_full", "Too many games in progress, try again later");
    }
    if (ownerIp && this.gamesOwnedBy(ownerIp) >= MAX_GAMES_PER_IP) {
      throw new GameError("too_many_games", "You already have too many open games; finish or leave one first");
    }
    let pin;
    do {
      pin = String(randomInt(0, 1000000)).padStart(6, "0");
    } while (this.byPin.has(pin));

    const game = new Game(pin, ownerIp);
    this.byPin.set(pin, game);
    this.byToken.set(game.players.w.token, { game, color: "w" });
    return game;
  }

  /** True while an IP is locked out for too many failed join attempts. */
  isJoinBlocked(ip, now = Date.now()) {
    const rec = this.joinFailures.get(ip);
    if (!rec) return false;
    if (now - rec.first > JOIN_FAILURE_WINDOW_MS) {
      this.joinFailures.delete(ip);
      return false;
    }
    return rec.count >= JOIN_FAILURE_LIMIT;
  }

  recordJoinFailure(ip, now = Date.now()) {
    const rec = this.joinFailures.get(ip);
    if (!rec || now - rec.first > JOIN_FAILURE_WINDOW_MS) {
      this.joinFailures.set(ip, { count: 1, first: now });
    } else {
      rec.count += 1;
    }
  }

  joinGame(pin, joinerIp) {
    if (joinerIp && this.isJoinBlocked(joinerIp)) {
      throw new GameError("too_many_attempts", "Too many failed attempts; wait a minute and try again");
    }
    const game = this.byPin.get(String(pin));
    if (!game || game.players.b || game.status !== "waiting") {
      // One opaque error for every miss so probing can't distinguish a wrong
      // PIN from a full or in-progress game.
      if (joinerIp) this.recordJoinFailure(joinerIp);
      throw new GameError("not_found", "No joinable game with that PIN");
    }

    game.players.b = { token: randomUUID(), socket: null };
    game.status = "active";
    game.touch();
    this.byToken.set(game.players.b.token, { game, color: "b" });
    return game;
  }

  resume(token) {
    const seat = this.byToken.get(token);
    if (!seat) throw new GameError("not_found", "Unknown or expired game");
    return seat;
  }

  removeGame(game) {
    this.byPin.delete(game.pin);
    this.byToken.delete(game.players.w.token);
    if (game.players.b) this.byToken.delete(game.players.b.token);
  }

  /** Drop expired games so PINs and the game cap free up. */
  sweep(now = Date.now()) {
    for (const game of this.byPin.values()) {
      const age = now - game.lastActivity;
      const expired =
        (game.status === "waiting" && age > WAITING_TTL_MS) ||
        (game.status === "finished" && age > FINISHED_TTL_MS) ||
        (game.status === "active" && age > ABANDON_MS && !game.anyoneConnected());
      if (expired) this.removeGame(game);
    }
    for (const [ip, rec] of this.joinFailures) {
      if (now - rec.first > JOIN_FAILURE_WINDOW_MS) this.joinFailures.delete(ip);
    }
  }

  stop() {
    clearInterval(this.sweeper);
  }
}

export class Game {
  constructor(pin, ownerIp = null) {
    this.pin = pin;
    this.ownerIp = ownerIp; // IP that created the game (per-IP cap accounting)
    this.chess = new Chess();
    this.status = "waiting"; // waiting | active | finished
    this.result = null; // { winner: "w"|"b"|null, reason: string }
    this.players = {
      w: { token: randomUUID(), socket: null },
      b: null,
    };
    this.lastActivity = Date.now();
  }

  touch() {
    this.lastActivity = Date.now();
  }

  anyoneConnected() {
    return Boolean(this.players.w.socket) || Boolean(this.players.b && this.players.b.socket);
  }

  opponentOf(color) {
    return color === "w" ? this.players.b : this.players.w;
  }

  /** Validate and play a move for `color`. Throws GameError when illegal. */
  playMove(color, { from, to, promotion }) {
    if (this.status !== "active") throw new GameError("not_active", "The game is not in progress");
    if (this.chess.turn() !== color) throw new GameError("not_your_turn", "It is not your turn");

    let move;
    try {
      move = this.chess.move({ from, to, promotion: promotion || undefined });
    } catch {
      throw new GameError("illegal_move", "Illegal move");
    }
    this.touch();

    if (this.chess.isGameOver()) {
      this.status = "finished";
      if (this.chess.isCheckmate()) {
        this.result = { winner: color, reason: "checkmate" };
      } else {
        this.result = { winner: null, reason: drawReason(this.chess) };
      }
    }
    return move;
  }

  resign(color) {
    if (this.status === "finished") return;
    this.status = "finished";
    this.result = { winner: color === "w" ? "b" : "w", reason: "resignation" };
    this.touch();
  }

  abandon(color) {
    if (this.status === "finished") return;
    this.status = "finished";
    this.result = { winner: color === "w" ? "b" : "w", reason: "abandonment" };
    this.touch();
  }

  /** Full authoritative state, personalized with the receiver's color. */
  stateFor(color) {
    const history = this.chess.history({ verbose: true });
    const last = history[history.length - 1];
    return {
      type: "state",
      yourColor: color,
      pin: this.pin,
      status: this.status,
      result: this.result,
      fen: this.chess.fen(),
      turn: this.chess.turn(),
      inCheck: this.chess.inCheck(),
      history: this.chess.history(),
      lastMove: last ? { from: last.from, to: last.to } : null,
      opponentConnected: Boolean(this.opponentOf(color)?.socket),
    };
  }
}

export class GameError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function drawReason(chess) {
  if (chess.isStalemate()) return "stalemate";
  if (chess.isThreefoldRepetition()) return "threefold repetition";
  if (chess.isInsufficientMaterial()) return "insufficient material";
  return "draw";
}
