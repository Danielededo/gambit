// Online play over WebSocket. The server is authoritative: the client
// mirrors the position locally (for rendering and legal-move hints), plays
// moves optimistically, and re-syncs from every server state broadcast.

import { Chess } from "./vendor/chess.js";

const TOKEN_KEY = "gambit-online-token";

export class OnlineSession {
  /**
   * @param {{ onState: (state: object) => void,
   *           onError: (code: string, message: string) => void,
   *           onConnection: (connected: boolean) => void,
   *           onSeated: (token: string, extra: object) => void }} handlers
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.socket = null;
    this.closedByUs = false;
    this.retryDelay = 1000;
    this.pendingIntro = null; // message to send as soon as the socket opens
  }

  static savedToken() {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  static saveToken(token) {
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // sessionStorage unavailable: reconnection after reload won't work.
    }
  }

  connect(introMessage) {
    this.closedByUs = false;
    this.pendingIntro = introMessage;
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    this.socket = new WebSocket(`${scheme}://${location.host}/ws`);

    this.socket.addEventListener("open", () => {
      this.retryDelay = 1000;
      this.handlers.onConnection(true);
      if (this.pendingIntro) this.send(this.pendingIntro);
    });

    this.socket.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === "state") {
        this.handlers.onState(msg);
      } else if (msg.type === "error") {
        this.handlers.onError(msg.code, msg.message);
      } else if (msg.type === "created" || msg.type === "joined" || msg.type === "resumed") {
        OnlineSession.saveToken(msg.token);
        this.handlers.onSeated(msg.token, msg);
      }
    });

    this.socket.addEventListener("close", () => {
      this.handlers.onConnection(false);
      if (this.closedByUs) return;
      // Reconnect with the stored token, backing off up to 10s.
      const token = OnlineSession.savedToken();
      if (!token) return;
      setTimeout(() => {
        if (!this.closedByUs) this.connect({ type: "resume", token });
      }, this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 10000);
    });
  }

  send(payload) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  close() {
    this.closedByUs = true;
    if (this.socket) this.socket.close();
  }
}

/**
 * Same interface as Game (board/turn/legalMovesFrom/move/history/lastMove/
 * status/isGameOver/fen) so Board can render an online game unchanged.
 */
export class OnlineGame {
  constructor(session) {
    this.session = session;
    this.chess = new Chess();
    this.myColor = null;
    this.selectableColor = null; // Board only lets this color be picked up
    this.state = null; // last authoritative server state
    this.san = [];
    this.last = null;
    this.connected = true;
  }

  applyState(state) {
    this.state = state;
    this.myColor = state.yourColor;
    this.selectableColor = state.yourColor;
    this.chess = new Chess(state.fen);
    this.san = [...state.history];
    this.last = state.lastMove;
  }

  setConnected(connected) {
    this.connected = connected;
  }

  board() {
    return this.chess.board();
  }

  turn() {
    return this.chess.turn();
  }

  legalMovesFrom(square) {
    if (!this.state || this.state.status !== "active") return [];
    if (this.chess.turn() !== this.myColor) return [];
    return this.chess.moves({ square, verbose: true });
  }

  /** Play optimistically and send to the server (which re-validates). */
  move(from, to, promotion = "q") {
    if (!this.state || this.state.status !== "active") return null;
    if (this.chess.turn() !== this.myColor) return null;
    let move;
    try {
      move = this.chess.move({ from, to, promotion });
    } catch {
      return null;
    }
    this.san.push(move.san);
    this.last = { from: move.from, to: move.to };
    this.session.send({ type: "move", from, to, promotion: move.promotion });
    return move;
  }

  /** Roll back to the last authoritative state (after a server rejection). */
  resync() {
    if (this.state) this.applyState(this.state);
  }

  resign() {
    this.session.send({ type: "resign" });
  }

  history() {
    return this.san;
  }

  lastMove() {
    return this.last;
  }

  isGameOver() {
    return !this.state || this.state.status === "finished";
  }

  inCheck() {
    return this.chess.inCheck();
  }

  fen() {
    return this.chess.fen();
  }

  status() {
    if (!this.state) return "Connecting…";
    if (!this.connected) return "Connection lost — reconnecting…";
    const s = this.state;
    if (s.status === "waiting") return `Waiting for an opponent — share PIN ${s.pin}`;
    if (s.status === "finished") {
      const r = s.result;
      if (!r || r.winner === null) return `Draw — ${r ? r.reason : "game over"}`;
      return r.winner === this.myColor ? `You won — ${r.reason}` : `You lost — ${r.reason}`;
    }
    const yourTurn = s.turn === this.myColor;
    const check = this.chess.inCheck() ? " — check!" : "";
    const disconnected = s.opponentConnected ? "" : " (opponent disconnected)";
    return (yourTurn ? `Your move${check}` : `Opponent's move${check}`) + disconnected;
  }
}
