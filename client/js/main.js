// Application entry point: wires the game, board, AI, online play, and
// controls together.

import { Game } from "./game.js";
import { Board } from "./board.js";
import { AI } from "./ai.js";
import { OnlineSession, OnlineGame } from "./online.js";
import { THEMES, getSavedTheme, applyTheme } from "./theme.js";
import { PIECE_SETS, loadSavedPieceSet, setPieceSet, createPieceElement } from "./pieces.js";
import { sound } from "./sound.js";

const MODE_STORAGE_KEY = "gambit-mode";
const DIFFICULTY_STORAGE_KEY = "gambit-difficulty";
const AI_COLOR = "b"; // the human plays White in Human vs AI mode
// Shown in the footer; bump on release so a stale cached client is obvious.
const APP_VERSION = "0.7.0";

const localGame = new Game();
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
const onlinePanel = document.getElementById("online-panel");
const createGameButton = document.getElementById("create-game");
const joinPinInput = document.getElementById("join-pin");
const joinGameButton = document.getElementById("join-game");
const pinBanner = document.getElementById("pin-banner");
const pinValue = document.getElementById("pin-value");
const copyPinButton = document.getElementById("copy-pin");
const offerBanner = document.getElementById("offer-banner");
const offerText = document.getElementById("offer-text");
const offerAccept = document.getElementById("offer-accept");
const offerDecline = document.getElementById("offer-decline");
const onlineActions = document.getElementById("online-actions");
const drawButton = document.getElementById("draw-button");
const rematchButton = document.getElementById("rematch-button");
const chatPanel = document.getElementById("chat-panel");
const chatMessages = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const capturedByW = document.getElementById("captured-by-w");
const capturedByB = document.getElementById("captured-by-b");
const materialW = document.getElementById("material-w");
const materialB = document.getElementById("material-b");

// Invalidates in-flight AI searches when the game is reset or the mode changes.
let aiGeneration = 0;

// Online play state (null while in a local mode).
let session = null;
let onlineGame = null;

// PIN from an invite link (?pin=NNNNNN), consumed on the first online start.
let invitePin = null;
{
  const fromUrl = new URLSearchParams(location.search).get("pin");
  if (fromUrl && /^\d{6}$/.test(fromUrl)) invitePin = fromUrl;
}

// How many half-moves have already been given a sound (avoids double-playing
// an online move: once optimistically, once on the server echo).
let soundedMoves = 0;

// --- Center-board toast for the moments worth shouting about ---

const boardToast = document.getElementById("board-toast");
const boardToastText = document.getElementById("board-toast-text");
let boardToastTimer = null;

/** Show a transient, non-blocking message centered on the board. */
function announce(text, kind = "start", duration = 2000) {
  boardToastText.textContent = text;
  boardToast.hidden = true;
  void boardToast.offsetWidth; // restart the CSS animation
  boardToast.className = `board-toast ${kind}`;
  boardToast.hidden = false;
  boardToastText.style.animationDuration = `${duration}ms`;
  clearTimeout(boardToastTimer);
  boardToastTimer = setTimeout(() => {
    boardToast.hidden = true;
  }, duration);
}

/** Toast for check / game over right after a move on `game`. */
function announceMoveEvents(game) {
  if (game.isGameOver()) announce(game.status(), "end", 3500);
  else if (game.inCheck()) announce("Check!", "check", 1400);
}

const board = new Board(document.getElementById("board"), localGame, (move) => {
  const game = currentGame();
  sound.playForMove({
    captured: Boolean(move && move.captured),
    inCheck: game.inCheck(),
    gameOver: game.isGameOver(),
  });
  soundedMoves = game.history().length;
  announceMoveEvents(game);
  updateSidebar();
  if (modeSelect.value === "ai") maybeTriggerAiMove();
});

function currentGame() {
  return modeSelect.value === "online" && onlineGame ? onlineGame : localGame;
}

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const CAPTURE_ORDER = ["q", "r", "b", "n", "p"];

function renderCapturedRow(container, types, victimColor) {
  container.innerHTML = "";
  const sorted = [...types].sort(
    (a, b) => CAPTURE_ORDER.indexOf(a) - CAPTURE_ORDER.indexOf(b)
  );
  for (const type of sorted) {
    const el = createPieceElement({ type, color: victimColor });
    el.classList.add("captured-piece");
    container.appendChild(el);
  }
}

