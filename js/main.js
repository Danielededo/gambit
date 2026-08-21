// Application entry point: wires the game, board, and sidebar together.

import { Game } from "./game.js";
import { Board } from "./board.js";

const game = new Game();
const statusEl = document.getElementById("game-status");
const historyEl = document.getElementById("move-history");
const resetButton = document.getElementById("reset-button");

const board = new Board(document.getElementById("board"), game, () => {
  updateSidebar();
});

function updateSidebar() {
  statusEl.textContent = game.status();

  historyEl.innerHTML = "";
  const moves = game.history();
  for (let i = 0; i < moves.length; i += 2) {
    const li = document.createElement("li");
    li.textContent = moves[i] + (moves[i + 1] ? `  ${moves[i + 1]}` : "");
    historyEl.appendChild(li);
  }
  historyEl.scrollTop = historyEl.scrollHeight;
}

resetButton.addEventListener("click", () => {
  game.reset();
  board.clearSelection();
  board.render();
  updateSidebar();
});

board.render();
updateSidebar();
