// Tests for the match reconstructor: board geometry, published rules,
// assumption-model rules, and replay semantics.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ValidationError,
  cellsAdjacent,
  freshState,
  reconstructMatch,
  STARTING_BALANCE,
  MAX_TURNS,
} from "../src/reconstructor.js";
import { EXAMPLES } from "../src/examples.js";

const MATCH = "match-demo";

function seq(turns, matchId = MATCH) {
  return { matchId, turns };
}

function t(n, action, key = `k${n}`, extra = {}) {
  return { matchId: MATCH, turn: n, action, idempotencyKey: key, ...extra };
}

// All error rule ids across the whole report, in order.
function allErrorRules(report) {
  return report.turns.flatMap((turn) => turn.errors.map((e) => e.rule));
}

// --- Board geometry ---------------------------------------------------------

test("adjacency: orthogonal neighbours are adjacent", () => {
  assert.equal(cellsAdjacent("A1", "A2"), true);
  assert.equal(cellsAdjacent("A1", "B1"), true);
  assert.equal(cellsAdjacent("B2", "B3"), true);
  assert.equal(cellsAdjacent("B2", "C2"), true);
  assert.equal(cellsAdjacent("C3", "C2"), true);
});

test("adjacency: diagonals are NOT adjacent", () => {
  assert.equal(cellsAdjacent("A1", "B2"), false);
  assert.equal(cellsAdjacent("A2", "B3"), false);
  assert.equal(cellsAdjacent("B1", "C2"), false);
});

test("adjacency: same cell, distant cells, and unknown cells are not adjacent", () => {
  assert.equal(cellsAdjacent("A1", "A1"), false);
  assert.equal(cellsAdjacent("A1", "C3"), false);
  assert.equal(cellsAdjacent("A1", "Z9"), false);
  assert.equal(cellsAdjacent("Z9", "A1"), false);
});

test("fresh state starts at 100/100, turn 0, assumed board ownership", () => {
  const state = freshState();
  assert.equal(state.balances.self, STARTING_BALANCE);
  assert.equal(state.balances.opponent, STARTING_BALANCE);
  assert.equal(state.turn, 0);
  assert.equal(state.board.A1.owner, "self");
  assert.equal(state.board.A2.owner, "self");
  assert.equal(state.board.B1.owner, "self");
  assert.equal(state.board.A3.owner, "opponent");
  assert.equal(state.board.B2.owner, "opponent");
  assert.equal(state.board.C3.owner, "opponent");
  assert.equal(state.board.B3.owner, null);
  assert.equal(state.board.C1.owner, null);
  assert.equal(state.board.C2.owner, null);
  for (const cell of Object.values(state.board)) {
    assert.equal(cell.fortified, false);
  }
});

// --- Bundled examples: every example replays to its labeled verdict ---------

for (const ex of EXAMPLES) {
  test(`example ${ex.id} replays to ${ex.expectedVerdict}`, () => {
    const report = reconstructMatch(ex.input);
    assert.equal(report.verdict, ex.expectedVerdict);
    if (ex.expectedErrorRules) {
      const rules = allErrorRules(report);
      for (const rule of ex.expectedErrorRules) {
        assert.ok(rules.includes(rule), `expected ${rule} in ${rules.join(", ")}`);
      }
    }
  });
}

test("legal example ends 115/85 with B2+A3 flipped and A1 fortified", () => {
  const ex = EXAMPLES.find((e) => e.id === "legal-full-match");
  const report = reconstructMatch(ex.input);
  assert.equal(report.finalState.balances.self, 115);
  assert.equal(report.finalState.balances.opponent, 85);
  assert.equal(report.finalState.board.B2.owner, "self");
  assert.equal(report.finalState.board.A3.owner, "self");
  assert.equal(report.finalState.board.A1.fortified, true);
  assert.equal(report.complete, false);
  assert.equal(report.winner, null);
  assert.equal(report.turnsChecked, 5);
  assert.equal(report.legalTurns, 5);
  assert.equal(report.illegalTurns, 0);
});

