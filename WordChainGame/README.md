# WordChainGame — Word Chain (WCG)

Say a real word. The next player's word must start with the last letter
of yours. No repeats. Strikes (wrong word, timeout, or broken rule) and
you're out — last player standing wins. Only people who typed
`!wcg join` can ever affect state — everyone else is silently ignored.

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
| `config.js` | Identity constants + tier table + live progression steps + theme rotation + match-duration bounds + milestones |
| `gameEngine.js` | Pure game-state logic: lobby, turns, strikes, word-chain validation, live progression, auto theme rotation, self-governing match clock, auto-restart, auto-tier drift — all timer callbacks wrapped in `safeSend` per §6/§8 |
| `publicCommands.js` | `handlePublicMessage(msgCtx)` — `!wcg` commands, live word submissions, and the public admin self-claim (per §5) |
| `adminCommands.js` | `handleAdminCommand(ctx)` — gated on tier FIRST (§5), scoped by `adminGameAccess` |
| `matchSummary.js` | End-of-match report, all-time stats, and **per-player personal bests** (`wordchain-stats.json`) |
| `dictionary.js` | Offline ~370k-word English validator + theme union + hint-fragment lookup |
| `themeBank.js` | Default theme word banks — **Animals** and **Food**, ~140-160 common words each (seeds the shared `words.json` on first boot) |
| `display.js` | Local difficulty/theme badges + the shared identity-band card helper |

## What's new in this pass — autonomous scaling & themes

This pass makes the game run itself: it scales live as people play, it
rotates through wide, common-word themes on its own, and it starts and
stops matches without any admin action.

### 1. Word length now climbs live, mid-match — not just between matches
Difficulty has two layers that work together instead of fighting:

- **Tier** (`config.TIER_TABLE`) — persists **per chat**, drifts once per
  match based on the group's strike rate (`driftTierForNextMatch`). This
  is the "next session starts a little harder if you cruised" memory —
  unchanged in spirit from before, but now it's the *starting point*,
  not the whole story.
- **Live progression** (`config.PROGRESSION_STEPS`, `gameEngine.applyProgression`)
  — evaluated after **every accepted word**. As the chain grows past
  8 / 16 / 26 / 40 words, minimum word length and the turn timer tighten
  *during the same match*, on top of whatever tier it started at. A
  25-word chain now genuinely feels harder to keep alive than word 3 did.
  Strikes intentionally never tighten mid-match — only length and pace do,
  so nobody gets instantly eliminated by a rule change under their feet.

### 2. Themes are now common, everyday categories — and they rotate themselves
`themeBank.js` replaced the old Gen-Z-slang / gaming-slang lists with two
wide umbrella categories: **Animals** (mammals, birds, insects, reptiles —
all one pool) and **Food** (fruit, vegetables, dishes — all one pool),
~140–160 words each. They're still unioned with the offline dictionary,
never a replacement, so a chain can't dead-end.

Which theme is live is **no longer admin-settable**. Every match starts
on no theme. Once the group lands `THEME_ROTATION_QUALIFY` (6) accepted
words in a row *without a strike*, the engine auto-rotates to the next
theme (`none → Animals → Food → Animals → …`) and announces it in-chat.
A strike resets that streak to 0 — a struggling group just stays on the
current theme longer, it's never punished with a harder switch.
`/wcg addthemeword` / `removethemeword` / `listthemewords` still let an
admin curate the *content* of each bank; nobody can force-switch which
one is live.

### 3. Matches are now self-governing — time is the only manual-free stop
Every match runs a duration clock (`config.MATCH_DURATION_SECONDS`,
**default 5 minutes**) alongside the turn timer, freezing together with
it on `/wcg pause`. When it hits zero, play is frozen and the engine
picks a result from the current state — most words contributed to the
chain, tie-broken by fewest lifetime strikes, tie-broken by turn order —
and reports it as a time-based win (`type: 'time_up'` in
`matchSummary.js`), never an elimination win.

This is admin-tunable via `/wcg set duration [minutes]`, stored as the
`wordchain_matchDurationSeconds` setting (GAME_KEY-prefixed per
ARCHITECTURE.md §4), clamped to a sane 1–60 minute range. Nothing else
about pacing is admin-settable — length/timer/theme are all engine logic.

### 4. Full autopilot — no admin has to type `/wcg start` again
Every natural match ending — last player standing, everyone eliminated,
**or** the clock running out — now schedules an automatic new lobby
15 seconds later (`gameEngine.scheduleAutoRestart` → `openLobby`), so
play just keeps cycling. The one exception is `/wcg end`/`stop`: an
admin *choosing* to end a match is respected as a hard stop and does
**not** auto-restart — that's the one place a human still has the wheel.

## Themed Rounds

Animals and Food are **unioned with the offline dictionary**, never a
replacement — the dictionary stays the fallback pool so a chain can't
dead-end, and themed words are *additionally* accepted once the live
theme rotates on. Admin commands: `/wcg listthemes`,
`/wcg listthemewords [theme]`, `/wcg addthemeword`/`removethemeword`.
There is intentionally no `/wcg set theme` anymore — see above.

## Message style (BOT_STYLE_GUIDE.md compliance)

Identity band (`config.DIVIDER` / `config.BOT_EMOJI` / brand sign-off)
now wraps every card message per §1: lobby open (`!wcg`/auto-restart
open), lobby-closed/match-start, the public help card, the admin help
dashboard, and the match report. Quick transactional replies (joins,
errors, pause/resume/status one-liners) stay minimal on purpose, per
the same section.

## Bug fixes carried forward from the previous pass (still verified against the code)

| Bug | Fix |
|---|---|
| `require('word-list')` missing from `package.json` | Flagged — confirm it's in your root `package.json` dependencies |
| `/wcg end` unconditionally cleared `activeGameChatRef` | Only clears it if `activeGameChatRef.value === chatId` |
| `/wcg resume` reset the turn timer to full duration | `startTurnCountdown` accepts `preserveRemaining` and skips the reset |
| Timer callbacks (`setInterval`) called `sock.sendMessage` unguarded | All wrapped in `safeSend()` (try/catch), per ARCHITECTURE.md §6/§8 |
| `/wcg admin` self-claim lived in `adminCommands.js` | Lives in `publicCommands.js` per §5 |
| Manual `difficulty`/`timerSeconds`/`maxStrikes`/`theme` settings | Deleted — fully automatic now, including theme rotation |

## Known limitation (unchanged)

Words ending in rare letters (like **X**) can occasionally dead-end a
chain. Not special-cased to avoid over-engineering a rare edge case.
