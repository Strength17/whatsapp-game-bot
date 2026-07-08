# WhatsApp Bots · Sky Graphics

A WhatsApp game bot (built on Baileys) that currently runs **HangMan Game
(HMG)** and **Word Ladder Game (WLG)**, with a pluggable structure so the
creator can add and switch between multiple games without touching the core bot.

This file is written so it can be handed to **another AI** (or another
developer) to build any new game and have it merge in with **zero changes
to any existing file**.

---

## 1. Project structure

```
/index.js                 ← root orchestrator ONLY: connection, sender
                             resolution (LID/PN), message routing.
                             Contains no game-specific logic or strings.
/permissions.js            ← shared, game-agnostic: CREATOR/ADMIN/PUBLIC
                             tier resolution, setting overrides, name tags.
/games-registry.js          ← auto-discovers every game folder at boot.
/game-switch-commands.js    ← shared creator-only commands (setgame,
                             setadminaccess, status), invoked directly by
                             index.js under the FIXED "/game" prefix —
                             never under any individual game's own prefix.
/README.md                  ← this file.

/HangmanGame/
    config.js               ← GAME_KEY, GAME_NAME, PREFIX, ADMIN_PREFIX, tuning
    gameEngine.js            ← pure game-state logic (lobby, turns, board,
                             adaptive difficulty, cooldown, stick figures)
    publicCommands.js        ← handles "!hmg ..." messages + live guesses
    adminCommands.js         ← handles "/hmg ..." commands
    matchSummary.js          ← disqualification bookkeeping + match report

/WordLadderGame/
    config.js               ← GAME_KEY, GAME_NAME, PREFIX, ADMIN_PREFIX, tuning
    gameEngine.js           ← BFS solver, game state, adaptive difficulty, scoring
    wordBank.js             ← 3–6 letter dictionary + 5 themed puzzle pair sets
    publicCommands.js       ← handles "!wlg ..." messages + live word guesses
    adminCommands.js        ← handles "/wlg ..." commands
    matchSummary.js         ← session report builder
    README.md               ← game-specific docs

/<AnyNewGame>/              ← next game goes here; see "Plugin Contract" below
    config.js
    gameEngine.js
    publicCommands.js
    adminCommands.js
    matchSummary.js         ← optional but recommended

/reports/                    ← human-facing docs (see reports/README.md)
```

**Runtime files** (created automatically, not shipped in this zip):
`settings.json`, `words.json`, `games.json`, `names.json`, `lidcache.json`,
`auth_info/`.

---

## 2. Settings that are now game-agnostic

`settings.json` (root-level, shared across every game):

```jsonc
{
  "adminNumber": "",
  "adminJid": "",
  "maxTries": "auto",
  "publicVisible": true,
  "publicCanStart": false,
  "activeGame": "hangman",        // which game folder is currently live
  "adminGameAccess": "all"        // "all" or a specific GAME_KEY
}
```

- `activeGame` — read by `games-registry.getActiveGame()`. Only the
  **creator** can change it, via `/game setgame [key]` — a fixed prefix,
  independent of whichever game is currently active.
- `adminGameAccess` — scopes the confirmed **admin** (not the creator) to
  one game or `all`. The creator is never restricted by this.

---

## 3. The plugin contract — what a new game folder MUST export

Drop a folder in the project root (e.g. `WordLadderGame/`) containing
exactly these three files. `games-registry.js` requires them by these
exact names — nothing else needs to change anywhere in the project.

### `config.js`
```js
module.exports = {
    GAME_KEY:     'mygame',      // lowercase, unique, used in settings.activeGame
    GAME_NAME:    'My Game Name',
    GAME_ACRONYM: 'MGN',
    PREFIX:       '!mgn',        // public command prefix
    ADMIN_PREFIX: '/mgn ',       // admin command prefix (note trailing space)
    // ...any other tuning constants this game needs (timers, scoring, etc.)
}
```

