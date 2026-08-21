// Chessboard rendering and click-based move input.

import { createPieceElement } from "./pieces.js";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

export class Board {
  /**
   * @param {HTMLElement} container element the 64 squares are rendered into
   * @param {import("./game.js").Game} game
   * @param {(move: object) => void} onMove called after a legal move is played
   */
  constructor(container, game, onMove) {
    this.container = container;
    this.game = game;
    this.onMove = onMove;
    this.selectedSquare = null;
    this.container.addEventListener("click", (event) => this.handleClick(event));
  }

  /** Re-render the whole board from the current game state. */
  render() {
    this.container.innerHTML = "";
    const board = this.game.board();
    const lastMove = this.game.lastMove();
    const legalTargets = this.selectedSquare
      ? this.game.legalMovesFrom(this.selectedSquare)
      : [];

    // chess.js returns ranks 8 -> 1, which matches top -> bottom rendering
    // with White at the bottom.
    board.forEach((rank, rankIndex) => {
      rank.forEach((piece, fileIndex) => {
        const square = FILES[fileIndex] + (8 - rankIndex);
        const el = document.createElement("div");
        const isLight = (rankIndex + fileIndex) % 2 === 0;
        el.className = `square ${isLight ? "light" : "dark"}`;
        el.dataset.square = square;
        el.setAttribute("role", "gridcell");
        el.setAttribute("aria-label", square + (piece ? ` ${pieceName(piece)}` : " empty"));

        if (piece) el.appendChild(createPieceElement(piece));
        if (square === this.selectedSquare) el.classList.add("selected");
        if (lastMove && (square === lastMove.from || square === lastMove.to)) {
          el.classList.add("last-move");
        }

        const target = legalTargets.find((move) => move.to === square);
        if (target) {
          el.classList.add(target.captured ? "legal-capture" : "legal-move");
        }

        this.container.appendChild(el);
      });
    });
  }

  handleClick(event) {
    const squareEl = event.target.closest(".square");
    if (!squareEl || this.game.isGameOver()) return;
    const square = squareEl.dataset.square;

    if (this.selectedSquare) {
      const move = this.game.move(this.selectedSquare, square);
      this.selectedSquare = null;
      if (move) {
        this.render();
        this.onMove(move);
        return;
      }
    }

    // Select (or re-select) a piece of the side to move.
    const piece = this.pieceAt(square);
    this.selectedSquare = piece && piece.color === this.game.turn() ? square : null;
    this.render();
  }

  pieceAt(square) {
    const fileIndex = FILES.indexOf(square[0]);
    const rankIndex = 8 - Number(square[1]);
    return this.game.board()[rankIndex][fileIndex];
  }

  clearSelection() {
    this.selectedSquare = null;
  }
}

function pieceName(piece) {
  const names = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };
  return `${piece.color === "w" ? "white" : "black"} ${names[piece.type]}`;
}
