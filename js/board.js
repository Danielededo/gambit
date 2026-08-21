// Chessboard rendering, click-based move input, and the promotion picker.

import { createPieceElement } from "./pieces.js";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const PROMOTION_CHOICES = ["q", "r", "b", "n"];

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
    this.locked = false; // true while the AI is thinking
    this.promotionDialog = null;
    this.container.addEventListener("click", (event) => this.handleClick(event));
  }

  /** Re-render the whole board from the current game state. */
  render() {
    this.closePromotionDialog();
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

  async handleClick(event) {
    const squareEl = event.target.closest(".square");
    if (!squareEl || this.locked || this.promotionDialog || this.game.isGameOver()) return;
    const square = squareEl.dataset.square;

    if (this.selectedSquare) {
      const from = this.selectedSquare;
      const candidate = this.game
        .legalMovesFrom(from)
        .find((move) => move.to === square);

      if (candidate) {
        let promotion;
        if (candidate.promotion) {
          promotion = await this.askPromotion(square);
          if (!promotion) {
            // Picker dismissed: keep the piece selected.
            this.render();
            return;
          }
        }
        const move = this.game.move(from, square, promotion);
        this.selectedSquare = null;
        if (move) {
          this.render();
          this.onMove(move);
          return;
        }
      }
    }

    // Select (or re-select) a piece of the side to move.
    const piece = this.pieceAt(square);
    this.selectedSquare = piece && piece.color === this.game.turn() ? square : null;
    this.render();
  }

  /**
   * Play a move programmatically (used for AI moves).
   * @returns {object|null} the chess.js move object, or null if illegal
   */
  applyMove(from, to, promotion) {
    const move = this.game.move(from, to, promotion);
    if (move) {
      this.selectedSquare = null;
      this.render();
    }
    return move;
  }

  setLocked(locked) {
    this.locked = locked;
    this.container.classList.toggle("locked", locked);
  }

  clearSelection() {
    this.selectedSquare = null;
  }

  /** Show the promotion picker and resolve with "q" | "r" | "b" | "n" or null. */
  askPromotion(square) {
    return new Promise((resolve) => {
      const color = this.game.turn();
      const dialog = document.createElement("div");
      dialog.className = "promotion-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-label", "Choose promotion piece");

      PROMOTION_CHOICES.forEach((type) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "promotion-choice";
        button.dataset.promotion = type;
        button.appendChild(createPieceElement({ type, color }));
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          this.closePromotionDialog(type);
        });
        dialog.appendChild(button);
      });

      // Position the dialog over the destination square's file.
      const squareEl = this.container.querySelector(`[data-square="${square}"]`);
      if (squareEl) {
        dialog.style.left = `${squareEl.offsetLeft}px`;
        dialog.style.top = color === "w" ? "0" : "auto";
        if (color === "b") dialog.style.bottom = "0";
      }

      const record = { element: dialog, resolve, onOutside: null };
      record.onOutside = (event) => {
        if (!dialog.contains(event.target)) this.closePromotionDialog(null);
      };
      this.promotionDialog = record;
      this.container.appendChild(dialog);
      // Defer so the click that opened the picker doesn't immediately close it.
      setTimeout(() => {
        if (this.promotionDialog === record) {
          document.addEventListener("click", record.onOutside);
        }
      }, 0);
    });
  }

  /** Close the picker, resolving its promise (null = dismissed). */
  closePromotionDialog(result = null) {
    if (!this.promotionDialog) return;
    const { element, resolve, onOutside } = this.promotionDialog;
    this.promotionDialog = null;
    document.removeEventListener("click", onOutside);
    element.remove();
    resolve(result);
  }

  pieceAt(square) {
    const fileIndex = FILES.indexOf(square[0]);
    const rankIndex = 8 - Number(square[1]);
    return this.game.board()[rankIndex][fileIndex];
  }
}

function pieceName(piece) {
  const names = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };
  return `${piece.color === "w" ? "white" : "black"} ${names[piece.type]}`;
}