test("turn-21 example completes 20 turns as a 100/100 tie", () => {
  const ex = EXAMPLES.find((e) => e.id === "turn-21-exceeds-cap");
  const report = reconstructMatch(ex.input);
  assert.equal(report.complete, true);
  assert.equal(report.winner, "tie");
  assert.equal(report.legalTurns, 20);
  assert.equal(report.illegalTurns, 1);
  assert.equal(report.turns[20].verdict, "illegal");
  assert.ok(report.turns[20].errors.some((e) => e.rule === "R03-turn-cap"));
});

// --- Published rules ---------------------------------------------------------

test("R01: a turn with no matchId is illegal", () => {
  const report = reconstructMatch(
    seq([{ turn: 1, action: { type: "HOLD" }, idempotencyKey: "k1" }]),
  );
  assert.equal(report.verdict, "illegal");
  assert.ok(allErrorRules(report).includes("R01-match-id"));
});

test("R01: top-level matchId binds the match; a different turn matchId fails", () => {
  const report = reconstructMatch({
    matchId: "match-a",
    turns: [
      { matchId: "match-a", turn: 1, action: { type: "HOLD" }, idempotencyKey: "k1" },
      { matchId: "match-b", turn: 2, action: { type: "HOLD" }, idempotencyKey: "k2" },
    ],
  });
  assert.equal(report.turns[0].verdict, "legal");
  assert.equal(report.turns[1].verdict, "illegal");
});

test("R02: first turn must be 1; turn 0 is out of order", () => {
  const report = reconstructMatch(seq([t(0, { type: "HOLD" })]));
  assert.ok(allErrorRules(report).includes("R02-turn-order"));
});

test("R02: a string turn is not an integer turn", () => {
  const report = reconstructMatch(
    seq([{ matchId: MATCH, turn: "1", action: { type: "HOLD" }, idempotencyKey: "k1" }]),
  );
  assert.ok(allErrorRules(report).includes("R02-turn-order"));
});

test("R02: a fractional turn is not an integer turn", () => {
  const report = reconstructMatch(
    seq([{ matchId: MATCH, turn: 1.5, action: { type: "HOLD" }, idempotencyKey: "k1" }]),
  );
  assert.ok(allErrorRules(report).includes("R02-turn-order"));
});

test("R03: turn 21 alone is illegal even as the first entry", () => {
  const report = reconstructMatch(seq([t(21, { type: "HOLD" })]));
  assert.ok(allErrorRules(report).includes("R03-turn-cap"));
});

test("R04: an unknown action is illegal", () => {
  const report = reconstructMatch(seq([t(1, { type: "JUMP" })]));
  assert.ok(allErrorRules(report).includes("R04-action-set"));
});

test("R04: action type is case-sensitive", () => {
  const report = reconstructMatch(seq([t(1, { type: "steal", amount: 5, target: "B2" })]));
  assert.ok(allErrorRules(report).includes("R04-action-set"));
});

test("R04: a missing action object is illegal", () => {
  const report = reconstructMatch(
    seq([{ matchId: MATCH, turn: 1, idempotencyKey: "k1" }]),
  );
  assert.ok(allErrorRules(report).includes("R04-action-set"));
});

test("R05: HOLD with amount null is still an error", () => {
  const report = reconstructMatch(seq([t(1, { type: "HOLD", amount: null })]));
  assert.ok(allErrorRules(report).includes("R05-amount-omitted"));
});

test("R06: a missing idempotencyKey is illegal", () => {
  const report = reconstructMatch(
    seq([{ matchId: MATCH, turn: 1, action: { type: "HOLD" } }]),
  );
  assert.ok(allErrorRules(report).includes("R06-idempotency-unique"));
});

test("R06: an empty-string idempotencyKey is illegal", () => {
  const report = reconstructMatch(seq([t(1, { type: "HOLD" }, "")]));
  assert.ok(allErrorRules(report).includes("R06-idempotency-unique"));
});

