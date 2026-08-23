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
    /** @type {Map<string, Game>} player token -> game (color derives from the
     * token at lookup time, since a rematch swaps the players' colors) */
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
    this.byToken.set(game.players.w.token, game);
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

    game.players.b = { token: randomUUID(), socket: null, chatTimes: [], departed: false };
    game.status = "active";
    game.touch();
    this.byToken.set(game.players.b.token, game);
    return game;
  }

  resume(token) {
    const game = this.byToken.get(token);
    const color = game ? game.colorOf(token) : null;
    if (!game || !color) throw new GameError("not_found", "Unknown or expired game");
    return { game, color };
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
      const bothDeparted =
        game.players.w.departed && Boolean(game.players.b && game.players.b.departed);
      const expired =
        bothDeparted ||
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

// Chat limits: plain-text only, bounded length, small sliding-window rate cap.
const CHAT_MAX_LENGTH = 500;
const CHAT_WINDOW_MS = 5000;
const CHAT_MAX_PER_WINDOW = 5;

export class Game {
  constructor(pin, ownerIp = null) {
    this.pin = pin;
    this.ownerIp = ownerIp; // IP that created the game (per-IP cap accounting)
    this.chess = new Chess();
    this.status = "waiting"; // waiting | active | finished
    this.result = null; // { winner: "w"|"b"|null, reason: string }
    this.drawOffer = null; // color with a pending draw offer, or null
    this.rematchOffer = null; // color with a pending rematch offer, or null
    this.players = {
      w: { token: randomUUID(), socket: null, chatTimes: [], departed: false },
      b: null,
    };
    this.lastActivity = Date.now();
  }

  /** Which color a player token currently holds (colors swap on rematch). */
  colorOf(token) {
    if (this.players.w.token === token) return "w";
    if (this.players.b && this.players.b.token === token) return "b";
    return null;
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
    this.drawOffer = null; // playing a move declines any pending draw offer
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
    this.drawOffer = null;
    this.touch();
  }

  /**
   * Permanently leave the game (distinct from a disconnect, which can be
   * resumed): resigns if the game is running and vacates the seat.
   */
  leave(color) {
    if (this.status === "active") this.resign(color);
    // Withdraw the leaver's pending offers so the opponent isn't left with a
    // banner that can never be accepted.
    if (this.drawOffer === color) this.drawOffer = null;
    if (this.rematchOffer === color) this.rematchOffer = null;
    const player = this.players[color];
    if (player) {
      player.departed = true;
      player.socket = null;
    }
    this.touch();
  }

  /** Throw when the opponent has permanently left (offers would be futile). */
  requireOpponentPresent(color) {
    const opponent = this.opponentOf(color);
    if (!opponent || opponent.departed) {
      throw new GameError("opponent_left", "Your opponent has left the game");
    }
  }

  /** Offer a draw; offering while the opponent's offer is pending accepts it. */
  offerDraw(color) {
    if (this.status !== "active") throw new GameError("not_active", "The game is not in progress");
    this.requireOpponentPresent(color);
    if (this.drawOffer === color) return;
    if (this.drawOffer && this.drawOffer !== color) {
      this.finishAsDraw();
      return;
    }
    this.drawOffer = color;
    this.touch();
  }

  acceptDraw(color) {
    if (this.status !== "active" || !this.drawOffer || this.drawOffer === color) {
      throw new GameError("no_offer", "There is no draw offer to accept");
    }
    this.finishAsDraw();
  }

  declineDraw(color) {
    if (this.drawOffer && this.drawOffer !== color) {
      this.drawOffer = null;
      this.touch();
    }
  }

  finishAsDraw() {
    this.status = "finished";
    this.result = { winner: null, reason: "agreement" };
    this.drawOffer = null;
    this.touch();
  }

  /** Offer a rematch; offering while the opponent's offer is pending starts it. */
  offerRematch(color) {
    if (this.status !== "finished") throw new GameError("not_finished", "Rematch is only available after the game ends");
    this.requireOpponentPresent(color);
    if (this.rematchOffer === color) return;
    if (this.rematchOffer && this.rematchOffer !== color) {
      this.startRematch();
      return;
    }
    this.rematchOffer = color;
    this.touch();
  }

  acceptRematch(color) {
    if (this.status !== "finished" || !this.rematchOffer || this.rematchOffer === color) {
      throw new GameError("no_offer", "There is no rematch offer to accept");
    }
    this.requireOpponentPresent(color);
    this.startRematch();
  }

  declineRematch(color) {
    if (this.rematchOffer && this.rematchOffer !== color) {
      this.rematchOffer = null;
      this.touch();
    }
  }

  /** Fresh board on the same PIN and connections, with colors swapped. */
  startRematch() {
    const previousWhite = this.players.w;
    this.players.w = this.players.b;
    this.players.b = previousWhite;
    this.chess = new Chess();
    this.status = "active";
    this.result = null;
    this.drawOffer = null;
    this.rematchOffer = null;
    this.touch();
  }

  /** Validate a chat message from `color`; returns the text to relay. */
  chatFrom(color, rawText) {
    if (this.status === "waiting" || !this.players.b) {
      throw new GameError("chat_no_opponent", "There is nobody to chat with yet");
    }
    this.requireOpponentPresent(color); // nobody to deliver to if they left
    const text = String(rawText ?? "").trim();
    if (!text) throw new GameError("chat_empty", "Empty message");
    if (text.length > CHAT_MAX_LENGTH) {
      throw new GameError("chat_too_long", `Messages are limited to ${CHAT_MAX_LENGTH} characters`);
    }
    const player = this.players[color];
    const now = Date.now();
    player.chatTimes = player.chatTimes.filter((t) => now - t < CHAT_WINDOW_MS);
    if (player.chatTimes.length >= CHAT_MAX_PER_WINDOW) {
      throw new GameError("chat_too_fast", "You are sending messages too quickly");
    }
    player.chatTimes.push(now);
    this.touch();
    return text;
  }

  /** Full authoritative state, personalized with the receiver's color. */
  stateFor(color) {
    // One verbose history() is enough for both the SAN list and the last move;
    // history() replays the whole game per call, so avoid calling it twice.
    const verbose = this.chess.history({ verbose: true });
    const last = verbose.length ? verbose[verbose.length - 1] : null;
    return {
      type: "state",
      yourColor: color,
      pin: this.pin,
      status: this.status,
      result: this.result,
      fen: this.chess.fen(),
      turn: this.chess.turn(),
      inCheck: this.chess.inCheck(),
      history: verbose.map((move) => move.san),
      lastMove: last ? { from: last.from, to: last.to } : null,
      drawOffer: this.drawOffer,
      rematchOffer: this.rematchOffer,
      opponentConnected: Boolean(this.opponentOf(color)?.socket),
      opponentLeft: Boolean(this.opponentOf(color)?.departed),
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
