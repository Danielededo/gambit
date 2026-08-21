// Piece rendering. For now only the Unicode set is implemented; SVG sets
// (standard, medieval, minimal) will plug into the same interface later.

const UNICODE_PIECES = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

/**
 * Return a DOM element for a piece.
 * @param {{ type: string, color: string }} piece chess.js piece object
 * @returns {HTMLElement}
 */
export function createPieceElement(piece) {
  const el = document.createElement("span");
  el.className = `piece ${piece.color === "w" ? "white" : "black"}`;
  el.textContent = UNICODE_PIECES[piece.color][piece.type];
  el.setAttribute("aria-hidden", "true");
  return el;
}
