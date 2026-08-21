// Application entry point: wires the game, board, AI, and controls together.

import { Game } from "./game.js";
import { Board } from "./board.js";
import { AI } from "./ai.js";
import { THEMES, getSavedTheme, applyTheme } from "./theme.js";
import { PIECE_SETS, loadSavedPieceSet, setPieceSet } from "./pieces.js";

const MODE_STORAGE_KEY = "gambit-mode";
const DIFFICULTY_STORAGE_KEY = "gambit-difficulty";
const AI_COLOR = "b"; // the human plays White in Human vs AI mode

const game = new Game();
const ai = new AI();

const statusEl = document.getElementById("game-status");
const historyEl = document.getElementById("move-history");
const resetButton = document.getElementById("reset-button");
const modeSelect = document.getElementById("mode-select");
const difficultyInput = document.getElementById("difficulty");
const difficultyValue = document.getElementById("difficulty-value");
const difficultyField = document.getElementById("difficulty-field");
const themeSelect = document.getElementById("theme-select");
const pieceSetSelect = document.getElementById("piece-set-select");

// Invalidates in-flight AI searches when the game is reset or the mode changes.
let aiGeneration = 0;

const board = new Board(document.getElementById("board"), game, () => {
  updateSidebar();
  maybeTriggerAiMove();
});

function updateSidebar(overrideStatus) {
  statusEl.textContent = overrideStatus || game.status();

  historyEl.innerHTML = "";
  const moves = game.history();
  for (let i = 0; i < moves.length; i += 2) {
    const li = document.createElement("li");
    li.textContent = moves[i] + (moves[i + 1] ? `  ${moves[i + 1]}` : "");
    historyEl.appendChild(li);
  }
  historyEl.scrollTop = historyEl.scrollHeight;
}

async function maybeTriggerAiMove() {
  if (modeSelect.value !== "ai" || game.turn() !== AI_COLOR || game.isGameOver()) {
    return;
  }
  const generation = aiGeneration;
  board.setLocked(true);
  updateSidebar("AI is thinking…");
  try {
    const { from, to, promotion } = await ai.bestMove(game.fen());
    if (generation !== aiGeneration) return; // game was reset meanwhile
    board.applyMove(from, to, promotion);
  } catch (error) {
    if (generation !== aiGeneration) return;
    console.error(error);
    updateSidebar("AI error — switch to Human vs Human or reload the page");
    return;
  } finally {
    if (generation === aiGeneration) board.setLocked(false);
  }
  updateSidebar();
}

function resetGame() {
  aiGeneration += 1;
  ai.stop();
  game.reset();
  board.clearSelection();
  board.setLocked(false);
  board.render();
  updateSidebar();
  maybeTriggerAiMove();
}

// --- Controls ---

resetButton.addEventListener("click", resetGame);

function updateModeUi() {
  difficultyField.hidden = modeSelect.value !== "ai";
}

modeSelect.addEventListener("change", () => {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, modeSelect.value);
  } catch {
    // ignore
  }
  updateModeUi();
  resetGame();
});

difficultyInput.addEventListener("input", () => {
  difficultyValue.textContent = difficultyInput.value;
  ai.setLevel(difficultyInput.value);
  try {
    localStorage.setItem(DIFFICULTY_STORAGE_KEY, difficultyInput.value);
  } catch {
    // ignore
  }
});

themeSelect.addEventListener("change", () => applyTheme(themeSelect.value));

pieceSetSelect.addEventListener("change", () => {
  setPieceSet(pieceSetSelect.value);
  board.render();
});

// --- Startup ---

function populateSelect(select, entries, selected) {
  for (const [value, label] of entries) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }
  select.value = selected;
}

populateSelect(themeSelect, Object.entries(THEMES), applyTheme(getSavedTheme()));
populateSelect(
  pieceSetSelect,
  Object.entries(PIECE_SETS).map(([name, set]) => [name, set.label]),
  loadSavedPieceSet()
);

let savedMode = null;
let savedDifficulty = null;
try {
  savedMode = localStorage.getItem(MODE_STORAGE_KEY);
  savedDifficulty = localStorage.getItem(DIFFICULTY_STORAGE_KEY);
} catch {
  // ignore
}
if (savedMode === "ai" || savedMode === "human") modeSelect.value = savedMode;
if (savedDifficulty && Number(savedDifficulty) >= 1 && Number(savedDifficulty) <= 8) {
  difficultyInput.value = savedDifficulty;
}
difficultyValue.textContent = difficultyInput.value;
ai.setLevel(difficultyInput.value);
updateModeUi();

board.render();
updateSidebar();
