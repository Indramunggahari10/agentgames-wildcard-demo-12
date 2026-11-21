// Rule catalog for the Steal-the-VFY Match Reconstructor.
//
// Every rule is either PUBLISHED (derivable from the published Steal-the-VFY
// protocol, SPEC.md section 4) or ASSUMPTION (the platform has not published
// it; the tool states it openly and never presents it as protocol).
// `spec` names the source so a reviewer can check each claim.

export const RULES = [
  {
    id: "R01-match-id",
    kind: "published",
    spec: "SPEC.md §4 — response echoes matchId exactly",
    title: "MatchId is present and identical on every turn",
    detail:
      "Each turn must carry a non-empty string matchId, and every turn in the sequence must carry the same one. A turn that names a different match does not belong to this replay.",
  },
  {
    id: "R02-turn-order",
    kind: "published",
    spec: "SPEC.md §4 — response echoes turn exactly; 20 turns per match",
    title: "Turns run 1, 2, 3, … with no gaps, repeats, or jumps",
    detail:
      "Turn must be an integer. The first turn is 1 and each following turn is exactly one more than the previous one. A repeated turn number is a duplicate; a skipped number is a wrong-order turn. (Turn numbering starting at 1 is an assumption: the published spec says 20 turns per match but does not publish the numbering base.)",
  },
  {
    id: "R03-turn-cap",
    kind: "published",
    spec: "SPEC.md §4 — 20 turns per match",
    title: "A match has at most 20 turns",
    detail:
      "Any turn numbered above 20, or a 21st turn entry, is illegal: the published match length is 20 turns.",
  },
  {
    id: "R04-action-set",
    kind: "published",
    spec: "SPEC.md §4 — actions STEAL, HOLD, FORTIFY",
    title: "Action is one of STEAL, HOLD, FORTIFY",
    detail:
      "No other action string is accepted. The check is exact and case-sensitive.",
  },
  {
    id: "R05-amount-omitted",
    kind: "published",
    spec: "SPEC.md §4 — amount must be OMITTED ENTIRELY for HOLD or FORTIFY",
    title: "HOLD and FORTIFY carry no amount at all",
    detail:
      "The amount field must be absent entirely for HOLD and FORTIFY — present even as 0 or null is an error, because the schema rejects the field. This is the headline published rule.",
  },
  {
    id: "R06-idempotency-unique",
    kind: "published",
    spec: "SPEC.md §4 — idempotencyKey unique per turn; only the first submission per key counts",
    title: "idempotencyKey is present, non-empty, and never reused",
    detail:
      "Each turn must carry a non-empty string idempotencyKey, and no key may appear twice in the match. A replayed key means the second submission does not count, so the turn is illegal.",
  },
  {
    id: "R07-starting-balance",
    kind: "published",
    spec: "SPEC.md §4 — 100 VFY starting balance each",
    title: "Both players start at 100 VFY",
    detail:
      "Reconstruction starts every match at 100 VFY for self and 100 VFY for opponent. A STEAL moves its amount from the victim to the actor; HOLD and FORTIFY move nothing.",
  },
  {
    id: "R08-steal-amount",
    kind: "assumption",
    spec: "Assumption — not published",
    title: "STEAL carries a positive integer amount",
    detail:
      "The published spec names amount only through the HOLD/FORTIFY omission rule, so requiring a present, integer, positive amount for STEAL is an assumption of this tool. A missing, zero, negative, or fractional amount is illegal.",
  },
  {
    id: "R09-steal-within-balance",
    kind: "assumption",
    spec: "Assumption — not published",
    title: "STEAL amount never exceeds the victim's balance",
    detail:
      "Balances are conserved and never go negative: a STEAL larger than the victim's current balance is illegal. The published spec does not state this cap, so it is labeled an assumption.",
  },
  {
    id: "R10-winner",
    kind: "published",
    spec: "SPEC.md §4 — highest balance wins",
    title: "Highest balance wins after turn 20",
    detail:
      "Informational, not a per-turn failure. When 20 legal turns have been applied the tool names the winner (or a tie). Fewer than 20 turns means the match is incomplete and no winner is declared.",
  },
  {
    id: "A01-board-grid",
    kind: "assumption",
    spec: "Assumption — not published (no board is published)",
    title: "Board model: a 3×3 grid, orthogonal adjacency only",
    detail:
      "The platform has not published any board, cells, or adjacency. This tool assumes a 3×3 grid with cells A1–C3 (rows A–C, columns 1–3). Two cells are adjacent only when they share a side; diagonals are NOT adjacent.",
  },
  {
    id: "A02-initial-ownership",
    kind: "assumption",
    spec: "Assumption — not published",
    title: "Initial ownership: self A1, A2, B1 — opponent A3, B2, C3 — neutral B3, C1, C2",
    detail:
      "The platform has not published starting ownership. This tool assumes the layout above so that a legal STEAL exists from turn 1 (an opponent cell adjacent to a self cell) and so that neutral, opponent, and self cells are all reachable by the checks.",
  },
  {
    id: "A03-steal-target-opponent",
    kind: "assumption",
    spec: "Assumption — not published",
    title: "STEAL target must be a cell owned by the opponent",
    detail:
      "STEAL names a target cell. Under the assumed board model the target must exist and be owned by the victim: a neutral (unowned) target or a cell owned by the actor is illegal.",
  },
  {
    id: "A04-steal-target-adjacent",
    kind: "assumption",
    spec: "Assumption — not published",
    title: "STEAL target must be adjacent to a cell the actor owns",
    detail:
      "Under the assumed board model a STEAL may only reach a cell orthogonally adjacent to at least one cell the actor owns. A distant opponent cell is illegal even though it is owned by the opponent.",
  },
  {
    id: "A05-fortify-target-owned",
    kind: "assumption",
    spec: "Assumption — not published",
    title: "FORTIFY target must be a cell owned by the actor",
    detail:
      "FORTIFY names a target cell. Under the assumed board model the target must exist and be owned by the actor: fortifying a neutral cell or an opponent cell is illegal. A successful FORTIFY marks the cell fortified.",
  },
  {
    id: "A06-hold-no-target",
    kind: "assumption",
    spec: "Assumption — not published",
    title: "HOLD carries no target",
    detail:
      "HOLD names no cell. A target on a HOLD is illegal under the assumed model, mirroring the published amount rule.",
  },
  {
    id: "A07-illegal-not-applied",
    kind: "assumption",
    spec: "Assumption — methodology of this tool",
    title: "An illegal turn changes no state",
    detail:
      "When a turn fails any check its effects are not applied: balances, board, and fortifications stay as they were after the last legal turn, and later turns are judged against that state. The turn is still reported with every rule it broke.",
  },
  {
    id: "A08-actor",
    kind: "assumption",
    spec: "Assumption — not published",
    title: "Turns are the agent's own unless actor says opponent",
    detail:
      "Each turn may name an actor, 'self' (default) or 'opponent', so a full match log with both sides can be replayed. The actor is the side that steals, fortifies, and gains balance; the other side is the victim.",
  },
];
