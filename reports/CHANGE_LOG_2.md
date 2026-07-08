# Change Log — Railway crash audit & fix

This entry documents a full end-to-end audit after a reported crash on
Railway. Every item below was reproduced locally (using a stubbed
Baileys socket so the full message pipeline could run without a live
WhatsApp session) before being fixed, and re-verified after.

## What actually crashed the deploy

**Primary cause: `package.json` was missing from the project entirely.**
No dependency manifest means the host can't install `@whiskeysockets/baileys`,
`@hapi/boom`, `dotenv`, or `qrcode-terminal` — `node index.js` fails on
its very first `require()` line, before any application code runs. This
is the failure that matches "crashed on Railway" most directly, and it's
now fixed by adding `package.json` back with every dependency actually in
use (confirmed by scanning every `require()` in the codebase, not just
copied from memory — this is also what `npm run verify` checks going
forward).

**A second, equally certain crash was waiting right behind it:**
`WordChainGame/dictionary.js` requires the `word-list` npm package, which
also had no `package.json` entry. Even with the missing manifest fixed,
the first message routed to Word Chain would have thrown
`Cannot find module 'word-list'`.

**A third class of crash was reproduced directly:** two admin command
files (`TargetNumbersGame` and `TwentyFourGame`) called the shared
`sendSafeMessage(sock, jid, payload)` helper as `sendSafeMessage(chatId,
{ text })` — missing the `sock` argument entirely. Since the very first
line of that helper called `jidOrNumber.includes('@')`, and `jidOrNumber`
was actually an object (`{ text }`), this threw a `TypeError` *outside*
the helper's own try/catch, which propagated up through an `await` chain
with nothing catching it. In the Node version this project targets,
an unhandled promise rejection reaching the top of the stack terminates
the process by default — so any admin typing `/tgt` or `/m4th` anything
would have taken the entire bot down, not just that command.

## Every bug found and fixed

1. **Missing `package.json`.** Recreated with every dependency actually
   `require()`'d anywhere in the codebase (`@hapi/boom`,
   `@whiskeysockets/baileys`, `dotenv`, `qrcode-terminal`, `word-list`),
   plus `engines.node`, a `start` script, and a `prestart` hook that runs
   `scripts/verify-games.js` automatically before every boot.

2. **`games-registry.js` hardcoded a 2-folder allowlist**
   (`['HangmanGame', 'WordLadderGame']`), silently ignoring
   `MomentumGame`, `TargetNumbersGame`, `TwentyFourGame`, and
   `WordChainGame` — four fully-built games were completely unreachable.
   Replaced with a dynamic scan of every top-level project folder;
   anything with a valid `config.js` + `gameEngine.js` + `adminCommands.js`
   is now auto-discovered. All 6 games now load and are switchable via
   `/game setgame [key]`.

3. **Critical authorization bypass** in `TargetNumbersGame/adminCommands.js`
   and `TwentyFourGame/adminCommands.js`: the admin-scoping check ran, but
   the actual "is this sender even an admin" check was missing entirely.
   Any public group member could run every `/tgt` / `/m4th` admin command.
   Fixed by adding the missing tier gate (mirrors the pattern already
   correct in the other four games).

4. **`sendSafeMessage` argument-order bug**, three games affected:
   - `TargetNumbersGame` / `TwentyFourGame`: one-line fix, added the
     missing `sock` argument.
   - `WordLadderGame`: systemic — every call site in `publicCommands.js`
     and `adminCommands.js` used a local `(jid, text)` convention against
     the shared `(sock, jid, payload)` contract. Fixed with a one-time
     shim at the top of each entry function rather than touching 20+ call
     sites, so all existing calls keep working unchanged underneath it.

5. **`WordLadderGame/adminCommands.js` destructured a `from` field that
   doesn't exist** on the ctx object `index.js` actually provides (the
   chat id is passed as `sender`). Every admin reply was silently
   failing — the entire `/wlg` admin command surface was non-functional.
   Fixed by aliasing `sender` to `from` at destructure time.

6. **Cross-game state contamination — the most structurally serious
   bug found.** `HangmanGame`, `WordChainGame`, and `WordLadderGame` all
   stored their per-chat state at the bare `games[chatId]` key in the
   `games` object — which is shared across every loaded game module.
   Switching the active game in a chat that a different one of these
   three had previously used in handed the new game a leftover,
   wrong-shaped state object instead of a fresh one. Reproduced directly:
   starting a Hangman round then switching to Word Ladder in the same
   chat and typing `!wlg scores` threw `TypeError: Cannot convert
   undefined or null to object` inside `getScoreboard()`. Fixed by
   namespacing all three games' state keys as `` `${GAME_KEY}:${chatId}` ``
   (`MomentumGame`, `TargetNumbersGame`, and `TwentyFourGame` were already
   safe — they nest under a game-specific sub-property instead). Also
   fixed `index.js`'s restart-recovery code, which previously read
   `games[chatId]` directly (now goes through each game's own
   `getGameState()`, which is the correct abstraction regardless of key
   format), and `/hmg reset`, which previously deleted every key in the
   shared `games` object — including other games' active sessions — and
   unconditionally deleted `games.json` outright. Both now scope strictly
   to Hangman's own `hangman:` prefix.

7. **Hardened the shared infrastructure so this class of bug can't take
   the whole bot down again, even if a future game folder gets something
   wrong:**
   - `sendSafeMessage` now validates its own arguments (wrong `sock`,
     wrong jid type, wrong payload type) and logs a clear diagnostic
     instead of throwing.
   - Every message in `index.js`'s `messages.upsert` handler is now
     processed inside its own try/catch — one bad message logs and moves
     on instead of blocking or crashing the listener.
   - `process.on('unhandledRejection'/'uncaughtException')` added as a
     final backstop — logs and keeps the process alive.

8. **New `scripts/verify-games.js`**, wired as `npm run verify` and as
   `prestart` (so it runs automatically before `npm start`). Checks, in
   order: every `require()`'d npm package is declared in `package.json`;
   every game-shaped folder in the project root actually loaded into the
   registry; every loaded game satisfies the export contract; no two
   games alias the same state-storage key for the same chat (the
   automated regression test for bug #6); and flags any
   `sendSafeMessage` call that doesn't look like it follows the
   `(sock, jid, payload)` contract.

9. **New `ARCHITECTURE.md`** at the project root — the abstract contract
   document for any future game folder, written directly from the bugs
   above so each rule maps to a real failure mode it prevents.

## Not fixed in this pass (noted, not blocking)

- `TargetNumbersGame`'s `/tgt help` doesn't currently resolve to a real
  help command — minor UX gap, not a crash.
- `WordChainGame`'s self-claim `/wcg admin` onboarding and Hangman's
  creator-approval-key onboarding are two different, equally valid
  conventions — not unified, since both work correctly on their own.
- The admin-scope rejection message differs across games (silent vs. an
  explicit "admin-only" reply) — a UX inconsistency, not a bug; see
  `ARCHITECTURE.md` if you want to standardize it later.
