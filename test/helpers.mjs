// Shared test helpers: spawn the server, a small WebSocket client harness,
// and a check/report utility. No test framework — plain Node + ws.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import WebSocket from "ws";

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), "../server/server.js");

/** Spawn the server with the given env, resolved once it answers /healthz. */
export async function startServer(env) {
  const port = env.PORT;
  const proc = spawn("node", [SERVER], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return { proc, port, base };
    } catch {
      // not up yet
    }
    await delay(100);
  }
  proc.kill("SIGKILL");
  throw new Error("server did not start in time");
}

export function stopServer(server) {
  return new Promise((res) => {
    server.proc.on("exit", () => res());
    server.proc.kill("SIGTERM");
    setTimeout(() => {
      server.proc.kill("SIGKILL");
      res();
    }, 2000).unref?.();
  });
}

/** Open a WS and return it augmented with next()/sendJson() for sequencing. */
export function connect(port, opts = {}) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`, opts);
    ws.queue = [];
    ws.waiters = [];
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw);
      const w = ws.waiters.shift();
      if (w) w(msg);
      else ws.queue.push(msg);
    });
    ws.next = () =>
      new Promise((r) => {
        if (ws.queue.length) r(ws.queue.shift());
        else ws.waiters.push(r);
      });
    ws.sendJson = (o) => ws.send(JSON.stringify(o));
    ws.on("open", () => res(ws));
    ws.on("error", () => rej(new Error("ws-error")));
  });
}

export function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function createReporter(title) {
  const results = [];
  const check = (name, cond) => {
    results.push([name, !!cond]);
    console.log((cond ? "  ok   " : "  FAIL ") + name);
  };
  const finish = () => {
    const failed = results.filter(([, ok]) => !ok);
    console.log(`\n${title}: ${results.length - failed.length}/${results.length} passed\n`);
    return failed.length === 0;
  };
  return { check, finish };
}
