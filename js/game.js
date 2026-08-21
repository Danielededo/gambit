// Game state wrapper around chess.js. All move validation and rules
// (check, checkmate, stalemate, draws) are delegated to chess.js.

// chess.js v1.4.0 (ESM build) is vendored locally so the game works offline
// and is not exposed to CDN outages or supply-chain changes.
import { Chess } from "./vendor/chess.js";

export class Game {
  constructor() {
    this.chess = new Chess();
  }

  reset() {
    this.chess.reset();
  }

  /** @returns {Array<Array<{type: string, color: string, square: string}|null>>} */
  board() {
    return this.chess.board();
  }

  /** Side to move: "w" or "b". */
  turn() {
    return this.chess.turn();
  }

  /** Legal destination squares for the piece on `square`. */
  legalMovesFrom(square) {
    return this.chess.moves({ square, verbose: true });
  }

  /**
   * Try to play a move. Returns the chess.js move object on success,
   * or null if the move is illegal.
   * Promotion defaults to queen until a promotion picker UI exists.
   */
  move(from, to) {
    try {
      return this.chess.move({ from, to, promotion: "q" });
    } catch {
      return null;
    }
  }

  /** Move history in standard algebraic notation (SAN). */
  history() {
    return this.chess.history();
  }

  lastMove() {
    const moves = this.chess.history({ verbose: true });
    return moves.length > 0 ? moves[moves.length - 1] : null;
  }

  /** Human-readable game status for the status bar. */
  status() {
    const turnName = this.turn() === "w" ? "White" : "Black";
    if (this.chess.isCheckmate()) {
      const winner = this.turn() === "w" ? "Black" : "White";
      return `Checkmate — ${winner} wins`;
    }
    if (this.chess.isStalemate()) return "Draw — stalemate";
    if (this.chess.isThreefoldRepetition()) return "Draw — threefold repetition";
    if (this.chess.isInsufficientMaterial()) return "Draw — insufficient material";
    if (this.chess.isDraw()) return "Draw";
    if (this.chess.inCheck()) return `${turnName} to move — check!`;
    return `${turnName} to move`;
  }

  isGameOver() {
    return this.chess.isGameOver();
  }
}
