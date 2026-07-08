# Change Log 3 — bare-acronym regression + settings namespace + ARCHITECTURE.md update

This entry picks up an audit pass that was interrupted mid-way (the
previous session ran out before the fixes below were actually verified
and shipped, even though earlier chat output described them as done).
Everything below was re-checked against the real files on disk, not
assumed from the prior conversation.

## What was still actually broken

**1. Bare `!tgt` / `!m4th` silently started a session instead of
explaining the game.** Both `TargetNumbersGame/publicCommands.js` and
`TwentyFourGame/publicCommands.js` had:
```js
if (rest === '' || rest === 'start') { ...startSession... }
```
Typing just the acronym with no subcommand fell into the exact same
branch as `start`. Fixed by splitting the bare-prefix case into its own
branch (shown first, checked before `'start'`) that always sends a short
explainer — rules + command list — and never calls `startSession`,
matching the pattern the other four games already used correctly.

**2. `WordChainGame` still used bare, unnamespaced settings keys** —
`'difficulty'`, `'maxStrikes'`, `'timerSeconds'` — in both
`adminCommands.js` and `gameEngine.js`, despite this being identified
(but not actually applied) in the prior session. No other game currently
uses those names, so this wasn't live-broken yet, but it was exactly the
same class of bug as the `games[chatId]` state-key collision that
already crashed the bot once — just one layer up, in `settings` instead
of `games`. Fixed by prefixing all three with `` `${GAME_KEY}_` `` (i.e.
`wordchain_difficulty`, `wordchain_maxStrikes`, `wordchain_timerSeconds`).

## What was verified as already correct (no change needed)

- `HangmanGame`'s timers (`lobbyTimer`/`turnTimer`/`cooldownTimer`) are
  all cleared on `/hmg end`, `/hmg stop`, and `/hmg reset` — no leaked
  intervals, no "hung" game state.
- `HangmanGame/adminCommands.js`'s `/hmg reset` already scopes its loop
  over `games` to `` `${config.GAME_KEY}:` `` keys only.
- All 6 admin command handlers gate on `senderTier` before doing
  anything (§5) — no reachable-by-public admin commands found.
- `TargetNumbersGame`/`TwentyFourGame`'s `adminCommands.js` destructure
  `sender` from `ctx` and treat it as the reply-target chat id — this
  looks like the historical "wrong ctx field" bug class but is actually
  correct: `index.js` explicitly sets `cmdCtx.sender = from` (the chat
  id) for admin ctx, so this one is a confusing name, not a bug.
- `process.on('unhandledRejection'/'uncaughtException')` and the
  per-message `try/catch` in `index.js` are both present and correct.
- Ran `npm install` + `npm run verify` for real (not just read the code)
  — all 6 games load, no state-key aliasing, no `sendSafeMessage` misuse.

## New automated check

`scripts/verify-games.js` gained **check 6/6**: it actually invokes each
game's real `handlePublicMessage` (or `gameEngine.handlePublicMessage`)
as an ADMIN sending the bare prefix with a stubbed `sock`/`games`, and
fails the build if the game's state comes back `active: true` afterward.
This was sanity-tested both ways — reintroducing the old
`TargetNumbersGame` bug on purpose made check 6 fail with a clear
message, then restoring the fix made it pass again.

## Documentation

`ARCHITECTURE.md` gained:
- **§4** extended with an explicit settings-key-namespacing sub-rule
  (same principle as the existing state-key rule, just one layer up).
- **New §9** — "Bare acronym → explain the game. Always. No exceptions."
  — codifying the Hangman-proven pattern (explain first, gate `start`
  separately) as the standard every current and future game must follow.
- Two new rows in the "Failure modes this document prevents" table.
- §10 (renumbered from the old §9) references the new check 6.

This means a future game folder only needs `ARCHITECTURE.md` (and, if
convenient, one existing game folder as a template) to come out
contract-compliant on the first drop-in — no other file in the project
needs to change, per §1.
