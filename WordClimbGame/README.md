# Word Climb (WCL)

A turn-based elimination word game built for live WhatsApp groups. Not
a variant of Word Ladder or Word Chain — the mechanic is bespoke: the
bot escalates a required word length one rung at a time, and misses
cost you strikes until you're out.

## The pitch

Every player takes a turn, in rotation. On your turn the bot gives you
a starting **letter** and a required **length** — say, "6 letters,
starting with G." You have 30 seconds to reply with a real word that
fits, and hasn't already been used this match. Get it right and you
climb; get it wrong, run out the clock, or repeat a word already used,
and that's a strike. **3 strikes and you're out.**

The required length is the same for every surviving player during one
full lap of the rotation — once everyone still standing has taken a
turn at, say, 5 letters, the length climbs to 6 for the next lap. It
runs from `config.MIN_LENGTH` (3) to `config.MAX_LENGTH` (8).

The match ends when either:
- **Only one player is left standing** — they win outright, or
- **The climb passes 8 letters with multiple survivors** — the
  survivor with the highest length they successfully answered wins
  (ties broken by fewest strikes).

The final board shows the elimination order (who went out, at what
length, and their personal best) plus the winner/ranked survivors.

## Files in this folder

| File | Role |
|---|---|
| `config.js` | `GAME_KEY`, `GAME_NAME`, `GAME_ACRONYM`, `PREFIX` (`!wcl`), `ADMIN_PREFIX` (`/wcl `), timers, strike count |
| `wordBank.js` | Offline dictionary, grouped by length (3–8) then starting letter — lets the engine pick a letter that actually has valid words at the current length, and validate guesses |
| `gameEngine.js` | Lobby, turn rotation, the escalating-length climb, strikes/elimination, turn timer + messaging (same convention as `HangmanGame/gameEngine.js` — the timer and its announcements live here, not in `publicCommands.js`) |
| `publicCommands.js` | `!wcl` commands (`start`, `join`, `begin`, `help`) + routes live guesses to the engine |
| `adminCommands.js` | `/wcl` commands (`status`, `stop`, `reset`, `setturnseconds`), gated on `senderTier` per `ARCHITECTURE.md` §5 |
| `matchSummary.js` | Builds and renders the final board — pure bookkeeping, doesn't own state |

## Switching to Word Climb

```
/game setgame wordclimb
```

## Public commands (`!wcl`)

| Command | What it does |
|---|---|
| `!wcl` (bare) | Explainer card — never starts anything, per §9 |
| `!wcl start` | Open a lobby (subject to `publicCanStart`) |
| `!wcl join` | Join the open lobby |
| `!wcl begin` | Start early once 2+ players have joined |
| `!wcl help` | Same as bare `!wcl` |

To **answer**, just type a word during your turn. No prefix needed.

## Admin commands (`/wcl`)

| Command | What it does |
|---|---|
| `/wcl status` | Lobby/climb state, current rung, turn timer setting |
| `/wcl stop` / `/wcl end` | End the session immediately |
| `/wcl reset` | Hard reset — wipes session for this chat silently |
| `/wcl setturnseconds <10-90>` | Change the per-turn timer for the *next* match |
| `/wcl help` | Admin command list |

**Not handled here:** who gets ADMIN tier in the first place, or which
game(s) they're scoped to. That's bot-wide identity — use the universal
`/admin` command instead (see the root `COMMAND_REFERENCE.md` §1).

## Design notes

- **Turn-based, not simultaneous.** Only the current player's message
  is consumed as a guess (`gameEngine.submitGuess` checks
  `senderNumber === gameState.currentPlayer`) — this is what makes
  "skips you" and "3 strikes" meaningful the way a chain/relay game
  needs them to be, rather than a free-for-all like Word Chain.
- **Strikes are cumulative across the whole match**, not reset per
  lap — a player who's been sloppy across three different rungs is
  just as eliminated as one who bombed three times in a row.
- **The word bank is a curated offline list, not a full dictionary.**
  Swapping in the `word-list` npm package (already used by
  `WordChainGame/dictionary.js` in earlier builds of this project) is
  a drop-in upgrade — only `wordBank.isValidWord()` would need to
  change internally; nothing else in this game knows how validation
  is implemented.
- **State isolation, settings isolation, tier gate, bare-acronym
  rule, `forceStopActiveSession`** — all implemented per
  `ARCHITECTURE.md` and confirmed via `npm run verify`.
