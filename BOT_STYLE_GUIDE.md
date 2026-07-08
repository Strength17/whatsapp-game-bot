# Sky Graphics Bot — Message Style Guide

Applies to HMG (Hangman) and should be copied over to every other game
plugin so all bot messages are instantly recognizable as one source.

## 1. Identity band (big "card" messages only)
Header/footer for lobby open/close, help dashboard, match reports:
```
━━━━━━━━━━━━━━━━━━━━━━
🤖 *[Title]*
━━━━━━━━━━━━━━━━━━━━━━
...body...
━━━━━━━━━━━━━━━━━━━━━━
_[ACRONYM] Bot · Sky Graphics_ 🎨
```
Quick transactional replies (single-line confirms/errors like "⚠️ No
active lobby") stay minimal — no header/footer, to avoid clutter.

## 2. Emoji vocabulary (use the same meaning everywhere)
- ✅ success / correct   ❌ failure / wrong   ⚠️ warning / blocked
- 🚫 disqualified/locked  🏆 win  💀 elimination/game over
- ⏱️/⏳ timers  🎮 gameplay  📊 stats  👥 players  🔒 locked feature

## 3. Text conventions
- **Bold** for names, numbers, and key values.
- `›` bullet prefix for config/settings lines.
- Numbered emoji (1️⃣2️⃣3️⃣) for sequential how-to steps.
- Constants (`config.BOT_EMOJI`, `config.DIVIDER`) — never hardcode the
  divider or emoji inline, so a future rebrand is a one-line change.

## 4. Fixes applied this pass (Hangman)
1. Round start now shows the masked word + turn prompt (was silent).
2. `/hmg start` now bypasses the 2-minute cooldown instead of failing.
3. Manual admin-set DM now sends to a real JID, not a bare number.
4. Stick figure rebuilt: 10 distinct damage stages (legs→arms→torso→head,
   each with a hit→gone sub-stage) so no two wrong guesses ever render
   the same picture, at any maxTries from 5–10.
5. Stick figure now posts in the **group**, tagged with player name +
   strike count — not a private DM.
6. `!hmg` intro replaced with the exact requested copy.
7. Identity band applied to all major cards per §1 above.

**Not fixed — needs `index.js`/`permissions.js`:** a possible admin
auto-assignment path outside this plugin's own files. Nothing in
`adminCommands.js` writes `adminNumber` without the key-confirm or
creator-confirm flow, so if this still happens, the cause lives outside
this zip — send those two files and I'll trace it.
