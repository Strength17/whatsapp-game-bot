# WhatsApp Bots · Sky Graphics

A WhatsApp game bot (built on Baileys) that currently runs **six games** —
HangMan (HMG), Word Ladder (WLG), Word Chain (WCG), Target Numbers (TGT),
The 24 Game (M4T), and Momentum (MMT) — with a pluggable structure so the
creator can add and switch between them without touching the core bot.

**→ For the exact plugin contract every game folder must follow (and why),
see [`ARCHITECTURE.md`](./ARCHITECTURE.md).** That file is the canonical
spec — this README is the tour. If you're building a new game (or handing
this to another AI to build one), read `ARCHITECTURE.md` first.

**→ Before every deploy, run `npm run verify`** (see `scripts/verify-games.js`).
It catches missing dependencies, unwired game folders, broken contracts,
and state-isolation bugs before Railway (or any host) ever sees them —
see `reports/CHANGE_LOG.md` for the real incident this was built from.

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
/games-registry.js          ← auto-discovers EVERY game folder at boot
                             (scans the project root — nothing hardcoded).
/game-switch-commands.js    ← shared creator-only commands (setgame,
                             setadminaccess, status), invoked directly by
                             index.js under the FIXED "/game" prefix —
                             never under any individual game's own prefix.
/package.json               ← REQUIRED — see ARCHITECTURE.md §7.
/scripts/verify-games.js    ← pre-deploy check, also runs via `npm start`.
/README.md                  ← this file.
/ARCHITECTURE.md            ← the plugin contract — read this to add a game.

/HangmanGame/       ← !hmg / /hmg
/WordLadderGame/    ← !wlg / /wlg
/WordChainGame/     ← !wcg / /wcg
/TargetNumbersGame/ ← !tgt / /tgt
/TwentyFourGame/    ← !m4th / /m4th
/MomentumGame/      ← !mmt / /mmt

/<AnyNewGame>/              ← next game goes here; see ARCHITECTURE.md
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

## 3. The plugin contract — summary

**See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full, authoritative
contract** (exact required exports, the state-isolation rule, the
authorization-gate rule, and the failure modes each rule prevents). Short
version: drop a folder with `config.js` + `gameEngine.js` +
`adminCommands.js` (+ `publicCommands.js`) in the project root, following
the shapes documented there — `games-registry.js` auto-discovers it, no
other file changes.

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

| Game | Key | Public prefix | Admin prefix |
|---|---|---|---|
| HangMan Game | `hangman` | `!hmg` | `/hmg ` |
| Word Ladder Game | `wordladder` | `!wlg` | `/wlg ` |
| Word Chain Game | `wordchain` | `!wcg` | `/wcg ` |
| Target Numbers | `target` | `!tgt` | `/tgt ` |
| The 24 Game | `m4th` | `!m4th` | `/m4th ` |
| Momentum | `momentum` | `!mmt` | `/mmt ` |

### HangMan Game (HMG)
- Adaptive word-length difficulty — one flat word pool, target length drifts
  ±1 per round based on group performance (`gameEngine.adjustNextWordLength`).
- 2-minute post-round cooldown with automatic fresh lobby — no admin action needed.
- Per-player DM stick figures: private ASCII art (plain text) showing
  remaining lives after each wrong guess.

### Word Ladder Game (WLG)
- BFS engine (`bfsSolve`) finds the shortest valid transformation path
  between any two words in a themed dictionary.
- 5 built-in themes: `general`, `animals`, `food`, `nature`, `tech`.
- Adaptive difficulty — word length drifts based on solve speed and
  consecutive timeouts, same single-signal pattern as HMG.

### Word Chain, Target Numbers, The 24 Game, Momentum
Each follows the same plugin contract (`ARCHITECTURE.md`) with its own
gameplay loop, word/number pools, and admin command set — see each
folder's own comments for gameplay specifics. All four were audited and
had bugs fixed in this pass — see `reports/CHANGE_LOG.md` for the full list.

---

## 6. Not carried over from the previous report set

The earlier `WRG_Bot_File_Summary.md` was intentionally dropped — it was
a strict subset of the other reports with nothing unique. See
`reports/README.md` for what's kept and why.
