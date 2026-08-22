// Security-hardening tests: per-IP game cap, PIN brute-force throttle,
// Origin allowlist, and per-IP connection cap.

import { startServer, stopServer, connect, delay, createReporter } from "./helpers.mjs";

const PORT = 8232;
const server = await startServer({
  PORT: String(PORT),
  MAX_GAMES_PER_IP: "2",
  JOIN_FAILURE_LIMIT: "5",
  MAX_CONNECTIONS_PER_IP: "4",
  ALLOWED_ORIGINS: "http://good.example",
});
const { check, finish } = createReporter("security");

try {
  // Origin allowlist
  let rejected = false;
  try {
    await connect(PORT, { origin: "http://evil.example" });
  } catch {
    rejected = true;
  }
  check("disallowed Origin rejected", rejected);

  let allowedOk = false;
  try {
    const w = await connect(PORT, { origin: "http://good.example" });
    allowedOk = true;
    w.close();
  } catch {
    // ignore
  }
  check("allowed Origin accepted", allowedOk);

  const base = await connect(PORT); // no Origin header (non-browser client)
  base.sendJson({ type: "create" });
  const c0 = await base.next();
  check("no-Origin client can create", c0.type === "created");
  await base.next();

  // Per-IP game cap (MAX_GAMES_PER_IP=2)
  const g2 = await connect(PORT);
  g2.sendJson({ type: "create" });
  const c2 = await g2.next();
  await g2.next();
  check("second game allowed", c2.type === "created");
  const g3 = await connect(PORT);
  g3.sendJson({ type: "create" });
  const c3 = await g3.next();
  check("third game from same IP refused", c3.type === "error" && c3.code === "too_many_games");
  g3.close();

  base.sendJson({ type: "resign" });
  await base.next();
  base.close();
  const g4 = await connect(PORT);
  g4.sendJson({ type: "create" });
  const c4 = await g4.next();
  check("quota frees after a game ends", c4.type === "created");
  await g4.next();
  g4.close();
  g2.close();

  // PIN brute-force throttle (JOIN_FAILURE_LIMIT=5)
  const attacker = await connect(PORT);
  const codes = [];
  for (let i = 0; i < 6; i++) {
    attacker.sendJson({ type: "join", pin: String(100000 + i) });
    codes.push((await attacker.next()).code);
  }
  check("first misses are not_found", codes.slice(0, 5).every((c) => c === "not_found"));
  check("join locked out after limit", codes[5] === "too_many_attempts");
  attacker.close();

  // Per-IP connection cap (MAX_CONNECTIONS_PER_IP=4)
  const conns = [];
  for (let i = 0; i < 4; i++) conns.push(await connect(PORT));
  let capClosed = false;
  try {
    const extra = await connect(PORT);
    await new Promise((r) => {
      extra.on("close", () => {
        capClosed = true;
        r();
      });
      setTimeout(r, 1000);
    });
  } catch {
    capClosed = true;
  }
  check("connection cap enforced", capClosed);
  conns.forEach((c) => c.close());
  await delay(50);
} finally {
  await stopServer(server);
}

process.exit(finish() ? 0 : 1);
