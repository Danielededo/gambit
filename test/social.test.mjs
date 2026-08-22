// Chat, draw-offer, and rematch protocol tests.

import { startServer, stopServer, connect, createReporter } from "./helpers.mjs";

const PORT = 8233;
const server = await startServer({ PORT: String(PORT), MAX_GAMES_PER_IP: "50" });
const { check, finish } = createReporter("social");

/** Consume messages until one matches, failing after a few unrelated ones. */
async function nextOfType(ws, type, limit = 6) {
  for (let i = 0; i < limit; i++) {
    const msg = await ws.next();
    if (msg.type === type) return msg;
  }
  throw new Error(`no ${type} message received`);
}

try {
  const A = await connect(PORT); // creator, starts as White
  A.sendJson({ type: "create" });
  const created = await A.next();
  await A.next(); // waiting state
  const B = await connect(PORT); // joiner, starts as Black
  B.sendJson({ type: "join", pin: created.pin });
  await B.next(); // joined
  await B.next(); // state
  await A.next(); // state

  // --- chat ---
  A.sendJson({ type: "chat", text: "  hello there  " });
  const chatB = await nextOfType(B, "chat");
  check("chat relayed to opponent (trimmed)", chatB.from === "w" && chatB.text === "hello there");

  B.sendJson({ type: "chat", text: "x".repeat(501) });
  const tooLong = await nextOfType(B, "error");
  check("over-long chat rejected", tooLong.code === "chat_too_long");

  B.sendJson({ type: "chat", text: "" });
  const empty = await nextOfType(B, "error");
  check("empty chat rejected", empty.code === "chat_empty");

  let throttled = null;
  for (let i = 0; i < 6; i++) {
    B.sendJson({ type: "chat", text: `msg ${i}` });
    // B receives nothing on success (messages go to A); poll A or errors on B.
  }
  // The 6th message within the window must be rejected.
  throttled = await nextOfType(B, "error");
  check("chat rate limit enforced", throttled.code === "chat_too_fast");
  for (let i = 0; i < 5; i++) await nextOfType(A, "chat"); // drain A

  // --- draw offer: decline, then re-offer and accept ---
  B.sendJson({ type: "draw_offer" });
  const sA1 = await nextOfType(A, "state");
  await nextOfType(B, "state");
  check("draw offer visible in state", sA1.drawOffer === "b");

  A.sendJson({ type: "draw_decline" });
  const sB2 = await nextOfType(B, "state");
  await nextOfType(A, "state");
  check("draw offer cleared on decline", sB2.drawOffer === null && sB2.status === "active");

  // A move also clears a pending offer
  B.sendJson({ type: "draw_offer" });
  await nextOfType(A, "state");
  await nextOfType(B, "state");
  A.sendJson({ type: "move", from: "e2", to: "e4" });
  const sB3 = await nextOfType(B, "state");
  await nextOfType(A, "state");
  check("move declines pending draw offer", sB3.drawOffer === null && sB3.history.length === 1);

  A.sendJson({ type: "draw_offer" });
  await nextOfType(A, "state");
  await nextOfType(B, "state");
  B.sendJson({ type: "draw_accept" });
  const endA = await nextOfType(A, "state");
  await nextOfType(B, "state");
  check(
    "draw by agreement",
    endA.status === "finished" && endA.result.winner === null && endA.result.reason === "agreement"
  );

  // --- rematch with color swap ---
  A.sendJson({ type: "rematch_offer" });
  const sB4 = await nextOfType(B, "state");
  await nextOfType(A, "state");
  check("rematch offer visible", sB4.rematchOffer === "w");

  B.sendJson({ type: "rematch_accept" });
  const rA = await nextOfType(A, "state");
  const rB = await nextOfType(B, "state");
  check("rematch starts a fresh game", rA.status === "active" && rA.history.length === 0);
  check("colors swapped (A now black)", rA.yourColor === "b" && rB.yourColor === "w");
  check("same PIN kept", rA.pin === created.pin);
  check("offers cleared after rematch", rA.drawOffer === null && rA.rematchOffer === null);

  // B (now White) moves first; A cannot.
  A.sendJson({ type: "move", from: "e2", to: "e4" });
  const notTurn = await nextOfType(A, "error");
  check("old white can no longer move first", notTurn.code === "not_your_turn");
  B.sendJson({ type: "move", from: "e2", to: "e4" });
  const mA = await nextOfType(A, "state");
  await nextOfType(B, "state");
  check("new white moves first", mA.history[0] === "e4");

  // Resume after the swap still lands on the right color.
  A.close();
  await nextOfType(B, "state"); // disconnect notice
  const A2 = await connect(PORT);
  A2.sendJson({ type: "resume", token: created.token });
  await nextOfType(A2, "resumed");
  const resumed = await nextOfType(A2, "state");
  check("resume after rematch keeps swapped color", resumed.yourColor === "b");
  A2.close();
  B.close();

  // --- leave semantics: permanent exit, distinct from a disconnect ---
  const L1 = await connect(PORT);
  L1.sendJson({ type: "create" });
  const g1 = await nextOfType(L1, "created");
  await nextOfType(L1, "state");
  const L2 = await connect(PORT);
  L2.sendJson({ type: "join", pin: g1.pin });
  const j2 = await nextOfType(L2, "joined");
  await nextOfType(L2, "state");
  await nextOfType(L1, "state");

  L2.sendJson({ type: "leave" }); // leaves mid-game
  const afterLeave = await nextOfType(L1, "state");
  check(
    "leaving mid-game resigns",
    afterLeave.status === "finished" &&
      afterLeave.result.reason === "resignation" &&
      afterLeave.result.winner === "w"
  );
  check("opponentLeft flagged for the stayer", afterLeave.opponentLeft === true);

  L1.sendJson({ type: "rematch_offer" });
  const futile = await nextOfType(L1, "error");
  check("rematch to a departed opponent refused", futile.code === "opponent_left");

  const comeback = await connect(PORT);
  comeback.sendJson({ type: "resume", token: j2.token });
  const dead = await nextOfType(comeback, "error");
  check("leaver's token is invalidated", dead.code === "not_found");
  comeback.close();
  L1.close();
  L2.close();

  // Leaving a waiting game frees the PIN immediately.
  const L3 = await connect(PORT);
  L3.sendJson({ type: "create" });
  const g3 = await nextOfType(L3, "created");
  await nextOfType(L3, "state");
  L3.sendJson({ type: "leave" });
  const probe = await connect(PORT);
  probe.sendJson({ type: "join", pin: g3.pin });
  const gone = await nextOfType(probe, "error");
  check("waiting game removed when creator leaves", gone.code === "not_found");
  probe.close();
  L3.close();
} finally {
  await stopServer(server);
}

process.exit(finish() ? 0 : 1);
