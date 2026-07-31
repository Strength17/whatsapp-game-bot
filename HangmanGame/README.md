# Hangman (HMG)

Classic single-word elimination — but built for a live WhatsApp group,
not a solo player against a screen.

## The pitch

One target word, one masked reveal, and everyone in the group guessing
together, turn by turn. Guess right and the group keeps going; miss and
you take a strike — the moment you miss, the group sees a live
stick-figure card showing exactly how close you are to being
eliminated. Difficulty adapts round to round based on how the group is
actually doing, and there's no admin babysitting needed between
matches — a cooldown timer opens the next lobby automatically.

## Files in this folder

| File | Role |
|---|---|
| `config.js` | `GAME_KEY`, `GAME_NAME`, `GAME_ACRONYM`, `PREFIX` (`!hmg`), `ADMIN_PREFIX` (`/hmg `), timers, defaults |
| `gameEngine.js` | Lobby, turn rotation, word masking, adaptive difficulty (`adjustNextWordLength`), the stick-figure card builder, cooldown + turn timers |
| `publicCommands.js` | `!hmg` commands (`start`, `join`, `help`) + routes live letter/word guesses to the engine |
| `adminCommands.js` | `/hmg` commands — pause/resume/end/reset/status, word-pool management, Hangman's own settings. Admin *identity* commands were moved out — see below |
| `matchSummary.js` | End-of-match report |

## Switching to Hangman

```
/game setgame hangman
```

## Public commands (`!hmg`)

| Command | What it does |
|---|---|
| `!hmg` (bare) | Explainer card — never starts anything |
| `!hmg start` | Open a lobby (subject to `publicCanStart`) |
| `!hmg join` | Join the open lobby |
| `!hmg help` | Same as bare `!hmg` |

To **answer**, type a single letter (reveals every occurrence) or the
full word (instant win) during your turn — no prefix needed.

## Admin commands (`/hmg`)

| Command | What it does |
|---|---|
| `/hmg status` | Full state dump — phase, players, word progress, config |
| `/hmg start` | Force-start a lobby early, or break the cooldown to open a fresh one |
| `/hmg pause` / `/hmg resume` | Freeze / unfreeze the turn timer |
| `/hmg end` / `/hmg stop` | Terminate the session |
| `/hmg set maxtries [n\|auto]` | Override the guess-attempt limit |
| `/hmg set public [on\|off]` | Toggle public visibility |
| `/hmg set start [on\|off]` | Toggle whether the public can open a lobby |
| `/hmg set autojoin [on\|off]` | Toggle auto-join behavior |
| `/hmg addword` / `removeword` / `listwords` / `setwords` / `clearwords` | Manage the word pool |
| `/hmg clearadmin` | Reset **Hangman's own** settings (max tries, public access, auto-join) to defaults |
| `/hmg reset` | Reset word pool + Hangman's settings — admin identity untouched |
| `/hmg help` | Admin command list |

**Not handled here:** who gets ADMIN tier in the first place, or which
game(s) they're scoped to. That's bot-wide identity, not a Hangman
concern — use the universal `/admin` command instead (see the root
`COMMAND_REFERENCE.md` §1). Typing `/hmg admin`, `/hmg approve`,
`/hmg deny`, `/hmg set admin`, `/hmg confirm`, or `/hmg cancel` will
just redirect you there.

## Design notes

- **Adaptive difficulty, one signal.** `adjustNextWordLength` drifts the
  next round's target word length ±1 based on how the group just did —
  no separate difficulty setting to configure.
- **The stick-figure card is dynamic and per-player**, not a fixed
  ASCII-art progression shown once. `resolveStickStage` maps
  `wrongCount / maxTries` onto one of 10 distinct stages (legs → arms →
  torso → head, each with a hit → gone sub-stage), so no two wrong
  guesses ever render the same picture, at any `maxTries` from 5–10 —
  and it's posted live in the **group**, tagged with the player's name
  and strike count, the moment they miss.
- **The 2-minute cooldown is automatic.** A finished match doesn't wait
  on an admin to open the next lobby — `startCooldown` handles it.
- **State isolation, settings isolation, tier gate, bare-acronym rule,
  `forceStopActiveSession`** — all implemented per `ARCHITECTURE.md`
  and confirmed via `npm run verify`.
