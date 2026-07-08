# WRG Bot — Validation & Testing Checklist
*Sky Graphics · Word Riddle Game*
*Test every command and workflow in order. Check each box when confirmed.*

---

## HOW TO USE THIS DOCUMENT

- Work through each section top to bottom on a fresh bot startup.
- Each test shows exactly what to type, exactly what response to expect, and exactly where it should arrive (your DM, the group, etc.).
- A ✅ pass means the response matched exactly. A ❌ fail means something is wrong — note what happened.
- Run the **Startup** section first every single time before testing anything else.

---

---

# SECTION 1 — STARTUP & CONNECTION

| # | What to check | Expected result | Pass/Fail |
|---|---|---|---|
| 1.1 | Deploy / restart bot on Railway | Logs show QR code URL and `🔗 OR click this link...` | |
| 1.2 | Open the QR URL in your browser, scan with WhatsApp | Logs show `pairing configured successfully` then `✅ WRG Bot is connected!` | |
| 1.3 | Check your (creator's) DM | You receive: `🔁 WRG Bot is back online! ✅` / `👑 You're the Creator (unrestricted access).` / `Type /wrg help to open your full dashboard.` | |
| 1.4 | If an admin is set and is a different number | That admin also receives a separate boot DM | |
| 1.5 | Check Railway logs | No crash, no unhandled errors after sync completes | |

---
✅
---

# SECTION 2 — CREATOR IDENTITY & SLASH COMMAND ROUTING

Test these by typing commands in **any chat** (your own DM with the bot, or a group). All replies must arrive in **your DM only** — never in the group.

---

## 2A — Creator Recognition

| # | Type this | Expected reply (in your DM) | Pass/Fail |
|---|---|---|---|
| 2.1 | `/wrg admin` | `🔐 Sky Graphics Creator — Welcome back, Founder. You have unrestricted access...` | |
| 2.2 | `/wrg help` | Full dashboard with ALL sections including `/wrg approve` and `/wrg deny` | |

--- ✅

## 2B — Command Prefix Routing

| # | Type this | Expected behaviour | Pass/Fail |
|---|---|---|---|
| 2.3 | `/help` (no wrg prefix) | Bot does NOT respond — this is correct, `/wrg ` prefix is required | |
| 2.4 | `/wrg status` | Status reply arrives in your DM | |
| 2.5 | `wrg` (no slash) | Ping/info response in the same chat (public command — see Section 4) | |

---
Fix: Typing /wrg Without any explicit command mentioned after, should show the use case, right? So it needs to tell you that "You need to type it and type a command afte".
---

# SECTION 3 — ADMIN ONBOARDING FLOW

Run this from a **second phone** (not the creator number). All steps assume the admin slot is empty to start.

---

## 3A — Request Flow

| # | Who types / what | Expected result | Pass/Fail |
|---|---|---|---|
| 3.1 | Second phone types `/wrg admin` | Second phone DMs: `🔐 Admin Configuration — enter the access key provided by the Sky Graphics team: /wrg admin YOURKEY` | |
| 3.2 | Creator DM | Creator receives: requester's name, number, UUID key, and `/wrg approve` / `/wrg deny` options | |

--- ✅

## 3B — Creator Approves

| # | Who types / what | Expected result | Pass/Fail |
|---|---|---|---|
| 3.3 | Creator types `/wrg approve [second phone number]` | Second phone DM: branded key delivery with the UUID and instruction `/wrg admin YOURKEY`. Creator DM: delivery confirmation | |
| 3.4 | Second phone types `/wrg admin [correct UUID key]` | Second phone DM: `Access Granted — Welcome, Administrator!`. Creator DM: `Admin Registration Complete — Name, Number` | |
| 3.5 | Restart bot | Admin receives boot DM alongside creator | |

---

## 3C — Creator Denies (test separately, reset after)

| # | Who types / what | Expected result | Pass/Fail |
|---|---|---|---|
| 3.6 | Second phone types `/wrg admin` | Request arrives at creator as above | |
| 3.7 | Creator types `/wrg deny [second phone number]` | Second phone DM: neutral rejection, no reason. Creator DM: void confirmation | |
| 3.8 | Second phone tries to submit the key they may have seen | Bot ignores it — session was deleted | |

---

## 3D — Rate Limiting

| # | What to do | Expected result | Pass/Fail |
|---|---|---|---|
| 3.9 | Third phone types `/wrg admin` 5 times rapidly without completing | After 5 attempts, the 6th attempt gets no response (silent lockout for 10 mins) | |

---

## 3E — Key Expiry (10-minute timeout)

| # | What to do | Expected result | Pass/Fail |
|---|---|---|---|
| 3.10 | Request access, get the key, wait 10+ minutes, then submit it | Bot replies: `Session Expired.` Creator receives expiry notification | |

---

## 3F — Admin Slot Already Filled

| # | Who types / what | Expected result | Pass/Fail |
|---|---|---|---|
| 3.11 | A third phone (not admin, not creator) types `/wrg admin` | That person DM: `This bot is already configured. Contact the group admin for assistance.` No key generated. Creator not notified | |
| 3.12 | The registered admin types `/wrg admin` | Admin receives their help dashboard (same as `/wrg help`) | |

---

---

# SECTION 4 — CREATOR COMMANDS (full validation)

Type all of these as the creator. All replies go to your DM.

---

## 4A — Settings Commands

| # | Type this | Expected reply | Pass/Fail |
|---|---|---|---|
| 4.1 | `/wrg set difficulty normal` | `Difficulty set to: 🟡 NORMAL` | |
| 4.2 | `/wrg set difficulty difficult` | `Difficulty set to: 🔴 DIFFICULT` | |
| 4.3 | `/wrg set difficulty easy` | `Difficulty set to: 🟢 EASY` | |
| 4.4 | `/wrg set difficulty banana` | Error reply — invalid value | |
| 4.5 | `/wrg set public off` | Confirmation that public visibility is OFF | |
| 4.6 | `/wrg set public on` | Confirmation that public visibility is ON | |
| 4.7 | `/wrg set start on` | Confirmation that public can now open lobbies | |
| 4.8 | `/wrg set start off` | Confirmation that only admin/creator can open lobbies | |
| 4.9 | `/wrg set maxtries 5` | Confirmation: max tries locked to 5 | |
| 4.10 | `/wrg set maxtries auto` | Confirmation: max tries set back to auto-scaling | |
| 4.11 | `/wrg set maxtries 0` | Error reply — invalid value | |

---

## 4B — Direct Admin Assignment

| # | Type this | Expected flow | Pass/Fail |
|---|---|---|---|
| 4.12 | `/wrg set admin [a valid number]` | Your DM: confirmation prompt asking you to type `/wrg confirm` or `/wrg cancel` | |
| 4.13 | `/wrg confirm` | Admin slot updated. New admin receives a welcome DM | |
| 4.14 | Run 4.12 again, then `/wrg cancel` | Your DM: change discarded. Admin slot unchanged | |

---

## 4C — Word Pool Commands

| # | Type this | Expected result | Pass/Fail |
|---|---|---|---|
| 4.15 | `/wrg addword easy sunshine` | Confirmation: `sunshine` added to easy pool | |
| 4.16 | `/wrg listwords easy` | List shows `sunshine` (and any other easy words) | |
| 4.17 | `/wrg removeword easy sunshine` | Confirmation: `sunshine` removed | |
| 4.18 | `/wrg setwords easy apple mango grape` | Easy pool replaced with exactly those 3 words | |
| 4.19 | `/wrg clearwords easy` (if other pools have words) | Easy pool cleared. Reply confirms | |
| 4.20 | `/wrg clearwords easy` (if easy is the ONLY pool with words) | Refused — bot will not leave all pools empty | |
| 4.21 | `/wrg setallwords easy:cat normal:bridge difficult:cryptography` | All three pools updated in one command | |

---

## 4D — Creator-Exclusive Commands

| # | Type this | Expected result | Pass/Fail |
|---|---|---|---|
| 4.22 | `/wrg approve [number with no active request]` | Your DM: `No active request found` | |
| 4.23 | `/wrg deny [number with no active request]` | Your DM: `No active request found` | |
| 4.24 | Admin tries `/wrg approve [number]` | Silent — no response. Admin cannot run this command | |
| 4.25 | `/wrg reset` | All settings, overrides, word pools → defaults. Any active game killed. Admin access preserved | |

---

## 4E — /clearadmin

| # | Type this | Expected result | Pass/Fail |
|---|---|---|---|
| 4.26 | `/wrg clearadmin` | Admin number and JID cleared. Admin's settings layer reset to defaults. Word pools untouched. Creator override untouched. Creator DM: confirmation | |
| 4.27 | After clearadmin — previous admin tries any `/wrg` command | No response — they are now PUBLIC tier | |

---

---

# SECTION 5 — ADMIN COMMANDS (full validation)

Log in as the registered admin for all of these. Replies go to the admin's DM.

---

| # | Type this | Expected result | Pass/Fail |
|---|---|---|---|
| 5.1 | `/wrg help` | Full dashboard WITHOUT `/wrg approve` and `/wrg deny` sections | |
| 5.2 | `/wrg set difficulty normal` | `Difficulty set to: 🟡 NORMAL` | |
| 5.3 | `/wrg set public off` | Visibility turned off | |
| 5.4 | `/wrg set public on` | Visibility turned on | |
| 5.5 | `/wrg set start on` | Public can now start lobbies | |
| 5.6 | `/wrg set start off` | Public cannot start lobbies | |
| 5.7 | `/wrg set maxtries 6` | Max tries locked to 6 | |
| 5.8 | `/wrg set maxtries auto` | Back to auto | |
| 5.9 | `/wrg addword normal strategy` | Word added | |
| 5.10 | `/wrg listwords normal` | Shows `strategy` in the list | |
| 5.11 | `/wrg removeword normal strategy` | Word removed | |
| 5.12 | `/wrg status` (no active game) | Current effective config shown | |
| 5.13 | `/wrg reset` | No response — admin cannot run `/reset` | |
| 5.14 | `/wrg approve [any number]` | No response — admin cannot run `/approve` | |
| 5.15 | `/wrg clearadmin` | Admin clears their own slot. They are now PUBLIC tier. Creator DM notified | |

---

## 5A — Creator Override Takes Precedence (visual check)

| # | Steps | Expected result | Pass/Fail |
|---|---|---|---|
| 5.16 | Creator sets `/wrg set difficulty easy`. Then admin sets `/wrg set difficulty difficult`. Start a game. | Game uses EASY words (creator's override wins silently) | |
| 5.17 | Admin receives their `/wrg set difficulty difficult` confirmation | Confirmation is sent normally — admin has no visibility that the override exists | |

---

---

# SECTION 6 — PUBLIC VISIBILITY GATES

| # | Setup | Test | Expected result | Pass/Fail |
|---|---|---|---|---|
| 6.1 | Admin/creator sets `/wrg set public off` | Third phone sends any message | Bot completely ignores it — no reply | |
| 6.2 | Public visibility OFF | Third phone types `/wrg admin` | Bot still processes it — onboarding must never be blocked | |
| 6.3 | Admin/creator sets `/wrg set public on` | Third phone sends `wrg` | Ping/info response arrives | |

---

---

# SECTION 7 — GAME FLOW (end-to-end)

Run this test with at least 2 phones in the same WhatsApp group.

---

## 7A — Lobby

| # | Who does what | Expected result | Pass/Fail |
|---|---|---|---|
| 7.1 | Admin/creator (or public if `/wrg set start on`) types `WRG` in the group | Group receives lobby open message with difficulty badge and 60-second countdown | |
| 7.2 | Check auto-join | Creator and admin appear in the lobby list with role badges automatically | |
| 7.3 | Second phone types `wrg join` | Group receives updated lobby list with second phone's name added | |
| 7.4 | Second phone types `wrg join` again | Reply to second phone: `You're already in the lobby! Sit tight.` | |
| 7.5 | Third phone types `WRG` while lobby is open | Reply: `A game is currently running in another chat.` Admin receives a DM alert | |
| 7.6 | Anyone in the lobby types `wrg start` | Game starts immediately, lobby timer cancelled | |

---

## 7B — Active Game — Letter Guessing

| # | Who does what | Expected result | Pass/Fail |
|---|---|---|---|
| 7.7 | Game board sent | Group sees hidden word as `_ _ _ _ _`, current player highlighted, attempt budget shown | |
| 7.8 | A player who is NOT the current player types a letter | Bot ignores it silently | |
| 7.9 | Current player types a letter that IS in the word | Letter revealed. Turn advances. New board sent | |
| 7.10 | Current player types a letter NOT in the word | Wrong guess count increases. Turn advances. New board shows updated count | |
| 7.11 | 20-second warning | Group receives warning mentioning current player's name | |
| 7.12 | 10-second warning | Group receives urgent warning | |
| 7.13 | Turn timer reaches 0 (let it expire) | Turn skipped. Skip streak count increases. Next player's board sent | |

---

## 7C — Disqualification Paths

| # | Setup | Expected result | Pass/Fail |
|---|---|---|---|
| 7.14 | Let the same player miss 3 turns in a row | Player disqualified: `Skipped 3 turns in a row`. Removed from active players. Match continues | |
| 7.15 | Let a player use all their wrong guesses | Player disqualified: `Used all wrong guesses`. Removed from active players. Match continues | |
| 7.16 | All players except one are disqualified | Last player standing. Match report sent with `last_standing` outcome | |
| 7.17 | All players are disqualified | Match report sent with `no_winner` outcome | |

---

## 7D — Win Conditions

| # | What to do | Expected result | Pass/Fail |
|---|---|---|---|
| 7.18 | Current player guesses letters until the whole word is revealed | Victory. Match report sent with winner's name and the revealed word | |
| 7.19 | Current player types the entire word exactly | `INSTANT WIN!` message sent. Match report sent immediately | |

---

## 7E — Game Controls Mid-Round

| # | Admin/creator does | Expected result | Pass/Fail |
|---|---|---|---|
| 7.20 | `/wrg pause` during active game | Group: `Game paused by the admin. Sit tight — we'll be right back! ☕`. Admin DM: `Game paused ✅`. Turn timer frozen | |
| 7.21 | Paused: a player tries to guess | No response — guesses not accepted while paused | |
| 7.22 | `/wrg resume` | Group: `Game resumed by the admin! Back in action — keep guessing! 🔥`. Turn timer restarts at 30 seconds | |
| 7.23 | `/wrg status` during active game | Admin DM shows: hidden word state, current player, whose turn, wrong guesses vs budget, paused/running state | |
| 7.24 | `/wrg end` during active game | Group: `Game terminated by the admin. Thanks for playing, everyone! 👋`. All game data wiped. No match report sent | |

---

## 7F — Public Commands (any phone in the group)

| # | Type this in the group | Expected result | Pass/Fail |
|---|---|---|---|
| 7.25 | `wrg` (lowercase, no join/start/help) | Ping/info response with response time in ms | |
| 7.26 | `wrg help` | Public-facing how-to-play guide. No admin content shown | |
| 7.27 | `wrg join` (no lobby open) | `No active lobby to join! Type WRG (all caps) to start one.` | |

---

---

# SECTION 8 — MATCH REPORT VALIDATION

At the end of any game (win, last standing, or no winner), verify the match report contains:

| # | Check | Pass/Fail |
|---|---|---|
| 8.1 | Outcome header (Match Complete / Game Over) | |
| 8.2 | Winner line — or `No Winner` if no one won | |
| 8.3 | Full participant list including disqualified players | |
| 8.4 | Each disqualified player shows their reason (Skipped 3 / Used all wrong guesses) | |
| 8.5 | Creator shown as `Name (Creator)`, admin as `Name (Admin)`, others as just `Name` | |
| 8.6 | The target word is revealed | |
| 8.7 | Match stats: total players, total disqualified, winner count | |

---

---

# SECTION 9 — EDGE CASES & STABILITY

| # | Test | Expected result | Pass/Fail |
|---|---|---|---|
| 9.1 | Restart the bot mid-game | On reconnect, bot sends recovery message to the group. Active game state is preserved from `games.json` | |
| 9.2 | Restart bot mid-lobby | Lobby countdown resumes from saved state | |
| 9.3 | Restart bot while game is paused | Bot notifies the group that game is still paused and an admin must `/wrg resume` | |
| 9.4 | Public user types `WRG` when `publicCanStart` is OFF | Reply: `Game Locked — the admin hasn't enabled public game starts.` | |
| 9.5 | Admin sets difficulty but creator has an override | Next game uses creator's difficulty. Admin still gets a normal confirmation | |
| 9.6 | No words in a pool — game started on that difficulty | Bot falls back to `DEFAULT_WORDS` silently | |
| 9.7 | 30-day inactivity (simulate by checking timer logic) | Admin slot auto-cleared. Creator receives a DM notification | |
| 9.8 | Admin submits the correct key 10+ minutes after it was issued | `Session Expired.` — key rejected | |
| 9.9 | Someone submits a key 3 times with wrong values | `Session Voided.` after 3rd wrong attempt. Creator notified. Session deleted | |

---

---

# QUICK REFERENCE — COMMAND SUMMARY

| Command | Who can use it | Where reply goes |
|---|---|---|
| `/wrg admin` | Anyone (onboarding) / Creator / Admin | Sender's DM |
| `/wrg help` | Creator, Admin | Sender's DM |
| `/wrg approve [number]` | Creator only | Sender DM + requester DM |
| `/wrg deny [number]` | Creator only | Sender DM + requester DM |
| `/wrg set difficulty [easy/normal/difficult]` | Creator, Admin | Sender's DM |
| `/wrg set admin [number]` → `/wrg confirm`/`/wrg cancel` | Creator, Admin | Sender's DM |
| `/wrg set public [on/off]` | Creator, Admin | Sender's DM |
| `/wrg set start [on/off]` | Creator, Admin | Sender's DM |
| `/wrg set maxtries [n/auto]` | Creator, Admin | Sender's DM |
| `/wrg addword [level] [word]` | Creator, Admin | Sender's DM |
| `/wrg removeword [level] [word]` | Creator, Admin | Sender's DM |
| `/wrg listwords [level]` | Creator, Admin | Sender's DM |
| `/wrg setwords [level] [w1] [w2]...` | Creator, Admin | Sender's DM |
| `/wrg clearwords [level]` | Creator, Admin | Sender's DM |
| `/wrg setallwords easy:[w] normal:[w] difficult:[w]` | Creator, Admin | Sender's DM |
| `/wrg status` | Creator, Admin | Sender's DM |
| `/wrg pause` | Creator, Admin | Sender DM + group |
| `/wrg resume` | Creator, Admin | Sender DM + group |
| `/wrg end` / `/wrg stop` | Creator, Admin | Sender DM + group |
| `/wrg clearadmin` | Creator, Admin (removes themselves) | Sender's DM |
| `/wrg reset` | Creator only | Sender's DM |
| `WRG` (all caps) | Admin, Creator, or Public if `publicCanStart=ON` | Group |
| `wrg join` | Public, Admin, Creator | Group |
| `wrg start` | Lobby members, Admin, Creator | Group |
| `wrg help` | Public, Admin, Creator | Group |
| `wrg` (lowercase) | Public, Admin, Creator | Group |
