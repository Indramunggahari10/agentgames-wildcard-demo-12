// Steal-the-VFY Match Reconstructor — pure state replay + legality verdicts.
//
// The published protocol (SPEC.md §4) gives: 20 turns per match, 100 VFY
// starting balance each, actions STEAL / HOLD / FORTIFY, amount omitted
// entirely for HOLD/FORTIFY, idempotencyKey unique per turn, matchId and
// turn echoed exactly, highest balance wins. Everything about a board —
// cells, ownership, adjacency, what FORTIFY protects — is NOT published,
// so it lives in the explicitly-labeled assumption model below and is
// never asserted as protocol.
//
// Input shape (one match):
//   { matchId?: string, turns: [ { matchId, turn, actor?, action, idempotencyKey?, state? } ] }
//   action: { type: "STEAL"|"HOLD"|"FORTIFY", amount?, target? }
//   state:  optional envelope balances { self, opponent } as reported by the
//           platform before this turn (cross-checked against the
//           reconstruction; a mismatch is illegal under rule A10).
//
// An illegal turn is reported with every rule it broke and is NOT applied:
// replay continues from the last legal state.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

export const SERVICE_NAME = "vfy-match-reconstructor";
export const SERVICE_VERSION = "1.0.0";
export const STARTING_BALANCE = 100;
export const MAX_TURNS = 20;
export const MAX_INPUT_TURNS = 64;
export const ACTIONS = ["STEAL", "HOLD", "FORTIFY"];

// --- Assumed board model (NOT published — see rules A01/A02) -----------------
//   1     2     3
// A self  self  opp
// B self  opp   neutral
// C neut  neut  opp
export const CELLS = ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"];

export const INITIAL_BOARD = {
  A1: "self",
  A2: "self",
  A3: "opponent",
  B1: "self",
  B2: "opponent",
  B3: null,
  C1: null,
  C2: null,
  C3: "opponent",
};

const ROWS = { A: 0, B: 1, C: 2 };

export function cellsAdjacent(a, b) {
  if (!CELLS.includes(a) || !CELLS.includes(b) || a === b) return false;
  const rowDiff = Math.abs(ROWS[a[0]] - ROWS[b[0]]);
  const colDiff = Math.abs(Number(a[1]) - Number(b[1]));
  // Orthogonal only: exactly one step in exactly one direction.
  return (rowDiff === 1 && colDiff === 0) || (rowDiff === 0 && colDiff === 1);
}

export function otherSide(side) {
  return side === "self" ? "opponent" : "self";
}

export function freshState() {
  const board = {};
  for (const cell of CELLS) {
    board[cell] = { owner: INITIAL_BOARD[cell], fortified: false };
  }
  return {
    turn: 0,
    balances: { self: STARTING_BALANCE, opponent: STARTING_BALANCE },
    board,
  };
}

