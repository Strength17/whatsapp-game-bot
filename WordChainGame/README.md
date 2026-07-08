# Word Chain (WCG)

Say a real word. The next player's word must start with your word's
last letter. No repeats. Miss, stall, or break a rule too many times
and you're out — last player standing wins.

Built to the multi-game plugin contract in the root `README.md`, and
follows the root `COMMAND_CONTROL.md` command-permission rule exactly.

## Commands

**Public** (`!wcg`):
- `!wcg` / `!wcg help` — rules
- `!wcg start` — open a 60s lobby
- `!wcg join` — join it
- `!wcg scores` — live standings: chain length, whose turn, strikes (works during the lobby too)
- `!wcg hint` — one nudge per turn: a word length + first two letters, never the full word

**Admin** (`/wcg `):
- `/wcg admin` — public, self-service claim if unclaimed
- `/wcg clearadmin`
- `/wcg set theme <name|none>`, `/wcg listthemes`, `/wcg listthemewords [theme]`,
  `/wcg addthemeword [theme] [word]`, `/wcg removethemeword [theme] [word]`
- `/wcg pause` / `/wcg resume` — resume preserves the remaining turn time, doesn't reset it
- `/wcg stop` — end the match now, still posts the full match report
- `/wcg reset` — hard wipe: no report, also resets this chat's difficulty back to Easy
- `/wcg status`

## Adaptive difficulty — fully automatic, no manual override

There used to be `/wcg set difficulty|strikes|timer`. There isn't
anymore. Word Chain now drifts through the same 3-tier
easy/normal/difficult system every other game here uses, but the
trigger fires once per **match** (not once per turn/round, since a
Word Chain match already spans many turns):

```
strikeRate = totalStrikes / totalTurnsTaken, computed once the match ends

strikeRate > 40%  → the group is struggling → drift EASIER
strikeRate < 10%  → the group is cruising    → drift HARDER
otherwise         → no change
```

The tier lives on each chat's own persistent game state, so it carries
forward from match to match and each group settles at its own level
over time — a rowdy group of casual players and a group of hardcore
word-nerds will naturally end up in different places without anyone
touching a setting.

## Engagement additions

- **Chain milestones** — the whole group gets a callout at 10, 25, 50,
  75, 100+ words. A shared, visible "look how far we got" moment costs
  nothing to implement and gives everyone something to rally around
  mid-match, not just at the end.
- **Personal bests** — alongside the all-time longest word/chain
  records, each player's own longest word ever is tracked and called
  out when they beat it. Not everyone is motivated by "beat the group"
  — some people are motivated by "beat my own last run," and that's a
  free second engagement hook riding on data we already have.
- **Hint, capped at once per turn** — reveals only a fragment (word
  length + first two letters), never the actual word. Keeps a stuck
  player in the game without trivializing the challenge.

## What was fixed from the previous version

1. Missing personal-best fix aside — `nameTag` on join was reading from
   the wrong object (`nameCache` instead of `gameState.playerNames`).
2. `/wcg end` used to null out the shared `activeGameChatRef` pointer
   unconditionally — now guarded so it only clears the ref if this
   chat is actually the one holding it, so an admin typing `/wcg stop`
   in the wrong chat can't orphan a different chat's live game.
3. `/wcg resume` called `startTurnCountdown` with only one argument
   where the function needs two — it would throw every time. Fixed,
   and resuming now preserves the remaining turn time instead of
   giving a free full refresh.
4. Every `setInterval`/`setTimeout` body (lobby countdown, turn
   countdown) is now wrapped in try/catch — these callbacks aren't
   covered by the per-message error boundary, so an unguarded failure
   could leave a timer running forever with no cleanup.
5. `/wcg stop` now sends the full match report (chain recap + stats),
   matching the stop-vs-reset split used everywhere else in this
   project — previously an admin stop sent nothing but "ended by an
   admin."
6. The stats file write has a try/catch (the read side already did).
7. Added the required public "view" command (`!wcg scores`), which
   was missing entirely — every game must expose this per
   `COMMAND_CONTROL.md`.
8. Manual difficulty/timer/strike commands removed — see "Adaptive
   difficulty" above.
