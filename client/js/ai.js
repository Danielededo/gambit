// Stockfish integration. Runs the vendored single-threaded WASM build
// (js/vendor/stockfish/) in a Web Worker and talks UCI over postMessage.
//
// Difficulty 1-8 maps to a combination of the UCI "Skill Level" option
// (0-20), search depth, and a move-time cap. Depth alone is not enough:
// even at depth 1 an unrestricted Stockfish beats most casual players,
// while Skill Level makes it play deliberately imperfect moves.

const ENGINE_PATH = "js/vendor/stockfish/stockfish-18-lite-single.js";

export const DIFFICULTY_LEVELS = {
  1: { skill: 0, depth: 1, movetime: 250 },
  2: { skill: 3, depth: 2, movetime: 350 },
  3: { skill: 6, depth: 3, movetime: 500 },
  4: { skill: 9, depth: 5, movetime: 700 },
  5: { skill: 12, depth: 8, movetime: 1000 },
  6: { skill: 15, depth: 11, movetime: 1500 },
  7: { skill: 18, depth: 15, movetime: 2200 },
  8: { skill: 20, depth: 22, movetime: 3000 },
};

export class AI {
  constructor() {
    this.worker = null;
    this.readyPromise = null;
    this.level = 3;
  }

  /** Lazily start the engine so Human vs Human games never pay its cost. */
  init() {
    if (this.readyPromise) return this.readyPromise;
    this.worker = new Worker(ENGINE_PATH);
    this.readyPromise = new Promise((resolve, reject) => {
      const onMessage = (event) => {
        if (String(event.data) === "uciok") {
          this.worker.removeEventListener("message", onMessage);
          resolve();
        }
      };
      this.worker.addEventListener("message", onMessage);
      this.worker.addEventListener("error", (e) => reject(new Error(`Engine failed to load: ${e.message}`)), { once: true });
      this.worker.postMessage("uci");
    });
    return this.readyPromise;
  }

  setLevel(level) {
    this.level = Math.min(8, Math.max(1, Number(level) || 3));
  }

  /**
   * Ask the engine for its move in the given position.
   * @param {string} fen current position
   * @returns {Promise<{from: string, to: string, promotion?: string}>}
   */
  async bestMove(fen) {
    await this.init();
    const { skill, depth, movetime } = DIFFICULTY_LEVELS[this.level];
    this.worker.postMessage(`setoption name Skill Level value ${skill}`);
    this.worker.postMessage(`position fen ${fen}`);

    return new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const line = String(event.data);
        if (!line.startsWith("bestmove")) return;
        this.worker.removeEventListener("message", onMessage);
        const uci = line.split(/\s+/)[1];
        if (!uci || uci === "(none)") {
          reject(new Error("Engine returned no move"));
          return;
        }
        resolve({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci.length > 4 ? uci[4] : undefined,
        });
      };
      this.worker.addEventListener("message", onMessage);
      this.worker.postMessage(`go depth ${depth} movetime ${movetime}`);
    });
  }

  /** Interrupt any ongoing search (used on reset/mode change). */
  stop() {
    if (this.worker) this.worker.postMessage("stop");
  }
}