test("R07: a full 20-turn HOLD match ends 100/100 with no winner but a tie", () => {
  const turns = [];
  for (let i = 1; i <= MAX_TURNS; i++) {
    turns.push(t(i, { type: "HOLD" }));
  }
  const report = reconstructMatch(seq(turns));
  assert.equal(report.verdict, "legal");
  assert.equal(report.complete, true);
  assert.equal(report.winner, "tie");
  assert.equal(report.finalState.balances.self, 100);
  assert.equal(report.finalState.balances.opponent, 100);
});

test("R10: a 20-turn match with a steal lead names self as winner", () => {
  const turns = [t(1, { type: "STEAL", amount: 10, target: "B2" })];
  for (let i = 2; i <= MAX_TURNS; i++) {
    turns.push(t(i, { type: "HOLD" }));
  }
  const report = reconstructMatch(seq(turns));
  assert.equal(report.verdict, "legal");
  assert.equal(report.complete, true);
  assert.equal(report.winner, "self");
  assert.equal(report.finalState.balances.self, 110);
  assert.equal(report.finalState.balances.opponent, 90);
});

// --- Assumption-model rules --------------------------------------------------

test("R08: STEAL with a missing amount is illegal", () => {
  const report = reconstructMatch(seq([t(1, { type: "STEAL", target: "B2" })]));
  assert.ok(allErrorRules(report).includes("R08-steal-amount"));
});

test("R08: STEAL with amount 0 is illegal", () => {
  const report = reconstructMatch(seq([t(1, { type: "STEAL", amount: 0, target: "B2" })]));
  assert.ok(allErrorRules(report).includes("R08-steal-amount"));
});

test("R08: STEAL with a negative amount is illegal", () => {
  const report = reconstructMatch(seq([t(1, { type: "STEAL", amount: -5, target: "B2" })]));
  assert.ok(allErrorRules(report).includes("R08-steal-amount"));
});

test("R08: STEAL with a fractional amount is illegal", () => {
  const report = reconstructMatch(seq([t(1, { type: "STEAL", amount: 2.5, target: "B2" })]));
  assert.ok(allErrorRules(report).includes("R08-steal-amount"));
});

test("R08: STEAL with a string amount is illegal", () => {
  const report = reconstructMatch(
    seq([t(1, { type: "STEAL", amount: "10", target: "B2" })]),
  );
  assert.ok(allErrorRules(report).includes("R08-steal-amount"));
});

test("R09 boundary: STEAL of exactly the victim's whole balance is legal", () => {
  const report = reconstructMatch(
    seq([t(1, { type: "STEAL", amount: 100, target: "B2" })]),
  );
  assert.equal(report.verdict, "legal");
  assert.equal(report.finalState.balances.self, 200);
  assert.equal(report.finalState.balances.opponent, 0);
});

test("R09: a STEAL just over the victim's balance is illegal", () => {
  const report = reconstructMatch(
    seq([t(1, { type: "STEAL", amount: 101, target: "B2" })]),
  );
  assert.ok(allErrorRules(report).includes("R09-steal-within-balance"));
});

test("A03: STEAL with an unknown cell is illegal", () => {
  const report = reconstructMatch(seq([t(1, { type: "STEAL", amount: 5, target: "D4" })]));
  assert.ok(allErrorRules(report).includes("A03-steal-target-opponent"));
});

test("A03: STEAL with no target is illegal", () => {
  const report = reconstructMatch(seq([t(1, { type: "STEAL", amount: 5 })]));
  assert.ok(allErrorRules(report).includes("A03-steal-target-opponent"));
});

test("A05: FORTIFY with an unknown cell is illegal", () => {
  const report = reconstructMatch(seq([t(1, { type: "FORTIFY", target: "Z9" })]));
  assert.ok(allErrorRules(report).includes("A05-fortify-target-owned"));
});

test("A06: HOLD with a target is illegal", () => {
  const report = reconstructMatch(seq([t(1, { type: "HOLD", target: "A1" })]));
  assert.ok(allErrorRules(report).includes("A06-hold-no-target"));
});