function updateCaptured() {
  const captures = currentGame().captured();
  // Pieces captured BY White are Black's pieces, and vice versa.
  renderCapturedRow(capturedByW, captures.w, "b");
  renderCapturedRow(capturedByB, captures.b, "w");
  const sum = (list) => list.reduce((total, type) => total + (PIECE_VALUES[type] || 0), 0);
  const lead = sum(captures.w) - sum(captures.b);
  materialW.textContent = lead > 0 ? `+${lead}` : "";
  materialB.textContent = lead < 0 ? `+${-lead}` : "";
}

function updateSidebar(overrideStatus) {
  statusEl.textContent = overrideStatus || currentGame().status();

  historyEl.innerHTML = "";
  const moves = currentGame().history();
  for (let i = 0; i < moves.length; i += 2) {
    const li = document.createElement("li");
    li.textContent = moves[i] + (moves[i + 1] ? `  ${moves[i + 1]}` : "");
    historyEl.appendChild(li);
  }
  historyEl.scrollTop = historyEl.scrollHeight;
  updateCaptured();
}

// --- Local play (vs AI or hot-seat) ---

async function maybeTriggerAiMove() {
  if (modeSelect.value !== "ai" || localGame.turn() !== AI_COLOR || localGame.isGameOver()) {
    return;
  }
  const generation = aiGeneration;
  board.setLocked(true);
  updateSidebar("AI is thinking…");
  try {
    const { from, to, promotion } = await ai.bestMove(localGame.fen());
    if (generation !== aiGeneration) return; // game was reset meanwhile
    const move = board.applyMove(from, to, promotion);
    sound.playForMove({
      captured: Boolean(move && move.captured),
      inCheck: localGame.inCheck(),
      gameOver: localGame.isGameOver(),
    });
    soundedMoves = localGame.history().length;
    announceMoveEvents(localGame);
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

function resetLocalGame() {
  aiGeneration += 1;
  ai.stop();
  soundedMoves = 0;
  localGame.reset();
  board.setLocked(false);
  board.setGame(localGame, "w");
  updateSidebar();
  maybeTriggerAiMove();
}

// --- Online play ---

function startOnline() {
  onlineGame = null;
  soundedMoves = 0;
  let prevStatus = null;
  let prevDrawOffer = null;
  let prevRematchOffer = null;
  let prevOpponentLeft = false;
  session = new OnlineSession({
    onState: (state) => {
      const firstState = !onlineGame.state;
      onlineGame.applyState(state);
      // Orientation can change mid-session: a rematch swaps colors.
      if (firstState || board.game !== onlineGame || board.orientation !== state.yourColor) {
        board.setGame(onlineGame, state.yourColor);
      } else {
        board.render();
      }
      updateOnlineUi();
      updateSidebar();

      // Sounds and toasts for events we didn't cause locally.
      if (
        !firstState &&
        state.status === "active" &&
        (prevStatus === "waiting" || prevStatus === "finished")
      ) {
        sound.play("notify");
        announce(
          prevStatus === "waiting" ? "Opponent joined — game on!" : "Rematch — new game!",
          "start",
          2200
        );
      } else if (firstState && state.status === "active" && state.history.length === 0) {
        // Joined a fresh game (e.g. via invite link).
        announce(`Game on — you play ${state.yourColor === "w" ? "White" : "Black"}!`, "start", 2200);
      }
      if (state.history.length < soundedMoves) {
        soundedMoves = state.history.length; // fresh board after a rematch
      }
      if (state.history.length > soundedMoves) {
        // Opponent's move (own moves are sounded optimistically on click).
        sound.playForMove({
          captured: /x/.test(state.history[state.history.length - 1] || ""),
          inCheck: state.inCheck,
          gameOver: state.status === "finished",
        });
        soundedMoves = state.history.length;
        announceMoveEvents(onlineGame);
      } else if (
        !firstState &&
        prevStatus === "active" &&
        state.status === "finished" &&
        ["resignation", "agreement", "abandonment"].includes(state.result && state.result.reason)
      ) {
        // Game ended without a move (a mating move's server echo must not
        // re-fire: its reason is checkmate/draw and was handled on the move).
        sound.play("end");
        announce(onlineGame.status(), "end", 3500);
      }

      // Incoming offers and a permanently departing opponent deserve a ping.
      if (!firstState) {
        const myColor = state.yourColor;
        if (state.drawOffer && state.drawOffer !== myColor && prevDrawOffer !== state.drawOffer) {
          sound.play("notify");
          announce("Opponent offers a draw", "start", 2200);
        }
        if (
          state.rematchOffer &&
          state.rematchOffer !== myColor &&
          prevRematchOffer !== state.rematchOffer
        ) {
          sound.play("notify");
          announce("Opponent wants a rematch", "start", 2200);
        }
        if (
          state.opponentLeft &&
          !prevOpponentLeft &&
          state.status === "finished" &&
          prevStatus === "finished"
        ) {
          // Mid-game departures already announce the resignation result.
          sound.play("notify");
          announce("Opponent left the game", "end", 2500);
        }
      }
      prevDrawOffer = state.drawOffer;
      prevRematchOffer = state.rematchOffer;
      prevOpponentLeft = Boolean(state.opponentLeft);
      prevStatus = state.status;
    },
    onChat: (from, text) => {
      appendChat("them", text);
      sound.play("notify");
      bumpUnread();
    },
    onError: (code, message) => {
      if (code.startsWith("chat_")) {
        appendChat("system", message);
        return;
      }
      if (code === "no_offer") {
        return; // stale accept/decline (offer was withdrawn); state will follow
      }
      if (!onlineGame.state || code === "not_found") {
        // Wrong PIN, full game, expired token: back to the create/join panel.
        if (code === "not_found") OnlineSession.saveToken(null);
        onlineGame.state = null;
        updateOnlineUi();
        updateSidebar(message);
        return;
      }
      // Server rejected a move we thought was legal: fall back to its state.
      onlineGame.resync();
      board.render();
      updateSidebar();
      console.warn(`Server rejected: ${code} — ${message}`);
    },
    onConnection: (connected) => {
      if (!onlineGame) return;
      onlineGame.setConnected(connected);
      if (onlineGame.state) {
        updateSidebar();
      } else if (!connected) {
        // Static-only deployments (e.g. GitHub Pages) have no game server.
        updateSidebar("Online server unreachable — online play needs the Node server (see README)");
      }
    },
    onSeated: (token, extra) => {
      // A new game identity (create/join) starts a fresh chat; a resume keeps
      // the panel but past messages are gone with the old page anyway.
      if (extra.type === "created" || extra.type === "joined") clearChat();
      updateOnlineUi();
    },
  });
  onlineGame = new OnlineGame(session);

  if (invitePin) {
    // Opened via an invite link (?pin=NNNNNN): join directly, and clean the
    // URL so a later reload resumes via the token instead of re-joining.
    const pin = invitePin;
    invitePin = null;
    history.replaceState(null, "", location.pathname);
    session.connect({ type: "join", pin });
    updateOnlineUi();
    updateSidebar(`Joining game ${pin}…`);
    return;
  }
  const token = OnlineSession.savedToken();
  session.connect(token ? { type: "resume", token } : null);
  updateOnlineUi();
  updateSidebar(token ? "Reconnecting to your game…" : "Create a game or join with a PIN");
}

function leaveOnline() {
  if (session) {
    // Tell the server this is a permanent exit (resigns a running game and
    // vacates the seat, so the opponent knows rematch is off the table).
    if (onlineGame && onlineGame.state) session.send({ type: "leave" });
    session.close();
    // Only drop the reconnect token when we actually left a game. With no
    // session (e.g. the initial local-mode setup before the server probe),
    // clearing it would wipe a still-valid token and break auto-resume.
    OnlineSession.saveToken(null);
  }
  session = null;
  onlineGame = null;
  pinBanner.hidden = true;
  onlinePanel.hidden = true;
  onlineActions.hidden = true;
  offerBanner.hidden = true;
  chatPanel.hidden = true;
  modeSelect.disabled = false;
  modeSelect.title = "";
  clearChat();
}

function updateOnlineUi() {
  const seated = Boolean(onlineGame && onlineGame.state);
  const state = seated ? onlineGame.state : null;
  onlinePanel.hidden = seated;
  const waiting = seated && state.status === "waiting";
  pinBanner.hidden = !waiting;
  if (waiting) pinValue.textContent = state.pin;
  resetButton.textContent = seated ? "Leave game" : "New game";

  // While seated in an online game, switching mode would silently abandon it:
  // require the explicit "Leave game" action instead.
  modeSelect.disabled = seated;
  modeSelect.title = seated ? "Leave the game first to change mode" : "";

  // Chat is available as soon as there is an opponent (and stays open after
  // the game ends, for the customary "gg").
  chatPanel.hidden = !seated || state.status === "waiting";

  // Draw (during the game) and rematch (after it) actions.
  const myColor = seated ? state.yourColor : null;
  drawButton.hidden = !seated || state.status !== "active";
  drawButton.disabled = seated && state.drawOffer === myColor;
  drawButton.textContent = seated && state.drawOffer === myColor ? "Draw offered…" : "Offer draw";
  rematchButton.hidden = !seated || state.status !== "finished";
  if (!rematchButton.hidden && state.opponentLeft) {
    // No one is on the other side anymore: offering would be futile.
    rematchButton.disabled = true;
    rematchButton.textContent = "Opponent left";
  } else {
    rematchButton.disabled = seated && state.rematchOffer === myColor;
    rematchButton.textContent =
      seated && state.rematchOffer === myColor ? "Rematch offered…" : "Rematch";
  }
  onlineActions.hidden = drawButton.hidden && rematchButton.hidden;

  // Banner for the opponent's pending offer.
  const opponentOffer =
    seated && state.drawOffer && state.drawOffer !== myColor
      ? "draw"
      : seated && state.rematchOffer && state.rematchOffer !== myColor
        ? "rematch"
        : null;
  pendingOfferKind = opponentOffer;
  offerBanner.hidden = !opponentOffer;
  if (opponentOffer) {
    offerText.textContent =
      opponentOffer === "draw" ? "Your opponent offers a draw" : "Your opponent wants a rematch";
  }
}

// Which opponent offer the banner currently shows ("draw" | "rematch" | null).
let pendingOfferKind = null;

offerAccept.addEventListener("click", () => {
  if (!onlineGame) return;
  if (pendingOfferKind === "draw") onlineGame.acceptDraw();
  if (pendingOfferKind === "rematch") onlineGame.acceptRematch();
});

offerDecline.addEventListener("click", () => {
  if (!onlineGame) return;
  if (pendingOfferKind === "draw") onlineGame.declineDraw();
  if (pendingOfferKind === "rematch") onlineGame.declineRematch();
});

drawButton.addEventListener("click", () => {
  if (onlineGame) onlineGame.offerDraw();
});

rematchButton.addEventListener("click", () => {
  if (onlineGame) onlineGame.offerRematch();
});

// --- Chat ---

const CHAT_MAX_MESSAGES = 200;
let unreadChats = 0;

function appendChat(who, text) {
  const el = document.createElement("div");
  el.className = `chat-msg ${who}`; // "you" | "them" | "system"
  el.textContent = who === "system" ? text : `${who === "you" ? "You" : "Opponent"}: ${text}`;
  chatMessages.appendChild(el);
  while (chatMessages.childElementCount > CHAT_MAX_MESSAGES) {
    chatMessages.firstElementChild.remove();
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function clearChat() {
  chatMessages.innerHTML = "";
  unreadChats = 0;
  document.title = "Gambit — Chess Game";
}

function bumpUnread() {
  if (!document.hidden) return;
  unreadChats += 1;
  document.title = `(${unreadChats}) Gambit — Chess Game`;
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    unreadChats = 0;
    document.title = "Gambit — Chess Game";
  }
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !onlineGame) return;
  onlineGame.sendChat(text);
  appendChat("you", text);
  chatInput.value = "";
});

createGameButton.addEventListener("click", () => {
  if (session) session.send({ type: "create" });
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for contexts without the async clipboard API.
    try {
      const scratch = document.createElement("textarea");
      scratch.value = text;
      scratch.style.position = "fixed";
      scratch.style.opacity = "0";
      document.body.appendChild(scratch);
      scratch.select();
      const ok = document.execCommand("copy");
      scratch.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

const copiedTimers = new WeakMap();
function flashCopied(button) {
  button.classList.add("copied");
  clearTimeout(copiedTimers.get(button));
  copiedTimers.set(button, setTimeout(() => button.classList.remove("copied"), 1500));
}

/** Invite URL for the current game, derived from wherever the app is hosted. */
function inviteLink(pin) {
  return `${location.origin}${location.pathname}?pin=${pin}`;
}

copyPinButton.addEventListener("click", async () => {
  const pin = pinValue.textContent.trim();
  if (pin && (await copyText(pin))) flashCopied(copyPinButton);
});

const sharePinButton = document.getElementById("share-pin");
sharePinButton.addEventListener("click", async () => {
  const pin = pinValue.textContent.trim();
  if (!pin) return;
  const url = inviteLink(pin);
  if (navigator.share) {
    try {
      await navigator.share({ title: "Gambit", text: "Play chess with me!", url });
      return;
    } catch {
      // Share sheet dismissed or unavailable: fall back to copying.
    }
  }
  if (await copyText(url)) flashCopied(sharePinButton);
});

joinGameButton.addEventListener("click", () => {
  const pin = joinPinInput.value.trim();
  if (/^\d{6}$/.test(pin) && session) session.send({ type: "join", pin });
  else updateSidebar("Enter the 6-digit PIN of an existing game");
});

joinPinInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") joinGameButton.click();
});

// --- Controls ---

resetButton.addEventListener("click", () => {
  if (modeSelect.value === "online") {
    leaveOnline();
    startOnline();
    board.setGame(localGame, "w"); // placeholder board while unseated
    updateSidebar("Create a game or join with a PIN");
  } else {
    resetLocalGame();
    announce("New game", "start", 1500);
  }
});

function applyMode() {
  const mode = modeSelect.value;
  difficultyField.hidden = mode !== "ai";
  if (mode === "online") {
    startOnline();
  } else {
    leaveOnline();
    resetButton.textContent = "New game";
    resetLocalGame();
  }
}

modeSelect.addEventListener("change", () => {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, modeSelect.value);
  } catch {
    // ignore
  }
  applyMode();
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

const soundToggle = document.getElementById("sound-toggle");
function renderSoundToggle() {
  soundToggle.textContent = sound.isEnabled() ? "🔊" : "🔇";
  soundToggle.setAttribute("aria-pressed", String(sound.isEnabled()));
}
soundToggle.addEventListener("click", () => {
  sound.setEnabled(!sound.isEnabled());
  renderSoundToggle();
  if (sound.isEnabled()) sound.play("move"); // audible confirmation
});
renderSoundToggle();

pieceSetSelect.addEventListener("change", () => {
  setPieceSet(pieceSetSelect.value);
  board.render();
  updateCaptured();
});

// iOS/Safari keeps WebAudio silent until it is primed inside a real tap;
// retried on every tap (cheap no-op once primed) in case the first attempt
// to start the media route is rejected.
document.addEventListener("pointerdown", () => sound.unlock(), { capture: true });

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
if (savedDifficulty && Number(savedDifficulty) >= 1 && Number(savedDifficulty) <= 8) {
  difficultyInput.value = savedDifficulty;
}
difficultyValue.textContent = difficultyInput.value;
ai.setLevel(difficultyInput.value);

// Online mode requires the Node server. On a static-only deployment (GitHub
// Pages) there is none, so the option is hidden until a /healthz probe
// confirms a server is present — one codebase, two "releases".
const onlineOption = modeSelect.querySelector('option[value="online"]');
onlineOption.remove();
if (["ai", "human"].includes(savedMode)) modeSelect.value = savedMode;

document.getElementById("app-version").textContent = `v${APP_VERSION}`;

board.render();
updateSidebar();
applyMode();

async function serverAvailable() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(new URL("healthz", document.baseURI), {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = await res.json();
    return data && data.ok === true;
  } catch {
    return false;
  }
}

serverAvailable().then((available) => {
  if (!available) {
    if (invitePin) updateSidebar("This deployment has no online server — ask your friend for the full game link");
    return; // static release: online stays hidden
  }
  modeSelect.appendChild(onlineOption);
  if (savedMode === "online" || invitePin) {
    modeSelect.value = "online";
    try {
      // Persist the programmatic switch (change events do this for manual
      // ones), so a reload after joining via invite link resumes the game.
      localStorage.setItem(MODE_STORAGE_KEY, "online");
    } catch {
      // ignore
    }
    applyMode();
  }
});
