# WordLadderGame (WLG) — Sky Graphics Bot Plugin

Drop this folder into the project root alongside `HangmanGame/`.  
**Zero changes to any existing file needed.** The `games-registry.js` auto-discovers it at boot.

---

## What it is

Classic BFS Word Ladder — transform a START word into an END word by changing exactly **one letter per step**. Every intermediate word must be a real dictionary word.

```
CAT → COT → COG → DOG   ✅
CAT → DAT → DOT → DOG   ❌  (DAT is not a word)
```

---

## Files

| File | Purpose |
|------|---------|
| `config.js` | All constants — timings, scoring, theme list, adaptive knobs |
| `gameEngine.js` | Pure logic — BFS solver, state, scoring, adaptive difficulty |
| `wordBank.js` | 3–6 letter dictionary + 5 themed puzzle pair sets |
| `publicCommands.js` | `!wlg` commands + live guess handling |
| `adminCommands.js` | `/wlg` admin commands |
| `matchSummary.js` | Session report builder |
| `README.md` | This file |

---

## Plugin contract (satisfied)

| Contract requirement | How WLG satisfies it |
|----------------------|----------------------|
| `config.js` exports `GAME_KEY`, `GAME_NAME`, `GAME_ACRONYM`, `PREFIX`, `ADMIN_PREFIX` | ✅ `'wordladder'`, `'Word Ladder Game'`, `'WLG'`, `'!wlg'`, `'/wlg '` |
| `gameEngine.js` exports `getGameState(chatId, games)` | ✅ Lazy-creates state, same pattern as Hangman |
| `publicCommands.js` exports `handlePublicMessage(msgCtx)` | ✅ Full `msgCtx` shape consumed |
| `adminCommands.js` exports `handleAdminCommand(ctx)` | ✅ Full `ctx` shape consumed; `senderTier` used for creator check |
| Admin scope guard at top of `handleAdminCommand` | ✅ Mirrors Hangman's `adminGameAccess` check exactly |
| No game-switching logic inside the game files | ✅ `setgame` stays in `game-switch-commands.js` |

---

## Switching to Word Ladder

```
/game setgame wordladder
```

Switch back:
```
/game setgame hangman
```

---

## Public commands (`!wlg`)

| Command | What it does |
|---------|-------------|
| `!wlg start` | Start a round (general theme) |
| `!wlg start animals` | Start with a specific theme |
| `!wlg themes` | List all 5 themes |
| `!wlg hint` | Get a letter hint (−5 pts) |
| `!wlg scores` | Show current scoreboard |
| `!wlg stop` | Stop current round _(admin)_ |
| `!wlg reset` | Wipe all scores _(admin)_ |
| `!wlg help` | Full command list |

To **guess**, just type a word in the chat during an active round. No prefix needed.

---

## Admin commands (`/wlg`)

| Command | What it does |
|---------|-------------|
| `/wlg status` | Game state overview |
| `/wlg settheme [theme]` | Set theme for next round |
| `/wlg setlength [3–6]` | Set word length for next round |
| `/wlg skip` | Skip current step (reveals optimal word) |
| `/wlg solution` | See full BFS solution (private) |
| `/wlg addpoints [number] [pts]` | Manually adjust a player's score |
| `/wlg clearscores` | Wipe all scores _(creator only)_ |
| `/wlg help` | Admin command list |

---

## The 5 themes

| Key | Emoji | Description |
|-----|-------|-------------|
| `general` | 🔤 | Open dictionary — classic ladder puzzles |
| `animals` | 🐾 | Animal-themed word pairs |
| `food` | 🍕 | Food-themed word pairs |
| `nature` | 🌿 | Nature/weather-themed pairs |
| `tech` | 💻 | Tech-themed pairs with witty hints |

---

## Scoring

| Event | Points |
|-------|--------|
| Each valid step | +10 |
| Completing the ladder (first to finish) | +30 bonus |
| Using a hint | −5 |
| Turn timeout (auto-skip) | −5 |

---

## Adaptive difficulty

Works exactly like Hangman's `adjustNextWordLength`:

- **Too easy** (solved in ≤ 3 steps) → word length increases by 1 next round  
- **Two consecutive timeouts** → word length decreases by 1  
- Range: 3–6 letters

---

## BFS engine notes

- Neighbour generation: for each position, tries all 26 letters → O(L × 26) per word
- Dictionary size: ~1,400+ words across 3–6 letters
- All themed puzzle pairs are pre-verified solvable through this dictionary
- `bfsSolve(start, end)` returns the full optimal path array, or `null` if unsolvable
- Hints reveal the changed letter position (bold), not the full next word
