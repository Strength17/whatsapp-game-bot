# The 24 Game (M4T)

A race-mode math minigame: the bot gives 4 numbers, everyone in the chat
races to combine all 4 with `+ − × ÷` (any order, any grouping) to make
exactly **24**. First correct equation posted wins the round.

Built to the multi-game plugin contract in the root `README.md` — drop
this folder in alongside `HangmanGame/` and `WordLadderGame/`, no changes
needed to any existing file.

## Why race mode, not turn-by-turn

Arithmetic is instant — everyone can solve in their head at once, so a
"first correct answer wins" format creates real social stakes without
anyone waiting on a turn. This is the same reason live trivia/buzzer
games outperform turn-based ones for short, fast content.

## Commands

Player-tier commands never control or end a running session — only
*view*, *start*, *help*, and *hint* are exposed publicly. Everything
that can disrupt an in-progress game is admin-only. See the root
`COMMAND_CONTROL.md` for the full rationale — this game follows it
exactly.

**Public** (`!m4th`, no prefix needed for the actual guess once a round is live):
- `!m4th start` — begin a session (subject to `publicCanStart` like other games)
- `!m4th scores` — show current standings mid-session
- `!m4th hint` — reveal one partial step of a valid solution (not the full answer)
- `!m4th help` — usage
- *(just type your equation, e.g. `8/(3-8/3)`, while a round is open)*

**Admin** (`/m4th `):
- `/m4th stop` — end the session gracefully, show the leaderboard
- `/m4th reset` — hard reset: wipe session + scores immediately, no report
- `/m4th setroundtime <5-120>` — seconds per round
- `/m4th setcooldown <1-60>` — pause between rounds within a session
- `/m4th setrounds <1-100|infinite>` — rounds before the session auto-ends
- `/m4th setsessioncooldown <5-600>` — pause before an auto-restarted fresh session
- `/m4th status` — current tier, settings, session state

`/game setgame m4th` (fixed root prefix, from `game-switch-commands.js`)
switches the whole bot's active game to this one — not handled in this
folder, per the plugin contract.

## Adaptive difficulty

No manual difficulty setting — same single-signal adaptive pattern as
HangmanGame/WordLadderGame. Three tiers (`easy` → `normal` → `difficult`),
drifting ±1 per round:
- Solved in under 40% of the round's time → tier goes **up**.
- Nobody solves it before time runs out → tier goes **down**.

Tiers are graded on a real difficulty signal, not just a wider number
range: `difficult` puzzles are solvable *only* via a fractional
intermediate step (the classic "hard 24-card" signature — e.g. `1,3,4,6`
only works via `6/(1-3/4)`), the same thing that makes those puzzles feel
harder to a human. `easy` puzzles always have a clean integer-only path.

## How puzzles are generated (`numberBank.js` + `solver.js`)

Every puzzle is rolled fresh and checked for solvability *before* it's
ever shown to players — there's no static, exhaustible puzzle list.
`solver.js` is a hand-written recursive-descent arithmetic parser (no
`eval()`, ever) doing double duty:

1. Grading a **player's own typed equation** — parses it safely, checks
   it uses exactly the round's 4 numbers (each once), and checks the
   result is 24.
2. A brute-force search (all permutations × operators × the 5 possible
   binary-tree shapes for 4 operands) used only by the **generator**, to
   confirm a freshly rolled quadruple is solvable, grade its difficulty,
   and reveal one example solution when nobody solves a round in time.

A small set of hand-verified fallback puzzles is kept (and self-checked
against the solver at module load) in case random generation can't find
a qualifying quadruple within its attempt budget — a round can never be
served unsolvable.

## Auto-restart cooldown

When a session ends naturally (rounds-per-session reached), the chat
gets a countdown message and a fresh session auto-starts after the
configured `sessionCooldown` — no admin action needed, same "no
babysitting" behavior as HangmanGame's post-round cooldown. Explicitly
stopping via `!m4th stop` does **not** auto-restart.
