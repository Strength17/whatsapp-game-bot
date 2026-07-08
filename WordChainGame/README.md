# WordChainGame — Word Chain (WCG)

Say a real word. The next player's word must start with the last letter
of yours. No repeats. Strikes (wrong word, timeout, or broken rule) and
you're out — last player standing wins.

Restructured to match this project's plugin contract (see the root
`README.md`) — drop this folder in next to `HangmanGame/`, register it
in the platform's game map (wherever `AVAILABLE_GAMES` / the `/game`
dispatcher lives now), and the creator can switch to it with the fixed
platform-level prefix:

```
/game setgame wordchain
```

This game does **not** wire up `setgame`/`setadminaccess`/`status`
itself — per the current architecture, that's handled entirely by the
root `/game` command, the same way for every game. Nothing in this
folder needs to change if that dispatcher changes later.

## Files in this folder

| File | Role |
|---|---|
| `config.js` | `GAME_KEY`, `GAME_NAME`, `GAME_ACRONYM`, `PREFIX` (`!wcg`), `ADMIN_PREFIX` (`/wcg `), difficulty tuning |
| `gameEngine.js` | Pure game-state logic: lobby, turns, strikes, word-chain validation pipeline |
| `publicCommands.js` | Exports `handlePublicMessage(msgCtx)` — `!wcg` commands + live word submissions |
| `adminCommands.js` | Exports `handleAdminCommand(ctx)` — `/wcg ...` commands, wired to the shared `setgame`/`setadminaccess` |
| `matchSummary.js` | End-of-match report + all-time stats (`wordchain-stats.json`, namespaced so it never collides with another game's stats file) |
| `dictionary.js` | Offline ~370k-word English validator (`word-list` npm package) + theme union logic |
| `themeBank.js` | Default theme word banks (seeds the shared `words.json` on first boot) |
| `display.js` | Local difficulty/theme badge formatting — kept local rather than assumed on the shared `permissions.js` |

## Dependency to add to the project's root `package.json`

```json
"word-list": "^4.0.0"
```
(Everything else this game needs — `@whiskeysockets/baileys`, `@hapi/boom`,
`dotenv` — the multi-game project already has at the root.)

## Themed Rounds

Themes (Gen Z slang, gaming terms, etc.) are **unioned with the offline
dictionary**, never a replacement for it:

- The dictionary stays the fallback pool, so a chain never dead-ends
  just because a themed word ends in an uncommon letter.
- Themed words are *additionally* accepted — a player can say `"rizz"`
  and have it count, even though it's not in a standard dictionary.
- Theme lists are small, curated, admin-editable JSON-shaped data
  (`words.themes` inside the shared `words.json`) — no code change
  needed to refresh slang as it ages, and no risk of the engine
  breaking if a theme list goes stale.

Admin commands:
```
/wcg set theme genz|gaming|none
/wcg listthemes
/wcg listthemewords [theme]
/wcg addthemeword [theme] [word]
/wcg removethemeword [theme] [word]
```

## Known limitation (unchanged from the standalone build)

Words ending in rare letters (like **X**) can occasionally dead-end a
chain since few English words start with X. Not special-cased here to
avoid over-engineering a rare edge case — a house-rule fallback (e.g.
allow the second-to-last letter) is a small follow-up if it becomes
annoying in practice.
