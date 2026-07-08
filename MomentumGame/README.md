# Momentum — a collective-psychology meter game

## The pitch

There's no content. No word list, no arithmetic, no puzzle to solve — the
only variable is what the group does. That means it never runs out of
material and plays completely differently with 4 people versus 40.

Every round, everyone privately DMs one of two symbols — ⚡ or 🌊, no
inherent meaning attached. The bot tallies picks and shifts a shared
meter. Only *after* everyone has already committed does it reveal whether
this was a **Majority round** (matching the crowd scores) or a **Minority
round** (being in the smaller group scores). You never know which you're
playing until it's too late to change your answer.

## Intellectual lineage (worth being upfront about)

This is a chat-native take on what's called the **Minority Game** in
complexity science — the majority-loses / minority-wins dynamic (Challet
& Zhang, 1997), itself grown out of the El Farol Bar problem in
economics. It's an actual open research topic in game theory about how
groups behave under uncertainty, not a board game or app anyone would
have played before. Building it as a two-emoji DM game is new; the
underlying dynamic isn't invented from nothing.

## Why the majority/minority flip is unpredictable, not a gimmick

If scoring always rewarded matching the crowd, everyone converges and the
game goes stale in a few rounds. If it always rewarded being the outlier,
everyone tries to out-contrarian each other and it also collapses.
Alternating unpredictably (a fresh coin flip *after* picks lock, every
round — see `gameEngine.resolveRound`) means neither pure strategy works.

## Command surface

**Players** (`!mmt` prefix):
- `!mmt start` — open a session in the current group
- `!mmt help` — how to play
- `!mmt scores` — current leaderboard (works in the group or a DM)
- DM `⚡` / `🌊` (or `bolt` / `wave`) — your pick for the open round

**Admin/Creator** (`/mmt ` prefix):
- `/mmt status` — session state, meter, time left in the round
- `/mmt pause` / `/mmt resume` — freeze/unfreeze the round timer, including
  mid-cooldown (between rounds), not just mid-round
- `/mmt end` / `/mmt stop` — end the session, post final standings
- `/mmt reset` — wipe scores + meter without ending the session
- `/mmt setroundtime [seconds]` — change how long each round stays open

## Design notes

- **No parser, minimal attack surface.** Each round's input is a single DM
  matched against a small alias table (`config.SYMBOL_ALIASES`) — no
  expression evaluation, no validation surface to harden.
- **Single-active-game architecture.** Like every other game here, only
  one game runs bot-wide at a time via `activeGameChatRef`. A DM pick is
  attributed to whichever chat is currently active — there's no separate
  "join" step; DMing a valid pick auto-registers you as a player.
- **Flavor events reuse the same meter, no new systems.** "High Tension"
  (double points) and "full reveal" (showing individual picks instead of
  just totals) both trigger purely off how close the meter is to an edge
  — see `config.DOUBLE_POINTS_EDGE_DISTANCE` / `REVEAL_PICKS_EDGE_DISTANCE`.
- **Timers survive pause at any point in the cycle.** A single
  `gs.nextAction` / `gs.nextActionAt` pair tracks whatever the pending
  timer is about to do (`'resolve'` an open round or `'start'` the next
  one), so `/mmt pause` works correctly whether it's called mid-round or
  during the cooldown gap between rounds — both were tested explicitly,
  since the cooldown-gap case is easy to miss.
- **Ties are void, not arbitrarily broken.** An even split has no majority
  or minority to speak of, so the round awards no points and the meter
  doesn't move — this was a deliberate choice over, say, a coin-flip
  tiebreak, so the meter only ever reflects genuine group lean.
