// Online game state. The server is the single authority on the rules:
// every move is validated here with chess.js, whatever the client claims.
// Phase 1 keeps everything in memory; persistence comes later.

import { randomInt, randomUUID } from "node:crypto";
import { Chess } from "../client/js/vendor/chess.js";

export const MAX_ACTIVE_GAMES = Number(process.env.MAX_ACTIVE_GAMES) || 20;

const WAITING_TTL_MS = 30 * 60 * 1000; // waiting game with no opponent
const FINISHED_TTL_MS = 10 * 60 * 1000; // finished game kept for late clients
const ABANDON_MS = 5 * 60 * 1000; // both players disconnected mid-game

export class GameManager {
  constructor() {
    /** @type {Map<string, Game>} pin -> game */
    this.byPin = new Map();
    /** @type {Map<string, {game: Game, color: string}>} player token -> seat */
    this.byToken = new Map();
    this.sweeper = setInterval(() => this.sweep(), 60 * 1000);
    this.sweeper.unref?.();
  }

  activeCount() {
    return this.byPin.size;
  }

  createGame() {
    if (this.byPin.size >= MAX_ACTIVE_GAMES) {
      throw new GameError("server_full", "Too many games in progress, try again later");
    }
    let pin;
    do {
      pin = String(randomInt(0, 1000000)).padStart(6, "0");
    } while (this.byPin.has(pin));

    const game = new Game(pin);
    this.byPin.set(pin, game);
    this.byToken.set(game.players.w.token, { game, color: "w" });
    return game;
  }

  joinGame(pin) {
    const game = this.byPin.get(String(pin));
    if (!game) throw new GameError("not_found", "No game with that PIN");
    if (game.players.b) throw new GameError("full", "That game already has two players");
    if (game.status !== "waiting") throw new GameError("not_joinable", "That game cannot be joined");

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
  }

  stop() {
    clearInterval(this.sweeper);
  }
}

export class Game {
  constructor(pin) {
    this.pin = pin;
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
