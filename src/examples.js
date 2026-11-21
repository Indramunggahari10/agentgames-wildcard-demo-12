// Bundled examples. Each one labels its expected verdict so the UI and the
// test suite can check the tool against it. The matchId "match-demo" is
// shared by design: every turn in one example belongs to one match.
//
// Assumed starting board (see rules A01/A02):
//   A: self self opp | B: self opp neutral | C: neutral neutral opp
// Balances start 100 / 100.

function turn(matchId, n, action, key, extra = {}) {
  return { matchId, turn: n, action, idempotencyKey: key, ...extra };
}

function holds(matchId, from, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(
      turn(matchId, from + i, { type: "HOLD" }, `key-hold-${from + i}`),
    );
  }
  return out;
}

const MATCH = "match-demo";

export const EXAMPLES = [
  {
    id: "legal-full-match",
    title: "Legal full sequence — STEAL, HOLD, FORTIFY, STEAL, HOLD",
    description:
      "The passing baseline: every rule green. STEAL B2 (adjacent to A2, opponent-owned) moves 10 VFY, a HOLD changes nothing, FORTIFY A1 (self-owned) marks the cell, STEAL A3 moves 5 VFY, and a final HOLD closes at 115 / 85. Match incomplete (5 of 20 turns), so no winner is declared.",
    expectedVerdict: "legal",
    input: {
      matchId: MATCH,
      turns: [
        turn(MATCH, 1, { type: "STEAL", amount: 10, target: "B2" }, "key-1"),
        turn(MATCH, 2, { type: "HOLD" }, "key-2"),
        turn(MATCH, 3, { type: "FORTIFY", target: "A1" }, "key-3"),
        turn(MATCH, 4, { type: "STEAL", amount: 5, target: "A3" }, "key-4"),
        turn(MATCH, 5, { type: "HOLD" }, "key-5"),
      ],
    },
  },
  {
    id: "illegal-steal-nonadjacent",
    title: "Illegal STEAL — target not adjacent",
    description:
      "Turn 1 steals C3. C3 is opponent-owned, but it touches only B3 and C2 — neither is owned by self — so the STEAL is not adjacent to any self cell (rule A04). Expected failure: A04-steal-target-adjacent.",
    expectedVerdict: "illegal",
    expectedErrorRules: ["A04-steal-target-adjacent"],
    input: {
      matchId: MATCH,
      turns: [turn(MATCH, 1, { type: "STEAL", amount: 10, target: "C3" }, "key-1")],
    },
  },
  {
    id: "illegal-steal-unowned-target",
    title: "Illegal STEAL — target is unowned (neutral)",
    description:
      "Turn 1 steals C1. C1 is orthogonally adjacent to self-owned B1, so adjacency passes — but C1 is neutral, owned by nobody, and a STEAL target must be owned by the opponent (rule A03). Expected failure: A03-steal-target-opponent.",
    expectedVerdict: "illegal",
    expectedErrorRules: ["A03-steal-target-opponent"],
    input: {
      matchId: MATCH,
      turns: [turn(MATCH, 1, { type: "STEAL", amount: 10, target: "C1" }, "key-1")],
    },
  },
  {
    id: "illegal-steal-own-cell",
    title: "Illegal STEAL — target is the actor's own cell",
    description:
      "Turn 1 steals A2, which self already owns. A STEAL target must be owned by the opponent (rule A03). Expected failure: A03-steal-target-opponent.",
    expectedVerdict: "illegal",
    expectedErrorRules: ["A03-steal-target-opponent"],
    input: {
      matchId: MATCH,
      turns: [turn(MATCH, 1, { type: "STEAL", amount: 10, target: "A2" }, "key-1")],
    },
  },
  {
    id: "illegal-fortify-unowned",
    title: "Illegal FORTIFY — target is unowned (neutral)",
    description:
      "Turn 1 fortifies C2, a neutral cell. FORTIFY only works on a cell the actor owns (rule A05). Expected failure: A05-fortify-target-owned.",
    expectedVerdict: "illegal",
    expectedErrorRules: ["A05-fortify-target-owned"],
    input: {
      matchId: MATCH,
      turns: [turn(MATCH, 1, { type: "FORTIFY", target: "C2" }, "key-1")],
    },
  },
  {
    id: "illegal-fortify-opponent-cell",
    title: "Illegal FORTIFY — target belongs to the opponent",
    description:
      "Turn 1 fortifies B2, which the opponent owns. FORTIFY only works on the actor's own cells (rule A05). Expected failure: A05-fortify-target-owned.",
    expectedVerdict: "illegal",
    expectedErrorRules: ["A05-fortify-target-owned"],
    input: {
      matchId: MATCH,
      turns: [turn(MATCH, 1, { type: "FORTIFY", target: "B2" }, "key-1")],
    },
  },
  {
    id: "wrong-turn-order",
    title: "Illegal — wrong turn order (turn 3 follows turn 1)",
    description:
      "Turn 1 is legal, then the sequence jumps to turn 3. Turns must run 1, 2, 3, … with no gaps (rule R02). Expected failure on turn 3: R02-turn-order. The replay still checks the turn's action, but applies nothing.",
    expectedVerdict: "illegal",
    expectedErrorRules: ["R02-turn-order"],
    input: {
      matchId: MATCH,
      turns: [
        turn(MATCH, 1, { type: "HOLD" }, "key-1"),
        turn(MATCH, 3, { type: "HOLD" }, "key-3"),
      ],
    },
  },
  {
    id: "duplicate-turn",
    title: "Illegal — duplicate turn number",
    description:
      "Turn 2 appears twice. The second copy is both a duplicate and out of order (rule R02): only the first submission of a turn counts. Expected failure on the second turn 2: R02-turn-order.",
    expectedVerdict: "illegal",
    expectedErrorRules: ["R02-turn-order"],
    input: {
      matchId: MATCH,
      turns: [
        turn(MATCH, 1, { type: "HOLD" }, "key-1"),
        turn(MATCH, 2, { type: "HOLD" }, "key-2"),
        turn(MATCH, 2, { type: "HOLD" }, "key-2b"),
      ],
    },
  },
  {
    id: "hold-with-amount",
    title: "Illegal — HOLD carries an amount",
    description:
      "Turn 1 holds with amount 5. The published rule is that amount must be omitted entirely for HOLD — present even as a number is an error (rule R05). Expected failure: R05-amount-omitted.",
    expectedVerdict: "illegal",
    expectedErrorRules: ["R05-amount-omitted"],
    input: {
      matchId: MATCH,
      turns: [turn(MATCH, 1, { type: "HOLD", amount: 5 }, "key-1")],
    },
  },
  {
    id: "fortify-with-amount-zero",
    title: "Illegal — FORTIFY carries amount 0",
    description:
      "Turn 1 fortifies A1 with amount 0. The schema rejects the field even when 0 — the single most expensive shape mistake in the protocol (rule R05). Expected failure: R05-amount-omitted.",
    expectedVerdict: "illegal",
    expectedErrorRules: ["R05-amount-omitted"],
    input: {
      matchId: MATCH,
      turns: [turn(MATCH, 1, { type: "FORTIFY", target: "A1", amount: 0 }, "key-1")],
    },
  },
  {
    id: "steal-over-balance",
    title: "Illegal — STEAL amount exceeds the victim's balance",
    description:
      "Turn 1 steals 150 VFY from an opponent holding 100. Balances are conserved and never go negative under the assumed model (rule R09). Expected failure: R09-steal-within-balance.",
    expectedVerdict: "illegal",
    expectedErrorRules: ["R09-steal-within-balance"],
    input: {
      matchId: MATCH,
      turns: [turn(MATCH, 1, { type: "STEAL", amount: 150, target: "B2" }, "key-1")],
    },
  },
  {
    id: "duplicate-idempotency-key",
    title: "Illegal — idempotencyKey reused",
    description:
      "Turns 1 and 2 both use key 'key-same'. Only the first submission per key counts (rule R06), so the second turn is a replay. Expected failure on turn 2: R06-idempotency-unique.",
    expectedVerdict: "illegal",
    expectedErrorRules: ["R06-idempotency-unique"],
    input: {
      matchId: MATCH,
      turns: [
        turn(MATCH, 1, { type: "HOLD" }, "key-same"),
        turn(MATCH, 2, { type: "HOLD" }, "key-same"),
      ],
    },
  },
  {
    id: "matchid-mismatch",
    title: "Illegal — turn names a different match",
    description:
      "Turn 2 carries matchId 'match-other' inside the match-demo sequence. Every turn must echo the same matchId (rule R01). Expected failure on turn 2: R01-match-id.",
    expectedVerdict: "illegal",
    expectedErrorRules: ["R01-match-id"],
    input: {
      matchId: MATCH,
      turns: [
        turn(MATCH, 1, { type: "HOLD" }, "key-1"),
        turn("match-other", 2, { type: "HOLD" }, "key-2"),
      ],
    },
  },
  {
    id: "turn-21-exceeds-cap",
    title: "Illegal — 21st turn exceeds the 20-turn cap",
    description:
      "Twenty legal HOLDs fill the match, then a 21st turn arrives. A match is 20 turns (rule R03), so turn 21 is illegal and changes nothing. The completed match at turn 20 ends 100 / 100 — a tie. Expected failure on turn 21: R03-turn-cap.",
    expectedVerdict: "illegal",
    expectedErrorRules: ["R03-turn-cap"],
    input: {
      matchId: MATCH,
      turns: [
        ...holds(MATCH, 1, 20),
        turn(MATCH, 21, { type: "HOLD" }, "key-21"),
      ],
    },
  },
];
