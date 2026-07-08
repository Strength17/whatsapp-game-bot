# Target Numbers (TGT)

A race-mode math minigame inspired by the classic TV "numbers round"
format: 6 numbers, a random 3-digit target, combine any of the numbers
with `+ − × ÷` to hit it exactly — or as close as possible. Built to
the multi-game plugin contract in the root `README.md`, and follows the
root `COMMAND_CONTROL.md` command-permission rule exactly.

## Commands

Player-tier commands never control or end a running session — only
*view*, *start*, *help*, and *hint* are exposed publicly. See root
`COMMAND_CONTROL.md` for why.

**Public** (`!tgt`, no prefix needed for the actual guess once a round is live):
- `!tgt start` — begin a session (subject to `publicCanStart`)
- `!tgt scores` — show current standings mid-session
- `!tgt hint` — reveal one partial step toward a good solution
- `!tgt help` — usage
- *(just type your equation, e.g. `(100-4)*10`, while a round is open)*

**Admin** (`/tgt `):
- `/tgt stop` — end the session gracefully, show the leaderboard
- `/tgt reset` — hard reset: wipe session + scores immediately, no report
- `/tgt setroundtime <15-180>` — seconds per round
- `/tgt setcooldown <1-60>` — pause between rounds within a session
- `/tgt setrounds <1-100|infinite>` — rounds before the session auto-ends
- `/tgt setsessioncooldown <5-600>` — pause before an auto-restarted fresh session
- `/tgt status` — current tier, settings, session state

## Rules (same as the source format)

- 6 numbers are drawn: some "large" (25/50/75/100, each usable once)
  and the rest "small" (1-10, two of each available).
- A random 3-digit target (101-999) is set.
- You don't have to use every number, but never more times than it
  appears in the pool.
- **Every intermediate step must be a positive whole number** — no
  fractions, no negative intermediate results, ever. This is enforced
  by the parser itself (`solver.js`), not just checked after the fact.
- An exact hit ends the round immediately. If time runs out, the
  closest submission anyone made during the round wins: exact = full
  points, within 5 = partial, within 10 = smaller partial, otherwise
  nobody scores that round.

## Adaptive difficulty

No manual difficulty setting — same single-signal adaptive pattern as
every other game here. The real lever is how many "large" numbers get
drawn: one large number is the easiest mix, two large gives the best
odds of an exact solution, and zero or four large numbers are the
hardest draws. `difficult` alternates between the two hardest mixes
each round it stays there. A fast exact hit bumps the tier up; a round
where nobody gets within 10 bumps it down.

## How puzzles are generated (`numberBank.js` + `solver.js`)

Every `{ numbers, target }` pair is rolled fresh and checked with a
brute-force best-reachable-value search before ever being shown —
there's no static, exhaustible puzzle list, and a round is never served
with zero chance of anyone scoring. `solver.js` does double duty:

1. Grading a **player's own typed equation** — parses it safely (no
   `eval()`, ever), enforcing the positive-whole-number-at-every-step
   rule live inside the parser, and checks the numbers used are a
   legal sub-multiset of the round's pool.
2. A memoized pairwise-reduction search (the standard approach for this
   puzzle type) used only by the **generator**, to confirm a freshly
   rolled pool/target pair is at least within scoring range, and to
   reveal the best achievable answer when nobody scores.

A hand-verified fallback pair is self-checked against the solver at
module load, used only if random generation can't find a qualifying
pair within its attempt budget.

## Auto-restart cooldown

When a session ends naturally (rounds-per-session reached), the chat
gets a countdown message and a fresh session auto-starts after the
configured `sessionCooldown` — no admin action needed, same behavior as
every other game here. Explicitly stopping via `/tgt stop` does **not**
auto-restart.
