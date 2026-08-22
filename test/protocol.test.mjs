// WebSocket protocol tests: matchmaking, authoritative move validation,
// turn order, reconnect, resignation, and the global game cap.

import { startServer, stopServer, connect, createReporter } from "./helpers.mjs";

const PORT = 8231;
const server = await startServer({ PORT: String(PORT), MAX_ACTIVE_GAMES: "3", MAX_GAMES_PER_IP: "50" });
const { check, finish } = createReporter("protocol");

try {
  // create + join
  const white = await connect(PORT);
  white.sendJson({ type: "create" });
  const created = await white.next();
  check("create returns a 6-digit PIN", created.type === "created" && /^\d{6}$/.test(created.pin));
  check("create returns a token", typeof created.token === "string" && created.token.length > 10);
  const s0 = await white.next();
  check("initial state is waiting", s0.type === "state" && s0.status === "waiting" && s0.yourColor === "w");

  const black = await connect(PORT);
  black.sendJson({ type: "join", pin: created.pin });
  const joined = await black.next();
  check("join returns a token", joined.type === "joined" && typeof joined.token === "string");
  const sB = await black.next();
  const sW = await white.next();
  check("both sides go active", sB.status === "active" && sW.status === "active");
  check("black is seated as black", sB.yourColor === "b");
  check("white sees opponent connected", sW.opponentConnected === true);

  // authoritative rules
  black.sendJson({ type: "move", from: "e7", to: "e5" });
  const e1 = await black.next();
  check("out-of-turn move rejected", e1.type === "error" && e1.code === "not_your_turn");

  white.sendJson({ type: "move", from: "e2", to: "e4" });
  const w1 = await white.next();
  const b1 = await black.next();
  check("legal move broadcast to both", w1.fen === b1.fen && w1.history[0] === "e4");
  check("lastMove reported", b1.lastMove.from === "e2" && b1.lastMove.to === "e4");

  black.sendJson({ type: "move", from: "e7", to: "e6" });
  await black.next();
  await white.next();
  white.sendJson({ type: "move", from: "e4", to: "e6" }); // illegal
  const e2 = await white.next();
  check("illegal move rejected", e2.type === "error" && e2.code === "illegal_move");

  // opaque join errors (wrong PIN and full game are indistinguishable)
  const stranger = await connect(PORT);
  stranger.sendJson({ type: "join", pin: "000000" });
  const e3 = await stranger.next();
  check("wrong PIN rejected opaquely", e3.type === "error" && e3.code === "not_found");
  stranger.sendJson({ type: "join", pin: created.pin });
  const e4 = await stranger.next();
  check("full game rejected opaquely", e4.type === "error" && e4.code === "not_found");
  stranger.close();

  // reconnect
  white.close();
  const sB2 = await black.next();
  check("opponent disconnect reported", sB2.opponentConnected === false);
  const white2 = await connect(PORT);
  white2.sendJson({ type: "resume", token: created.token });
  const resumed = await white2.next();
  check("resume acknowledged", resumed.type === "resumed");
  const sW2 = await white2.next();
  await black.next();
  check("resumed state intact", sW2.yourColor === "w" && sW2.history.length === 2 && sW2.status === "active");

  // resignation
  white2.sendJson({ type: "resign" });
  const endW = await white2.next();
  const endB = await black.next();
  check("resign finishes the game", endW.status === "finished" && endB.status === "finished");
  check("resigner's opponent wins", endB.result.winner === "b" && endB.result.reason === "resignation");
  white2.close();
  black.close();

  // global cap (MAX_ACTIVE_GAMES=3; one finished game still occupies a slot)
  const extra = [];
  let fullErr = null;
  for (let i = 0; i < 4; i++) {
    const c = await connect(PORT);
    c.sendJson({ type: "create" });
    const first = await c.next();
    if (first.type === "error") {
      fullErr = first;
      c.close();
      break;
    }
    await c.next();
    extra.push(c);
  }
  check("global game cap enforced", fullErr && fullErr.code === "server_full");
  extra.forEach((c) => c.close());
} finally {
  await stopServer(server);
}

process.exit(finish() ? 0 : 1);