test("A08: an unknown actor value is illegal", () => {
  const report = reconstructMatch(
    seq([t(1, { type: "HOLD" }, "k1", { actor: "third" })]),
  );
  assert.ok(allErrorRules(report).includes("A08-actor"));
});

test("A08: an opponent turn steals the other way and flips the cell", () => {
  const report = reconstructMatch(
    seq([
      t(1, { type: "STEAL", amount: 10, target: "A2" }, "k1", { actor: "opponent" }),
    ]),
  );
  assert.equal(report.verdict, "legal");
  assert.equal(report.finalState.balances.self, 90);
  assert.equal(report.finalState.balances.opponent, 110);
  assert.equal(report.finalState.board.A2.owner, "opponent");
});

test("A07: an illegal turn applies nothing and later turns still check against the legal state", () => {
  const report = reconstructMatch(
    seq([
      t(1, { type: "STEAL", amount: 150, target: "B2" }),
      t(2, { type: "STEAL", amount: 10, target: "B2" }),
    ]),
  );
  assert.equal(report.turns[0].verdict, "illegal");
  assert.equal(report.turns[0].stateAfter.balances.self, 100);
  assert.equal(report.turns[0].stateAfter.balances.opponent, 100);
  assert.equal(report.turns[1].verdict, "legal");
  assert.equal(report.finalState.balances.self, 110);
  assert.equal(report.finalState.balances.opponent, 90);
});

test("A07: sequential legal steals accumulate balances and ownership", () => {
  const report = reconstructMatch(
    seq([
      t(1, { type: "STEAL", amount: 10, target: "B2" }),
      t(2, { type: "STEAL", amount: 5, target: "A3" }),
    ]),
  );
  assert.equal(report.verdict, "legal");
  assert.equal(report.finalState.board.B2.owner, "self");
  assert.equal(report.finalState.board.A3.owner, "self");
  assert.equal(report.finalState.balances.self, 115);
  assert.equal(report.finalState.balances.opponent, 85);
});

test("FORTIFY marks the cell and a later STEAL of it by the owner fails ownership", () => {
  const report = reconstructMatch(
    seq([
      t(1, { type: "FORTIFY", target: "A1" }),
      t(2, { type: "STEAL", amount: 5, target: "A1" }),
    ]),
  );
  assert.equal(report.turns[0].verdict, "legal");
  assert.equal(report.turns[0].stateAfter.board.A1.fortified, true);
  assert.equal(report.turns[1].verdict, "illegal");
});

test("A10: envelope state matching the reconstruction is legal", () => {
  const report = reconstructMatch(
    seq([
      t(1, { type: "STEAL", amount: 10, target: "B2" }, "k1", {
        state: { self: 100, opponent: 100 },
      }),
      t(2, { type: "HOLD" }, "k2", { state: { self: 110, opponent: 90 } }),
    ]),
  );
  assert.equal(report.verdict, "legal");
});

test("A10: envelope state disagreeing on self is illegal", () => {
  const report = reconstructMatch(
    seq([t(1, { type: "HOLD" }, "k1", { state: { self: 99, opponent: 100 } })]),
  );
  assert.equal(report.verdict, "illegal");
  assert.ok(allErrorRules(report).includes("A10-envelope-state"));
});

test("A10: envelope state disagreeing on opponent is illegal", () => {
  const report = reconstructMatch(
    seq([t(1, { type: "HOLD" }, "k1", { state: { self: 100, opponent: 101 } })]),
  );
  assert.ok(allErrorRules(report).includes("A10-envelope-state"));
});

test("A10: a malformed envelope state is illegal", () => {
  const report = reconstructMatch(
    seq([t(1, { type: "HOLD" }, "k1", { state: "100/100" })]),
  );
  assert.ok(allErrorRules(report).includes("A10-envelope-state"));
  const report2 = reconstructMatch(
    seq([t(1, { type: "HOLD" }, "k1", { state: { self: "100", opponent: 100 } })]),
  );
  assert.ok(allErrorRules(report2).includes("A10-envelope-state"));
});

