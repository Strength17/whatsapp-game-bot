# WhatsApp Game Bots · Sky Graphics

A WhatsApp game bot (built on Baileys) with a pluggable structure — the
creator can add and switch between games without touching the core bot.
Currently runs **two games**: **Hangman** (`hangman`) and **Word Climb**
(`wordclimb`).

**→ Building a new game? Read [`ARCHITECTURE.md`](./ARCHITECTURE.md)
first.** That's the canonical plugin contract — this file is the tour.

**→ Want every command, the message-format conventions, and the file
layout in one place? Read [`COMMAND_REFERENCE.md`](./COMMAND_REFERENCE.md).**
This README won't repeat what's there.

**→ Before every deploy, run `npm run verify`** (`scripts/verify-games.js`).
It catches missing dependencies, unwired game folders, broken contracts,
and state-isolation bugs before any host sees them.

This project is written so it can be handed to **another AI** (or another
developer) to build a new game with **zero changes to any existing game
folder** — only the shared root files (`index.js`, `admin-onboarding.js`,
`game-switch-commands.js`, `games-registry.js`) are meant to be touched
across the whole project's lifetime, and even those only for genuinely
game-agnostic concerns.

---

## 1. Project structure

```
/index.js                  ← root orchestrator ONLY: connection, sender
                              resolution (LID/PN), message routing.
                              Contains no game-specific logic or strings.
/permissions.js             ← shared, game-agnostic: CREATOR/ADMIN/PUBLIC
                              tier resolution, setting overrides, name tags.
/admin-onboarding.js         ← "/admin ..." — bot-wide admin IDENTITY:
                              who is the admin, and which game(s) they
                              may operate. Fixed prefix, independent of
                              which game is currently active.
/game-switch-commands.js     ← "/game ..." — which game is currently
                              active, and the confirmed admin's scope.
                              Also a fixed prefix.
/games-registry.js           ← auto-discovers EVERY game folder at boot
                              (scans the project root — nothing hardcoded).
/package.json                ← REQUIRED — see ARCHITECTURE.md §7.
/scripts/verify-games.js      ← pre-deploy check, also runs via `npm start`.
/README.md                    ← this file.
/ARCHITECTURE.md              ← the plugin contract — read this to add a game.
/COMMAND_REFERENCE.md          ← every command, message shape, file layout.

/HangmanGame/       ← !hmg / /hmg
/WordClimbGame/     ← !wcl / /wcl

/<AnyNewGame>/              ← next game goes here; see ARCHITECTURE.md
    config.js
    gameEngine.js
    publicCommands.js
    adminCommands.js
    matchSummary.js         ← optional but recommended
    README.md               ← that game's own rules + commands
```

**Runtime files** (created automatically, not shipped in this zip):
`settings.json`, `words.json`, `games.json`, `names.json`, `lidcache.json`,
`auth_info/`.

---

## 2. Settings that are game-agnostic

`settings.json` (root-level, shared across every game):

```jsonc
{
  "adminNumber": "",
  "adminJid": "",
  "activeGame": "hangman",        // which game folder is currently live
  "adminGameAccess": "all",       // "all" or a specific GAME_KEY
  "showRoleTags": true,           // bot-wide (Creator)/(Admin) name tag
  "publicVisible": true,
  "publicCanStart": false
  // + any game-specific keys, namespaced by that game's GAME_KEY,
  // e.g. "wordclimb_turnSeconds" — see each game's config.js
}
```

- `activeGame` — read by `games-registry.getActiveGame()`. Only the
  **creator** can change it, via `/game setgame [key]`.
- `adminNumber` / `adminJid` / `adminGameAccess` — bot-wide admin
  identity, set via `/admin` (see `admin-onboarding.js`) — **never**
  from inside an individual game's own admin commands.

---

## 3. The plugin contract — summary

**See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full, authoritative
contract.** Short version: drop a folder with `config.js` +
`gameEngine.js` + `adminCommands.js` + `publicCommands.js` in the
project root, following the shapes documented there —
`games-registry.js` auto-discovers it, no other file changes.

---

## 4. How admin identity and game switching work end-to-end

Two separate, fixed, game-independent prefixes — neither lives inside
any individual game's folder:

- **`/admin`** answers *"who is allowed to run admin commands, and for
  which game(s)"* — bot identity. Request access, redeem a key, or have
  the creator assign someone directly with `/admin set [num] [gamekey|all]`.
- **`/game`** answers *"which game is currently live, and what can the
  current admin touch"* — bot configuration. `/game setgame [key]`
  switches games (cleanly stopping any live session first, if the
  outgoing game supports it); `/game setadminaccess [gamekey|all]`
  scopes the admin; `/game status` shows both at a glance.

Full command tables for both: [`COMMAND_REFERENCE.md`](./COMMAND_REFERENCE.md) §1.

---

## 5. Games built so far

| Game | Key | Public prefix | Admin prefix |
|---|---|---|---|
| Hangman | `hangman` | `!hmg` | `/hmg ` |
| Word Climb | `wordclimb` | `!wcl` | `/wcl ` |

### Hangman (HMG)
Classic single-word elimination, adapted for a live group chat.
- Adaptive word-length difficulty — target length drifts based on group
  performance round to round (`gameEngine.adjustNextWordLength`).
- 2-minute post-round cooldown with an automatic fresh lobby — no admin
  action needed between matches.
- Per-player stick-figure elimination card, posted live in the **group**
  (not a DM) and tagged with that player's name + strike count, the
  moment they miss a guess.
- Full rules + command list: [`HangmanGame/README.md`](./HangmanGame/README.md).

### Word Climb (WCL)
Turn-based elimination — the required word length escalates a rung at
a time (3→8 letters), 3 strikes and you're out.
- Full rules + command list: [`WordClimbGame/README.md`](./WordClimbGame/README.md).

---

## 6. Adding a new game

1. Read `ARCHITECTURE.md` end to end.
2. Create `<NewGame>/` with the required files (see §1 above).
3. Give it its own `GAME_KEY` / `PREFIX` / `ADMIN_PREFIX` in `config.js`
   — no other file needs to know it exists.
4. Write `<NewGame>/README.md` following the same shape as
   `HangmanGame/README.md` or `WordClimbGame/README.md`.
5. Run `npm run verify` before deploying. It checks the contract, state
   isolation, and the bare-acronym rule automatically.
