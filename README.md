# Steal-the-VFY Match Reconstructor

Replay a match's turn sequence and prove each move was legal.

Paste a match (`matchId` + ordered turn envelopes/responses) and the tool
reconstructs the state after every turn — balances, board ownership,
fortifications — and gives a per-turn **LEGAL / ILLEGAL** verdict against the
published Steal-the-VFY rules. Where a turn is illegal, the report names every
rule it broke, and the turn is not applied: replay continues from the last
legal state.

This is the complement to the single-turn shape checker (Wildcard 11): W11
validates the shape of **one** turn response; this tool validates the **game
logic across a sequence** — turn order, ownership, adjacency, and balance
evolution over a whole match.

## What is published vs assumed

Published rules (SPEC.md §4) enforced here:

- 20 turns per match, 100 VFY starting balance each, highest balance wins
- Actions are STEAL, HOLD, FORTIFY only
- `amount` must be omitted entirely for HOLD or FORTIFY (even 0 or null)
- `idempotencyKey` is unique per turn; only the first submission per key counts
- `matchId` and `turn` are echoed exactly

The platform has published **no board, cells, ownership, or adjacency**. To
check ownership and adjacency at all, the tool assumes a 3×3 grid (A1–C3,
orthogonal adjacency only) with starting ownership self: A1, A2, B1 —
opponent: A3, B2, C3 — neutral: B3, C1, C2. Every board rule is labeled
`assumption` in the UI and in `GET /api/rules`, never asserted as protocol.

## Honest scope

State reconstruction + legality only. No live data, no proofs generated or
verified, no platform calls, nothing stored. Pasted sequences are replayed in
memory and discarded.

## Run

```sh
npm test     # test suite (node --test, zero dependencies)
npm start    # serves on $PORT (default 3000)
```

## API

- `GET /` — UI
- `GET /health`, `GET /api/health` — `{ service: "vfy-match-reconstructor", version, status: "ok" }`
- `GET /api/examples` — bundled examples, each labeled with its expected verdict
- `GET /api/rules` — every check with its SPEC section reference (or assumption label)
- `POST /api/check` — `{ matchId?, turns: [...] }` → reconstructed states + per-turn verdicts

Turn shape: `{ "matchId", "turn", "actor"?, "action": { "type", "amount"?, "target"? },
"idempotencyKey"?, "state"? }`. `actor` defaults to `"self"`; `"opponent"` replays the
other side's turns. `state` is the optional envelope-reported balances
`{ "self", "opponent" }` before the turn, cross-checked against the reconstruction.

## Deploy

Vercel, Framework Preset Node, Deployment Protection OFF. `vercel --prod`.

## License

MIT — see LICENSE.
