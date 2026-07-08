# COMMAND_CONTROL.md
### Abstract command-permission contract for every game plugin in this project

This file is intentionally game-agnostic. It doesn't describe any one
game's mechanics — it describes the **rule every game must follow** when
deciding what a public/player command is allowed to do versus what
requires admin. Read this alongside the root `README.md` (plugin
contract: files, exports, folder shape) — that file says *how* to wire a
game in; this file says *what a player is allowed to touch* once it's
wired in. Give both to any AI or developer building a new game so this
rule never has to be re-explained per game.

---

## 1. The two command surfaces are structurally separate, not just prefixed differently

Every game exposes exactly two command surfaces:

| Surface | Prefix | Who | Purpose |
|---|---|---|---|
| **Player** | `!<acronym>` (e.g. `!m4th`) | Anyone in the chat (subject to `publicCanStart`, see §4) | Join in, understand, observe |
| **Admin**  | `/<acronym> ` (e.g. `/m4th `) — note trailing space | Creator, or Admin if in-scope (see root README §3) | Configure, correct, end |

The `!` vs `/` prefix isn't cosmetic — it's the entire access-control
signal a player sees. Because of that, **the same verb must never mean
"control the game" under `!` and something else under `/`.** If a verb
is destructive or session-altering, it belongs *only* under `/`, full
stop — don't also expose a softer/gated version of it under `!`.

## 2. The player-tier allowlist — this is the complete list, not a starting point

A player-facing (`!`) command may **only** ever do one of these four
things. If what you're building doesn't fit one of these four buckets,
it's an admin command:

1. **View** — show status, current standings/scores, whether a session
   is running. Read-only, no side effects on shared state.
2. **Start** — begin a new session, but *only* when none is currently
   active for that chat. Starting is low-risk because it can't disrupt
   something already in progress; there is nothing running yet to break.
3. **Help** — usage instructions. Always read-only.
4. **Hint** — for games where hints make sense, players may request a
   *partial* nudge on the live round. A hint must never be able to end,
   skip, or restart the round on its own, and must never reveal a full
   solution — see §3 for the shape a hint should take.

That's the entire list. Notably absent, and **never** to be added to
the player surface no matter how "harmless" it seems in the moment:
**stop, reset, skip, pause, kick a player, or change any setting.**
Those all mutate or end shared state that other people in the chat are
relying on — they're admin's call, every time, regardless of who
started the session or whether `publicCanStart` is on.

## 3. What a hint is (and isn't)

A hint command must:
- Only work while a round is actually live (no round → no hint).
- Reveal a **fragment**, not the answer — e.g. one sub-step of a
  solution, a single letter, a category nudge. If revealing the fragment
  is equivalent to solving the round for the player, it's too strong.
- Not restart the clock, change scoring, or otherwise alter round state
  beyond a `hintGivenThisRound`-style flag (useful for capping repeat
  hints or just echoing the same hint back on request instead of
  escalating).
- Not require admin permission — this is a player-facing verb by design.

If a game genuinely has no sensible concept of a hint (e.g. a pure race
with no partial-credit structure), it's fine to omit `hint` entirely —
it isn't mandatory, only unconditionally *allowed* to be public when it
exists.

## 4. `start` is still gated, just not by tier

Player-tier `start` respects the existing shared `publicCanStart`
setting (root `settings.json`, per root README §2) exactly like every
other public-start path in the project: if it's `false`, only admin/
creator can start, and a player attempting to start should get a clear
"only an admin can start this right now" message, not a silent no-op.
This is a pre-existing project-wide setting, not something to
reinvent per game.

## 5. Every admin command must degrade gracefully when mistakenly typed under `!`

Because `stop` (and any other control verb) will inevitably get typed
by a player under the `!` prefix out of habit, the player-tier handler
should recognize the verb and respond with a clear redirect —
*"Only an admin can stop this — ask them to run `/xyz stop`"* — rather
than falling through to a generic "unknown command" message. This isn't
a security boundary (the admin check still lives in `adminCommands.js`
where it belongs) — it's just better UX than silence or confusion.

## 6. Minimal reference shape (copy this pattern, don't reinvent it)

```
publicCommands.js  (!xyz)
├── '' / 'start'   → gated by publicCanStart, else gameEngine.startSession()
├── 'scores'       → read-only standings
├── 'hint'         → optional; partial nudge only, no state mutation beyond a flag
├── 'help'         → static usage text, must list ONLY the four allowed verbs
└── 'stop'         → NOT handled by the game — respond with an admin redirect

adminCommands.js  (/xyz )
├── 'stop'         → graceful end: closes the session, still posts a report
├── 'reset'        → hard reset: wipes state immediately, no report
├── 'set...'       → any tunable (round time, cooldown, rounds/session, etc.)
└── 'status'       → detailed admin-facing status (separate from the fixed
                      root '/game status', which is cross-game and never
                      touched by an individual game's adminCommands.js)
```

`stop` vs `reset` existing as two distinct admin verbs (graceful vs
hard) is a useful default, not a hard requirement — but if a game only
implements one of the two, it should be `stop` (graceful, reports to
the chat), since silently wiping shared state with no explanation is
the worse default for a group chat.

## 7. Why this split, in one sentence

A player should always be able to see what's happening and opt in to
play — never able to take something away from everyone else in the
chat. Admin is the only tier that can end, wipe, or reconfigure shared
state.
