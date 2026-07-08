# WordChainGame — Word Chain (WCG)

Say a real word. The next player's word must start with the last letter
of yours. No repeats. Strikes (wrong word, timeout, or broken rule) and
you're out — last player standing wins.

Fully compliant with the project's `ARCHITECTURE.md` plugin contract —
drop this folder in next to the others and register it wherever your
`/game` dispatcher keeps its game map:
```js
wordchain: { folder: 'WordChainGame' }
```
Switch to it any time with `/game setgame wordchain`.

## Files in this folder

| File | Role |
|---|---|
| `config.js` | Identity constants + the merged tier table (one difficulty axis, not three) + drift thresholds + milestones |
| `gameEngine.js` | Pure game-state logic: lobby, turns, strikes, word-chain validation, auto-tier drift, milestones — all timer callbacks wrapped in `safeSend` per §6/§8 |
| `publicCommands.js` | `handlePublicMessage(msgCtx)` — `!wcg` commands, live word submissions, and the public admin self-claim (per §5) |
| `adminCommands.js` | `handleAdminCommand(ctx)` — gated on tier FIRST (§5), scoped by `adminGameAccess` |
| `matchSummary.js` | End-of-match report, all-time stats, and **per-player personal bests** (`wordchain-stats.json`) |
| `dictionary.js` | Offline ~370k-word English validator + theme union + hint-fragment lookup |
| `themeBank.js` | Default theme word banks (seeds the shared `words.json` on first boot) |
| `display.js` | Local difficulty/theme badge formatting |

## Difficulty is now fully automatic

Word Chain used to require `/wcg set difficulty|strikes|timer` by hand —
the only game in the project still doing that. Now it's **one axis**
(`tier` 0/1/2 = easy/normal/difficult) that drifts once per match, not
per turn, based on the actual `strikeRate` for that match
(`totalStrikes / totalTurnsTaken`):

- `strikeRate > 0.4` → group struggled → tier drops (easier)
- `strikeRate < 0.1` → group cruised → tier rises (harder)
- otherwise → no change

`minLength` / `timerSeconds` / `maxStrikes` all live on the same
`TIER_TABLE` row, so they can never drift out of sync with each other.
`/wcg set difficulty`, `/wcg set strikes`, and `/wcg set timer` are gone
— `/wcg status` reports the current auto-tier read-only.

## New player-facing commands

- `!wcg scores` — public "view" command: chain so far, whose turn,
  current strikes, time left. (Compliance gap closed — every other
  game already had a public view command.)
- `!wcg hint` — reveals just the first two letters of one valid
  candidate word, never the full word — same "fragment, not the
  answer" rule the other games use.

## Engagement additions (this pass)

Per gamification research on what actually keeps players returning —
milestones + personal bests engage the whole skill range, not just
whoever's #1, and avoid the anxiety a daily-streak mechanic can create:

- **Chain milestones** — a celebratory ping at 5/10/20/30-word chains,
  purely cosmetic, no gameplay effect.
- **Personal bests** — `wordchain-stats.json` now tracks each player's
  own longest word ever, separate from the all-time global record, and
  flags it in the match report the moment they beat their own best.
- **Win counts** — the match report now shows the winner's running
  win count ("win #4").

## Bug fixes in this pass (all verified against the code, not just assumed)

| Bug | Fix |
|---|---|
| `require('word-list')` missing from `package.json` | Flagged — confirm it's in your root `package.json` dependencies |
| `nameTag(senderNumber, nameCache, settings)` on join | Fixed to `gameState.playerNames`, matching every other call site |
| `/wcg end` unconditionally cleared `activeGameChatRef` | Now only clears it if `activeGameChatRef.value === chatId` |
| `/wcg resume` called `startTurnCountdown(sender)` with one arg | Fixed — builds a real ctx via `buildCtx()` and passes `{ preserveRemaining: true }` |
| Timer callbacks (`setInterval`) called `sock.sendMessage` unguarded | All wrapped in `safeSend()` (try/catch), per ARCHITECTURE.md §6/§8 |
| Pause/resume reset the turn timer to full duration | `startTurnCountdown` now accepts `preserveRemaining` and skips the reset |
| `/wcg end` sent no match report | Now calls `matchSummary.sendMatchReport` with an `admin_stop` headline, same as a natural match end |
| `saveStats()` had no try/catch | Wrapped, logs and continues instead of throwing from inside a report path |
| `/wcg admin` self-claim lived in `adminCommands.js` | Moved to `publicCommands.js` per §5 — it's the one command any random member can run before the tier gate |
| Manual `difficulty`/`timerSeconds`/`maxStrikes` settings | Deleted — see "Difficulty is now fully automatic" above |

## Themed Rounds (unchanged from the previous pass)

Themes are **unioned with the offline dictionary**, never a replacement
— the dictionary stays the fallback pool so a chain can't dead-end, and
themed words (Gen Z slang, gaming terms) are *additionally* accepted.
Admin commands: `/wcg set theme genz|gaming|none`, `/wcg listthemes`,
`/wcg listthemewords [theme]`, `/wcg addthemeword`/`removethemeword`.

## Known limitation (unchanged)

Words ending in rare letters (like **X**) can occasionally dead-end a
chain. Not special-cased to avoid over-engineering a rare edge case.
