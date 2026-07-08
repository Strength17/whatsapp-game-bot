# Change Log — WRG → HMG restructure

## Rename
- `WRG` / `Word Riddle Game` → **`HMG` / "HangMan Game"** everywhere in
  user-facing text and command prefixes.
- Public prefix: `!wrg` → `!hmg`. Admin prefix: `/wrg ` → `/hmg `.
- Both are now single constants in `HangmanGame/config.js`
  (`PREFIX`, `ADMIN_PREFIX`, `GAME_NAME`, `GAME_ACRONYM`) — every other
  file imports them instead of hardcoding strings.

## Bug fix
- `gameEngine.js` had two leftover bare `wrg`/`WRG` references (lobby
  reminder ping, cancellation message) with no `!` prefix — the reason
  commands were being accepted without `!` during lobby join. Both now
  read from `config.PREFIX`, so this class of bug can't reoccur.

## Adaptive difficulty (replaces easy/normal/difficult)
- One flat word pool (`HangmanGame/gameEngine.js: DEFAULT_WORDS`),
  spanning 4–12 letters, replacing the three hand-picked tier pools.
- Each chat's `gameState.wordLengthTarget` starts at 5 letters and drifts
  ±1 letter per round (`adjustNextWordLength`):
  - Clean win (instant full-word guess, or few wrong guesses and no
    disqualifications) → next word is 1 letter longer.
  - Any disqualification, or no winner → next word is 1 letter shorter.
  - Otherwise → unchanged.
- `calcMaxTries` now scales off word length only (no difficulty
  multiplier) — `Math.max(5, Math.min(10, Math.round(len * 0.7) + 2))`.
- Admin word-pool commands (`addword`/`removeword`/`listwords`/
  `setwords`) no longer take a `[level]` argument — one pool.
- `/hmg set difficulty` is gone; `buildHelpText` explains the change.

## Post-round cooldown (2 min break + 30s restart ping)
- New `gameEngine.startCooldown(chatId, ctx)`:
  1. Immediately after the match report, sends a "round over, 2-minute
     break" message. The chat stays reserved (`activeGameChatRef`) so no
     second game can start mid-break.
  2. At T-30 seconds, sends a ping previewing the next round's word
     length.
  3. At T-0, automatically opens a fresh lobby (`openFreshLobby`) — no
     admin action required.
- `/hmg status` now reports cooldown state (time left, next word length)
  when the chat is on a break.

## Per-player DM stick figures (text-only, no images)
- `gameEngine.buildStickFigureDM(wrongCount, maxTries)` builds a
  monospace ASCII stick figure (6 body parts, proportional to
  `wrongCount / maxTries`).
- Fired from `publicCommands.js` on a player's **first and every**
  subsequent wrong guess — nothing is sent at join time (chosen: fewer
  message types, no placeholder state). Because it's triggered by real
  per-player gameplay events rather than a broadcast, DMs land naturally
  staggered across players — the safer pattern for a bot running on a
  personal WhatsApp number.

## Folder restructure (pluggable games)
- `index.js` is now a true thin orchestrator: connection handling, LID/PN
  resolution, dedup, and routing only. Zero game-specific strings.
- New `games-registry.js` auto-discovers any folder with a valid
  `config.js` + `gameEngine.js` + `adminCommands.js`.
- New `game-switch-commands.js`: shared creator-only `setgame` /
  `setadminaccess` commands, callable from any game's `adminCommands.js`.
- All Hangman-specific files moved into `HangmanGame/`.
- `WordLadderGame/` added as an empty placeholder folder — see the root
  `README.md` "Adding a New Game" section for the exact contract another
  AI/developer should follow so it merges in with zero changes elsewhere.
- `settings.json` gained two new game-agnostic fields: `activeGame`
  (which folder is live) and `adminGameAccess` (scopes the non-creator
  admin to one game or `all`).

## Known follow-ups (not in scope for this pass)
- `WordLadderGame/` logic itself — see `WORD_LADDER_RESEARCH.md` in the
  project for the design approach recommended for it.
- No automated tests exist for any of this — recommend manual runs
  against the `reports/HMG_Bot_Validation_Checklist.md` before deploying.

## Abstraction fix — game switching decoupled from active game's prefix

- **Problem:** `/hmg setgame wordladder` required knowing HMG's own
  prefix just to switch away from it — an admin scoped out of Hangman,
  or anyone who forgot the current acronym, had no way to run it.
- **Fix:** `setgame` / `setadminaccess` / `status` now live under a
  fixed, game-independent `/game` prefix, checked in `index.js` *before*
  the active game is even resolved. Removed the per-game hook from
  `HangmanGame/adminCommands.js` (and the now-unused import) — no game's
  `adminCommands.js` touches `game-switch-commands.js` anymore.
- **New:** `/game status` — shows active game, admin's scope, and every
  registered game key, without needing any game's own prefix.
- Updated `README.md`, `WordLadderGame/README.md` plugin contract to
  match: new game folders no longer need to wire up the switch hook at
  all.