// A plain JSON copy of a state, for embedding in per-turn reports.
export function stateSnapshot(state) {
  const board = {};
  for (const cell of CELLS) {
    board[cell] = { ...state.board[cell] };
  }
  return {
    turn: state.turn,
    balances: { ...state.balances },
    board,
  };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function fail(errors, ruleId, message) {
  errors.push({ rule: ruleId, message });
}

// Checks one turn against the current state. Returns { errors, applied }.
// `errors` is empty exactly when the turn is legal. The state is mutated
// only when the turn is legal (an illegal turn is never applied).
function checkOneTurn(turn, ctx, state) {
  const errors = [];
  const actor =
    turn.actor === undefined ? "self" : turn.actor;
  const victim = otherSide(actor);
  const action = turn.action && typeof turn.action === "object" ? turn.action : null;

  // R01 — matchId present and identical across the sequence.
  if (!isNonEmptyString(turn.matchId)) {
    fail(errors, "R01-match-id", "matchId is missing or not a non-empty string.");
  } else if (ctx.matchId === null) {
    ctx.matchId = turn.matchId;
  } else if (turn.matchId !== ctx.matchId) {
    fail(
      errors,
      "R01-match-id",
      `matchId "${turn.matchId}" does not match the match "${ctx.matchId}".`,
    );
  }

  // R02 — turn order: integer, first 1, then +1 each time; repeats flagged.
  // Numbering is judged against the previous turn's NUMBER, not against
  // whether the previous turn's action was legal: an illegal action does
  // not make the next turn's number wrong.
  if (typeof turn.turn !== "number" || !Number.isInteger(turn.turn)) {
    fail(errors, "R02-turn-order", "turn must be an integer.");
  } else {
    if (ctx.seenTurns.has(turn.turn)) {
      fail(errors, "R02-turn-order", `turn ${turn.turn} already appeared: duplicate turn.`);
    }
    if (turn.turn !== ctx.expectedTurn) {
      fail(
        errors,
        "R02-turn-order",
        `turn ${turn.turn} is out of order: expected turn ${ctx.expectedTurn}.`,
      );
    }
    if (turn.turn >= ctx.expectedTurn) {
      ctx.expectedTurn = turn.turn + 1;
    }
  }

  // R03 — the match is 20 turns long.
  if (
    typeof turn.turn === "number" &&
    Number.isInteger(turn.turn) &&
    turn.turn > MAX_TURNS
  ) {
    fail(errors, "R03-turn-cap", `turn ${turn.turn} exceeds the 20-turn match cap.`);
  }

  // R04 — action set.
  if (!action || !ACTIONS.includes(action.type)) {
    fail(
      errors,
      "R04-action-set",
      `action must be one of ${ACTIONS.join(", ")}; got ${JSON.stringify(action ? action.type : action)}.`,
    );
  }

  // R05 — amount omitted entirely for HOLD / FORTIFY (even 0 or null).
  if (action && (action.type === "HOLD" || action.type === "FORTIFY")) {
    if (Object.prototype.hasOwnProperty.call(action, "amount")) {
      fail(
        errors,
        "R05-amount-omitted",
        `${action.type} must omit amount entirely; amount was present (${JSON.stringify(action.amount)}).`,
      );
    }
  }

  // R06 — idempotencyKey present, non-empty, never reused.
  if (!isNonEmptyString(turn.idempotencyKey)) {
    fail(errors, "R06-idempotency-unique", "idempotencyKey is missing or not a non-empty string.");
  } else if (ctx.usedKeys.has(turn.idempotencyKey)) {
    fail(
      errors,
      "R06-idempotency-unique",
      `idempotencyKey "${turn.idempotencyKey}" was already used: only the first submission per key counts.`,
    );
  }

  // A08 — actor must be a known side when given.
  if (turn.actor !== undefined && turn.actor !== "self" && turn.actor !== "opponent") {
    fail(errors, "A08-actor", `actor must be "self" or "opponent"; got ${JSON.stringify(turn.actor)}.`);
  }

  // A10 — envelope state (when supplied) must match the reconstruction
  // BEFORE this turn is applied.
  if (turn.state !== undefined) {
    const st = turn.state;
    if (
      !st ||
      typeof st !== "object" ||
      Array.isArray(st) ||
      typeof st.self !== "number" ||
      typeof st.opponent !== "number"
    ) {
      fail(
        errors,
        "A10-envelope-state",
        "Envelope state must be an object with numeric self and opponent balances.",
      );
    } else if (
      st.self !== state.balances.self ||
      st.opponent !== state.balances.opponent
    ) {
      fail(
        errors,
        "A10-envelope-state",
        `Envelope state self ${st.self} / opponent ${st.opponent} does not match the reconstructed balances self ${state.balances.self} / opponent ${state.balances.opponent} before this turn.`,
      );
    }
  }

  // Action-specific rules. These run even when structural rules above
  // failed, so one turn can report every rule it broke.
  if (action && ACTIONS.includes(action.type)) {
    if (action.type === "STEAL") {
      // R08 — STEAL needs a positive integer amount.
      if (
        typeof action.amount !== "number" ||
        !Number.isInteger(action.amount) ||
        action.amount <= 0
      ) {
        fail(
          errors,
          "R08-steal-amount",
          `STEAL amount must be a positive integer; got ${JSON.stringify(action.amount)}.`,
        );
      } else if (action.amount > state.balances[victim]) {
        // R09 — never steal more than the victim holds.
        fail(
          errors,
          "R09-steal-within-balance",
          `STEAL amount ${action.amount} exceeds the victim's balance of ${state.balances[victim]} VFY.`,
        );
      }
      // A03 — target must be a cell owned by the victim.
      if (typeof action.target !== "string" || !CELLS.includes(action.target)) {
        fail(
          errors,
          "A03-steal-target-opponent",
          `STEAL target must be a board cell (A1–C3); got ${JSON.stringify(action.target)}.`,
        );
      } else if (state.board[action.target].owner !== victim) {
        const owner = state.board[action.target].owner;
        fail(
          errors,
          "A03-steal-target-opponent",
          `STEAL target ${action.target} is ${owner === null ? "unowned (neutral)" : `owned by ${owner}`} — a STEAL target must be owned by the ${victim}.`,
        );
      } else {
        // A09 — a fortified cell cannot be stolen, even when owned by the
        // victim and adjacent.
        if (state.board[action.target].fortified) {
          fail(
            errors,
            "A09-fortified-blocks-steal",
            `STEAL target ${action.target} is fortified — a fortified cell cannot be stolen.`,
          );
        }
        // A04 — target must be adjacent to a cell the actor owns.
        const reaches = CELLS.some(
          (cell) =>
            state.board[cell].owner === actor && cellsAdjacent(cell, action.target),
        );
        if (!reaches) {
          fail(
            errors,
            "A04-steal-target-adjacent",
            `STEAL target ${action.target} is not orthogonally adjacent to any cell owned by ${actor}.`,
          );
        }
      }
    }

    if (action.type === "FORTIFY") {
      // A05 — target must be a cell owned by the actor.
      if (typeof action.target !== "string" || !CELLS.includes(action.target)) {
        fail(
          errors,
          "A05-fortify-target-owned",
          `FORTIFY target must be a board cell (A1–C3); got ${JSON.stringify(action.target)}.`,
        );
      } else if (state.board[action.target].owner !== actor) {
        const owner = state.board[action.target].owner;
        fail(
          errors,
          "A05-fortify-target-owned",
          `FORTIFY target ${action.target} is ${owner === null ? "unowned (neutral)" : `owned by ${owner}`} — FORTIFY only works on a cell the ${actor} owns.`,
        );
      }
    }

    if (action.type === "HOLD") {
      // A06 — HOLD names no cell.
      if (action.target !== undefined) {
        fail(errors, "A06-hold-no-target", `HOLD must not name a target; got ${JSON.stringify(action.target)}.`);
      }
    }
  }

  const legal = errors.length === 0;

  if (legal) {
    // Apply the turn to the state.
    if (typeof turn.turn === "number") {
      ctx.seenTurns.add(turn.turn);
      state.turn = turn.turn;
    }
    if (isNonEmptyString(turn.idempotencyKey)) ctx.usedKeys.add(turn.idempotencyKey);
    if (action.type === "STEAL") {
      state.balances[victim] -= action.amount;
      state.balances[actor] += action.amount;
      state.board[action.target].owner = actor;
      state.board[action.target].fortified = false;
    } else if (action.type === "FORTIFY") {
      state.board[action.target].fortified = true;
    }
    // HOLD changes nothing.
  } else {
    // Illegal turn: record the turn number / key so repeats are still
    // detectable, but apply nothing (A07).
    if (typeof turn.turn === "number" && Number.isInteger(turn.turn)) {
      ctx.seenTurns.add(turn.turn);
    }
    if (isNonEmptyString(turn.idempotencyKey)) ctx.usedKeys.add(turn.idempotencyKey);
  }

  return { errors, applied: legal };
}

// Replays a whole match. Throws ValidationError on a malformed envelope.
export function reconstructMatch(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError("Body must be a JSON object with a turns array.");
  }
  if (!Array.isArray(input.turns)) {
    throw new ValidationError("Body must contain a turns array.");
  }
  if (input.turns.length === 0) {
    throw new ValidationError("turns must contain at least one turn.");
  }
  if (input.turns.length > MAX_INPUT_TURNS) {
    throw new ValidationError(`turns must contain at most ${MAX_INPUT_TURNS} entries.`);
  }
  if (
    input.matchId !== undefined &&
    !isNonEmptyString(input.matchId)
  ) {
    throw new ValidationError("matchId, when present, must be a non-empty string.");
  }

  const state = freshState();
  const ctx = {
    matchId: input.matchId !== undefined ? input.matchId : null,
    expectedTurn: 1,
    seenTurns: new Set(),
    usedKeys: new Set(),
  };

  const turnReports = [];
  let illegalCount = 0;

  for (const rawTurn of input.turns) {
    if (!rawTurn || typeof rawTurn !== "object" || Array.isArray(rawTurn)) {
      turnReports.push({
        turn: null,
        verdict: "illegal",
        errors: [{ rule: "R01-match-id", message: "Turn entry must be a JSON object." }],
        stateAfter: stateSnapshot(state),
      });
      illegalCount += 1;
      continue;
    }
    const { errors, applied } = checkOneTurn(rawTurn, ctx, state);
    if (!applied) illegalCount += 1;
    turnReports.push({
      turn: typeof rawTurn.turn === "number" ? rawTurn.turn : null,
      action: rawTurn.action && typeof rawTurn.action === "object" ? rawTurn.action.type ?? null : null,
      actor: rawTurn.actor === undefined ? "self" : rawTurn.actor,
      verdict: applied ? "legal" : "illegal",
      errors,
      stateAfter: stateSnapshot(state),
    });
  }

  const complete = state.turn === MAX_TURNS;
  let winner = null;
  if (complete) {
    if (state.balances.self > state.balances.opponent) winner = "self";
    else if (state.balances.opponent > state.balances.self) winner = "opponent";
    else winner = "tie";
  }

  return {
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    matchId: ctx.matchId,
    verdict: illegalCount === 0 ? "legal" : "illegal",
    turnsChecked: input.turns.length,
    legalTurns: input.turns.length - illegalCount,
    illegalTurns: illegalCount,
    complete,
    winner,
    finalState: stateSnapshot(state),
    turns: turnReports,
  };
}