test("A10: a turn without envelope state skips the cross-check", () => {
  const report = reconstructMatch(seq([t(1, { type: "HOLD" })]));
  assert.equal(report.verdict, "legal");
});

test("A09: stealing a fortified cell is illegal and changes nothing", () => {
  const report = reconstructMatch(
    seq([
      t(1, { type: "FORTIFY", target: "B2" }, "k1", { actor: "opponent" }),
      t(2, { type: "STEAL", amount: 5, target: "B2" }, "k2"),
    ]),
  );
  assert.equal(report.turns[0].verdict, "legal");
  assert.equal(report.turns[1].verdict, "illegal");
  assert.ok(
    report.turns[1].errors.some((e) => e.rule === "A09-fortified-blocks-steal"),
  );
  assert.equal(report.turns[1].errors.length, 1);
  assert.equal(report.finalState.board.B2.owner, "opponent");
  assert.equal(report.finalState.board.B2.fortified, true);
  assert.equal(report.finalState.balances.self, 100);
  assert.equal(report.finalState.balances.opponent, 100);
});

test("A09: a fortified cell cannot be stolen back after changing hands either", () => {
  const report = reconstructMatch(
    seq([
      t(1, { type: "STEAL", amount: 10, target: "B2" }),
      t(2, { type: "FORTIFY", target: "B2" }),
      t(3, { type: "STEAL", amount: 5, target: "B2" }, "k3", { actor: "opponent" }),
    ]),
  );
  // Turn 2 fortifies B2 (now self-owned); turn 3 opponent steals it back:
  // B2 is fortified, so the steal must fail (and it is also not adjacent
  // to any opponent cell, so A04 fails too).
  assert.equal(report.turns[2].verdict, "illegal");
  assert.ok(
    report.turns[2].errors.some((e) => e.rule === "A09-fortified-blocks-steal"),
  );
});

test("a non-object turn entry is reported illegal without stopping the replay", () => {
  const report = reconstructMatch(seq(["not-a-turn", t(1, { type: "HOLD" })]));
  assert.equal(report.verdict, "illegal");
  assert.equal(report.turns[0].verdict, "illegal");
  assert.equal(report.turns[1].verdict, "legal");
});

test("one turn can fail several rules at once and reports all of them", () => {
  const report = reconstructMatch(
    seq([
      t(1, { type: "HOLD", amount: 5, target: "A1" }, "k1"),
    ]),
  );
  const rules = allErrorRules(report);
  assert.ok(rules.includes("R05-amount-omitted"));
  assert.ok(rules.includes("A06-hold-no-target"));
  assert.equal(report.turns[0].errors.length, 2);
});

// --- Envelope validation ------------------------------------------------------

test("ValidationError: a non-object body is rejected", () => {
  assert.throws(() => reconstructMatch("nope"), ValidationError);
  assert.throws(() => reconstructMatch([1, 2]), ValidationError);
  assert.throws(() => reconstructMatch(null), ValidationError);
});

test("ValidationError: a missing turns array is rejected", () => {
  assert.throws(() => reconstructMatch({ matchId: MATCH }), ValidationError);
  assert.throws(() => reconstructMatch({ turns: "nope" }), ValidationError);
});

test("ValidationError: an empty turns array is rejected", () => {
  assert.throws(() => reconstructMatch({ turns: [] }), ValidationError);
});

test("ValidationError: more than 64 turn entries are rejected", () => {
  const turns = [];
  for (let i = 1; i <= 65; i++) {
    turns.push(t(i, { type: "HOLD" }));
  }
  assert.throws(() => reconstructMatch(seq(turns)), ValidationError);
});

test("ValidationError: a non-string top-level matchId is rejected", () => {
  assert.throws(() => reconstructMatch({ matchId: 42, turns: [t(1, { type: "HOLD" })] }), ValidationError);
});
