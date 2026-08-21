// Piece set management and piece rendering.
// SVG sets are sprite files (one per set) whose pieces are addressed by
// fragment id: wk, wq, wr, wb, wn, wp, bk, bq, br, bb, bn, bp.

const STORAGE_KEY = "gambit-piece-set";
const SVG_NS = "http://www.w3.org/2000/svg";

export const PIECE_SETS = {
  standard: { label: "Standard", type: "svg", sprite: "assets/pieces/standard/pieces.svg" },
  medieval: { label: "Medieval", type: "svg", sprite: "assets/pieces/medieval/pieces.svg" },
  minimal: { label: "Minimal", type: "svg", sprite: "assets/pieces/minimal/pieces.svg" },
  unicode: { label: "Unicode", type: "text" },
};

export const DEFAULT_PIECE_SET = "standard";

const UNICODE_PIECES = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

let currentSet = DEFAULT_PIECE_SET;

export function getPieceSet() {
  return currentSet;
}

export function setPieceSet(name) {
  if (!PIECE_SETS[name]) name = DEFAULT_PIECE_SET;
  currentSet = name;
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // localStorage can be unavailable (private mode); the choice just won't persist.
  }
}

export function loadSavedPieceSet() {
  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  currentSet = saved && PIECE_SETS[saved] ? saved : DEFAULT_PIECE_SET;
  return currentSet;
}

/**
 * Return a DOM element for a piece, rendered with the active piece set.
 * @param {{ type: string, color: string }} piece chess.js piece object
 * @returns {HTMLElement}
 */
export function createPieceElement(piece) {
  const set = PIECE_SETS[currentSet];
  const el = document.createElement("span");
  el.className = `piece ${piece.color === "w" ? "white" : "black"}`;
  el.setAttribute("aria-hidden", "true");

  if (set.type === "svg") {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 40 40");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", `${set.sprite}#${piece.color}${piece.type}`);
    svg.appendChild(use);
    el.appendChild(svg);
    el.classList.add("piece-svg");
  } else {
    el.textContent = UNICODE_PIECES[piece.color][piece.type];
    el.classList.add("piece-text");
  }
  return el;
}