### `gameEngine.js`
Pure game-state logic — timers, board building, win/lose detection. Must
export `getGameState(chatId, games)` (same lazy-create pattern as
Hangman's) since `index.js` calls it generically for both the admin
`/status`-style commands and restart recovery. Also export
`DEFAULT_WORDS` (or whatever the game's default content is) if `index.js`
should be able to seed `words.json` on first boot.

If your public-message handling (prefix commands + live gameplay) is a
separate file, name it `publicCommands.js` and export
`handlePublicMessage(msgCtx)` — `index.js` looks for that file
automatically if `gameEngine.handlePublicMessage` isn't exported directly.
Either shape works; Hangman uses the separate-file shape.

`handlePublicMessage(msgCtx)` receives:
```js
{
  sock, games, settings, words, activeGameChatRef, persistGames, nameCache,
  sendSafeMessage, buildCtx, // buildCtx() -> { sock, games, settings, words, activeGameChatRef, persistGames, nameCache }
  from, body, rawBody, senderNumber, senderJid, senderName, isAdmin
}
```
It should return `true`/handle-and-continue; `index.js` doesn't require a
particular return value today, but returning a boolean is good practice
for testability.

### `adminCommands.js`
Must export `handleAdminCommand(ctx)`. `ctx` shape (built by `index.js`):
```js
{
  sock, games, settings, words, activeGameChatRef, persistGames, nameCache,
  pendingAdminChangeRef, saveSettings, saveWords, sendSafeMessage,
  getGameState, startTurnCountdown, fs,
  senderNumber, senderDisplayId, senderName, senderJid, sender, body,
  isAdmin, senderTier
}
```
`senderTier` is one of `permissions.TIERS.CREATOR / ADMIN / PUBLIC` —
always use this instead of re-deriving tier logic.

**Your `handleAdminCommand` does NOT need to do anything for game
switching.** `setgame` / `setadminaccess` / `status` are handled entirely
by `index.js` under the fixed `/game` prefix, before your game's admin
prefix is even checked — so a new game's `adminCommands.js` never touches
`game-switch-commands.js` at all. This is intentional: it means the
creator can always type `/game setgame [key]` regardless of which game
(or which prefix) is currently active, instead of needing to remember
the active game's own acronym first.

Also respect the admin scope near the top of your "admin-only" command
block (mirrors Hangman's implementation):
```js
if (!senderIsCreator) {
    const scope = settings.adminGameAccess || 'all'
    if (scope !== 'all' && scope !== config.GAME_KEY) return
}
```

### `matchSummary.js` (optional but recommended)
Not required by the registry contract, but keeping bookkeeping /
"who won, who's out, final report" logic in its own file (like Hangman
does) keeps `gameEngine.js` and `publicCommands.js` readable.

---

## 4. How switching games works end-to-end

`/game` is a **fixed prefix**, always available, regardless of which
game is currently active or what that game's own acronym is. This is
deliberate — the creator should never have to remember "wait, what's
the active game's prefix again?" just to switch away from it.

1. Creator types `/game setgame [key]` — works regardless of which game
   is currently active.
2. `index.js` intercepts this before resolving the active game at all,
   and hands it to `game-switch-commands.js`, which looks up `[key]`
   in the registry. If `[GameFolder]/config.js` exists and loaded
   cleanly, it sets `settings.activeGame = '[key]'` and saves.
3. From that point on, every inbound message is routed by `index.js`
   using `registry.getActiveGame(settings)` — which now resolves to the
   new game module. Its `PREFIX`/`ADMIN_PREFIX` from `config.js` take
   over immediately for everything else (gameplay, that game's own admin
   commands), no restart needed.
4. The creator switches back to any other game with `/game setgame [key]`
   — same fixed prefix, never the active game's own acronym.
5. `/game setadminaccess [key]` (creator-only) restricts the current
   admin to only operating that specific game; `/game setadminaccess all`
   removes the restriction.
6. `/game status` (creator or admin) shows the active game, the admin's
   current scope, and every game key available in the registry.

---

## 5. Games built so far

### HangMan Game (HMG)
- Renamed WRG → **HMG ("HangMan Game")** everywhere; acronym/name are
  single constants in `HangmanGame/config.js`.
- Adaptive word-length difficulty — one flat word pool, target length drifts
  ±1 per round based on group performance (`gameEngine.adjustNextWordLength`).
- 2-minute post-round cooldown with automatic fresh lobby — no admin action needed.
- Per-player DM stick figures: private ASCII art (plain text) showing
  remaining lives after each wrong guess.

### Word Ladder Game (WLG)
- BFS engine (`bfsSolve`) finds the shortest valid transformation path
  between any two words in a 1,400+ word dictionary.
- 5 built-in themes: `general`, `animals`, `food`, `nature`, `tech` —
  each with hand-picked, BFS-verified puzzle pairs and witty hints.
- Adaptive difficulty — word length drifts ±1 based on solve speed and
  consecutive timeouts, same single-signal pattern as HMG.
- 90-second cooldown between rounds; hints reveal only the changed letter
  position, not the full answer.

---

## 6. Not carried over from the previous report set

The earlier `WRG_Bot_File_Summary.md` was intentionally dropped — it was
a strict subset of the other reports with nothing unique. See
`reports/README.md` for what's kept and why.
