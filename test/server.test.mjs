// Tests for the HTTP server: routes, status codes, and end-to-end checks.
import test from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../server.js";
import { EXAMPLES } from "../src/examples.js";
import { RULES } from "../src/rules.js";
import { reconstructMatch } from "../src/reconstructor.js";

const MATCH = "match-demo";

let base = "";
let server;

test.before(async () => {
  server = buildServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function postCheck(body, raw = false) {
  return fetch(`${base}/api/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? body : JSON.stringify(body),
  });
}

test("GET / serves the UI with the tool title", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes("Steal-the-VFY Match Reconstructor"));
  assert.ok(text.includes("Honest scope"));
  assert.ok(text.includes("assumed board model"));
});

test("GET /app.js serves the UI script", async () => {
  const res = await fetch(`${base}/app.js`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes("/api/check"));
});

test("GET /health returns the service name and version", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.service, "vfy-match-reconstructor");
  assert.equal(body.version, "1.0.0");
  assert.equal(body.status, "ok");
});

test("GET /api/health matches /health", async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.service, "vfy-match-reconstructor");
  assert.equal(body.version, "1.0.0");
});

test("GET /api/examples returns at least 10 labeled examples", async () => {
  const res = await fetch(`${base}/api/examples`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.count >= 10);
  assert.equal(body.examples.length, body.count);
  for (const ex of body.examples) {
    assert.ok(["legal", "illegal"].includes(ex.expectedVerdict));
    assert.ok(ex.input && Array.isArray(ex.input.turns) && ex.input.turns.length > 0);
  }
});

test("every bundled example replays to its labeled verdict through the API data", async () => {
  const res = await fetch(`${base}/api/examples`);
  const body = await res.json();
  for (const ex of body.examples) {
    assert.equal(reconstructMatch(ex.input).verdict, ex.expectedVerdict, ex.id);
  }
});

test("GET /api/rules documents every check with a kind and a source", async () => {
  const res = await fetch(`${base}/api/rules`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.count, RULES.length);
  for (const rule of body.rules) {
    assert.ok(rule.id && rule.title && rule.detail && rule.spec);
    assert.ok(["published", "assumption"].includes(rule.kind), rule.id);
  }
  const kinds = new Set(body.rules.map((r) => r.kind));
  assert.ok(kinds.has("published"));
  assert.ok(kinds.has("assumption"));
});

test("POST /api/check on the legal example returns 200 with verdict legal", async () => {
  const ex = EXAMPLES.find((e) => e.id === "legal-full-match");
  const res = await postCheck(ex.input);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.verdict, "legal");
  assert.equal(body.legalTurns, 5);
  assert.equal(body.finalState.balances.self, 115);
});

test("POST /api/check on an illegal sequence returns 200 with the right failure named", async () => {
  const ex = EXAMPLES.find((e) => e.id === "illegal-steal-nonadjacent");
  const res = await postCheck(ex.input);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.verdict, "illegal");
  assert.equal(body.illegalTurns, 1);
  assert.ok(
    body.turns[0].errors.some((e) => e.rule === "A04-steal-target-adjacent"),
  );
});

test("POST /api/check on the hold-with-amount example names R05-amount-omitted", async () => {
  const ex = EXAMPLES.find((e) => e.id === "hold-with-amount");
  const res = await postCheck(ex.input);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.verdict, "illegal");
  assert.ok(body.turns[0].errors.some((e) => e.rule === "R05-amount-omitted"));
});

test("POST /api/check on the steal-fortified-cell example names A09", async () => {
  const ex = EXAMPLES.find((e) => e.id === "steal-fortified-cell");
  const res = await postCheck(ex.input);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.verdict, "illegal");
  assert.equal(body.turns[0].verdict, "legal");
  assert.equal(body.turns[1].verdict, "illegal");
  assert.ok(
    body.turns[1].errors.some((e) => e.rule === "A09-fortified-blocks-steal"),
  );
  assert.equal(body.finalState.balances.self, 100);
});

test("POST /api/check on the envelope-state-mismatch example names A10", async () => {
  const ex = EXAMPLES.find((e) => e.id === "envelope-state-mismatch");
  const res = await postCheck(ex.input);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.verdict, "illegal");
  assert.equal(body.turns[0].verdict, "legal");
  assert.equal(body.turns[1].verdict, "illegal");
  assert.ok(body.turns[1].errors.some((e) => e.rule === "A10-envelope-state"));
});

test("POST /api/check with invalid JSON returns 400", async () => {
  const res = await postCheck("{not json", true);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error);
});

test("POST /api/check with a missing turns array returns 400", async () => {
  const res = await postCheck({ matchId: MATCH });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error);
});

test("POST /api/check with an oversized body returns 413", async () => {
  const big = " ".repeat(70 * 1024);
  const res = await postCheck(big, true);
  assert.equal(res.status, 413);
});

test("POST /api/check on a wrong-turn-order sequence still returns 200", async () => {
  const res = await postCheck({
    matchId: MATCH,
    turns: [
      { matchId: MATCH, turn: 1, action: { type: "HOLD" }, idempotencyKey: "k1" },
      { matchId: MATCH, turn: 3, action: { type: "HOLD" }, idempotencyKey: "k3" },
    ],
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.verdict, "illegal");
  assert.ok(body.turns[1].errors.some((e) => e.rule === "R02-turn-order"));
});

test("GET an unknown path returns 404 JSON", async () => {
  const res = await fetch(`${base}/no-such-path`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.ok(body.error);
});

test("responses carry no-store and nosniff headers", async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});
