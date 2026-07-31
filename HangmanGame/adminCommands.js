// ============================================================
//  HangmanGame/adminCommands.js — HMG Bot · Sky Graphics
//  Handles ALL "/hmg" commands with full security hardening.
//
//  Access tiers:
//    CREATOR  — CREATOR_JID in .env. Unrestricted. Always works.
//    ADMIN    — set via /admin key onboarding. Full command access.
//    EVERYONE ELSE — total silence on all "/" commands.
//
//  /hmg help   — admin/creator dashboard, DM only, silent to all others
//  Admin identity onboarding (/admin, /admin approve, /admin deny) is
//  NOT handled here anymore — see admin-onboarding.js at the project
//  root. It's a fixed, game-independent prefix, same as "/game ...".
//  Game switching (/game setgame, /game setadminaccess) is NOT handled
//  in this file either — also a fixed, game-independent prefix.
// ============================================================

const { TIERS, writeSetting, resolveSetting, nameTag } = require('../permissions')
const { startActualGame, openFreshLobby } = require('./gameEngine')
const config = require('./config')


function formatMaxTries(value) {
    if (value === 'auto' || value === undefined || value === null) return 'AUTO 🤖'
    return String(value)
}

// ─── Help dashboard ───────────────────────────────────────────
function buildHelpText(settings, forCreator = false, section = null) {
    const tier = forCreator
        ? `👑 *CREATOR — Unrestricted Access*`
        : `🛡️ *Administrator*`

    const header =
        `${config.DIVIDER}\n` +
        `${config.BOT_EMOJI} *${config.GAME_ACRONYM} Admin Dashboard*\n` +
        `${config.DIVIDER}\n` +
        `${tier}\n` +
        `_Sky Graphics — ${config.GAME_NAME}_\n\n`

    const footer =
        `${config.DIVIDER}\n` +
        `_${config.GAME_ACRONYM} Bot · Sky Graphics_ 🎨`

    const liveConfig =
        `*📊 Live Config:*\n` +
        `› Word Length: *adaptive (currently drifting per chat)*\n` +
        `› Max Tries: *${formatMaxTries(resolveSetting('maxTries', settings, 'auto'))}*\n` +
        `› Public Visible: *${resolveSetting('publicVisible', settings, true) ? '🟢 ON' : '🔴 OFF'}*\n` +
        `› Public Can Start: *${resolveSetting('publicCanStart', settings, false) ? '🟢 ON' : '🔴 OFF'}*\n` +
        `› Auto-Join Lobby: *${resolveSetting('autoJoin', settings, true) ? '🟢 ON' : '🔴 OFF'}*\n` +
        `› Admin Set: *${settings.adminNumber ? '✅ ' + settings.adminNumber : '❌ None'}*\n\n`

    if (section === null || section === undefined) {
        return (
            header +
            `All commands work from *any chat*.\n` +
            `Every reply comes to *your DM only*.\n\n` +
            `Type */hmg help [number]* to expand a category:\n\n` +
            `*1️⃣  Settings* — visibility, admin slot, max tries\n` +
            `*2️⃣  Word Pool* — add, remove, list, replace, clear words\n` +
            `*3️⃣  Game Controls* — status, pause, resume, end, force start\n` +
            (forCreator ? `*🔐  Creator-Only* — approve/deny access keys, switch games\n` : ``) +
            `\n` +
            liveConfig +
            footer
        )
    }

    if (section === 1) {
        return (
            header +
            `*1️⃣  Settings Commands*\n\n` +
            `› \`/hmg set admin [number]\`\n` +
            `  then → \`/hmg confirm\` or \`/hmg cancel\`\n` +
            `› \`/hmg set public [on/off]\` — non-admin visibility\n` +
            `› \`/hmg set start [on/off]\` — public lobby start\n` +
            `› \`/hmg set autojoin [on/off]\` — auto-join lobbies\n` +
            `› \`/hmg set maxtries [n / auto]\` — attempt budget\n` +
            `› \`/hmg clearadmin\` — clear admin slot, keep pools\n` +
            (forCreator ? `› \`/hmg reset\` — ⚠️ wipe ALL data\n` : ``) +
            `\n` +
            `_Note: there's no manual difficulty setting anymore — word length adapts automatically based on how the group performs each round._\n\n` +
            liveConfig +
            footer
        )
    }

    if (section === 2) {
        return (
            header +
            `*2️⃣  Word Pool Commands*\n\n` +
            `› \`/hmg addword [word]\`\n` +
            `› \`/hmg removeword [word]\`\n` +
            `› \`/hmg listwords\`\n` +
            `› \`/hmg setwords w1 w2 ...\` — replace the whole pool\n` +
            `› \`/hmg clearwords\` — cannot empty the pool entirely\n\n` +
            `_One flat pool now, spanning ${config.MIN_WORD_LENGTH}–${config.MAX_WORD_LENGTH} letters — the game itself picks the right length each round._\n\n` +
            footer
        )
    }

    if (section === 3) {
        return (
            header +
            `*3️⃣  Game Control Commands*\n\n` +
            `› \`/hmg status\` — live game state in your DM\n` +
            `› \`/hmg start\` — force lobby to start immediately\n` +
            `› \`/hmg pause\` — freeze the turn timer\n` +
            `› \`/hmg resume\` — unfreeze the turn timer\n` +
            `› \`/hmg end\` · \`/hmg stop\` — terminate active game\n` +
            (forCreator
                ? `\n*🔐  Creator-Only:*\n` +
                  `› \`/admin approve [number]\` — send access key to requester\n` +
                  `› \`/admin deny [number]\` — void their key immediately\n` +
                  `› \`/game setgame [key]\` — switch the active game (fixed prefix, works from any game)\n` +
                  `› \`/game setadminaccess [key|all]\` — scope the admin to one game\n`
                : ``) +
            `\n` +
            footer
        )
    }

    return (
        `⚠️ *Invalid option.*\n\n` +
        `Use */hmg help [number]* to expand a section:\n\n` +
        `*1️⃣  Settings*\n` +
        `*2️⃣  Word Pool*\n` +
        `*3️⃣  Game Controls*\n\n` +
        `Example: \`/hmg help 2\``
    )
}

// ─── Main handler ─────────────────────────────────────────────
async function handleAdminCommand(ctx) {
    const {
        sock, settings, words, games, activeGameChatRef,
        saveSettings, saveWords, persistGames,
        sendSafeMessage, getGameState, startTurnCountdown,
        fs, nameCache,
        senderNumber, senderJid, senderName, body, senderTier,
        sender
    } = ctx

    const requesterJid = senderNumber ? `${senderNumber}@s.whatsapp.net` : senderJid

    const creatorJid    = process.env.CREATOR_JID || ''
    const creatorNumber = creatorJid.split('@')[0].split(':')[0]

    const senderIsCreator = senderTier === TIERS.CREATOR
    const isAdmin          = senderTier === TIERS.CREATOR || senderTier === TIERS.ADMIN
    const tier              = senderTier || TIERS.PUBLIC

    // Strip "/" and shift past "hmg" so cmd[0] = command, cmd[1]+ = args
    const raw   = body.slice(1).trim()
    const parts = raw.split(' ')
    const cmd   = parts.slice(1)

    // Admin-inactivity tracking now lives entirely in admin-onboarding.js
    // (started at boot via ensureInactivityTimerRunning, and restarted on
    // every successful /admin key redemption) — nothing to do here.

    // Note: switching games / scoping admin access is NOT handled here.
    // It lives entirely under the fixed "/game" prefix in index.js, so
    // it works no matter which game is currently active — see
    // game-switch-commands.js.

    // ══════════════════════════════════════════════
    //  /admin — redirect only
    //  Admin identity onboarding (key request → creator approves →
    //  key sent) now lives in the shared, game-agnostic /admin-onboarding.js
    //  module under the fixed "/admin ..." prefix (see index.js) — the
    //  exact same reasoning as why "/game ..." is fixed and game-agnostic.
    //  It used to live here, only reachable while Hangman was the active
    //  game, which silently broke onboarding on any other active game.
    // ══════════════════════════════════════════════
    if (cmd[0] === 'admin' || cmd[0] === 'approve' || cmd[0] === 'deny') {
        await sendSafeMessage(sock, senderJid, {
            text:
                `ℹ️ Admin onboarding moved to a fixed, game-independent command.\n\n` +
                `Use *\`/admin\`* instead of *\`${config.ADMIN_PREFIX.trim()} ${cmd[0]}\`* — it works the same way, ` +
                `no matter which game is currently active.`
        })
        return
    }


    // ══════════════════════════════════════════════
    //  /hmg help — admin + creator only, DM only
    //  Bare "/hmg" (no subcommand) is an alias for "/hmg help" — same
    //  reasoning as bare "/admin" and bare "/game" being valid entry
    //  points rather than dead ends.
    // ══════════════════════════════════════════════
    if (cmd[0] === 'help' || cmd[0] === undefined || cmd[0] === '') {
        const rawSection = cmd[1]
        const section = rawSection === undefined ? null : parseInt(rawSection, 10)
        if (senderIsCreator) {
            await sendSafeMessage(sock, senderJid, { text: buildHelpText(settings, true, section) })
            return
        }
        if (isAdmin) {
            await sendSafeMessage(sock, senderJid, { text: buildHelpText(settings, false, section) })
            return
        }
        return
    }

    // ══════════════════════════════════════════════
    //  Everything below: creator OR confirmed admin only
    // ══════════════════════════════════════════════
    if (!senderIsCreator && !isAdmin) return

    // ── Admin access scoping: a non-creator admin who has been scoped
    // to a different game via /game setadminaccess is silently ignored
    // on Hangman commands. The creator always bypasses this.
    if (!senderIsCreator) {
        const scope = settings.adminGameAccess || 'all'
        if (scope !== 'all' && scope !== config.GAME_KEY) return
    }

    const replyTo = senderJid

    // ─── /hmg set admin / confirm / cancel — redirect only ──
    // Manual admin override (bypassing the key-exchange dance) now
    // lives at the universal "/admin set [number] [gamekey|all]" +
    // "/admin confirm" / "/admin cancel" — see admin-onboarding.js.
    // It used to be reachable only via "/hmg", which meant "who's
    // admin, and for which game(s)" was set from inside one specific
    // game's command file instead of the bot-identity layer.
    if ((cmd[0] === 'set' && cmd[1] === 'admin') || cmd[0] === 'confirm' || cmd[0] === 'cancel') {
        await sendSafeMessage(sock, replyTo, {
            text:
                `ℹ️ Manual admin assignment moved to a fixed, game-independent command.\n\n` +
                `Use *\`/admin set [number] [gamekey|all]\`* → *\`/admin confirm\`* instead of *\`/hmg set admin\`* / *\`/hmg confirm\`*.`
        })
        return
    }

    // ─── /hmg set maxtries ───────────────────────
    if (cmd[0] === 'set' && cmd[1] === 'maxtries') {
        const arg = (cmd[2] || '').toLowerCase()
        if (arg === 'auto') {
            writeSetting(tier, 'maxTries', 'auto', settings)
            saveSettings()
            await sendSafeMessage(sock, replyTo, {
                text: `⚙️ Max attempts: *AUTO* 🤖\nAttempts now scale with word length each round.`
            })
        } else {
            const n = parseInt(arg, 10)
            if (Number.isInteger(n) && n > 0) {
                writeSetting(tier, 'maxTries', n, settings)
                saveSettings()
                await sendSafeMessage(sock, replyTo, { text: `⚙️ Max attempts per round: *${n}* 💥 (manual override)` })
            } else {
                await sendSafeMessage(sock, replyTo, { text: `⚠️ Usage: \`/hmg set maxtries [positive number]\` or \`/hmg set maxtries auto\`` })
            }
        }
        return
    }

    // ─── /hmg set public ─────────────────────────
    if (cmd[0] === 'set' && cmd[1] === 'public') {
        const mode = cmd[2]
        if (mode === 'on' || mode === 'off') {
            const newValue = (mode === 'on')
            writeSetting(tier, 'publicVisible', newValue, settings)
            saveSettings()
            await sendSafeMessage(sock, replyTo, {
                text: newValue
                    ? `🔓 *Public Visibility: ON*\nNon-admins can interact with the bot. 👥`
                    : `🔒 *Public Visibility: OFF*\nNon-admins are completely silenced. 🤐`
            })
        } else {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Usage: \`/hmg set public [on/off]\`` })
        }
        return
    }

    // ─── /hmg set start ──────────────────────────
    if (cmd[0] === 'set' && cmd[1] === 'start') {
        const mode = cmd[2]
        if (mode === 'on' || mode === 'off') {
            const newValue = (mode === 'on')
            writeSetting(tier, 'publicCanStart', newValue, settings)
            saveSettings()
            await sendSafeMessage(sock, replyTo, {
                text: newValue
                    ? `🔓 *Public Game Starts: ON*\nAnyone can type *${config.PREFIX} start* to open a lobby. 🎮`
                    : `🔒 *Public Game Starts: OFF*\nOnly admin can open a lobby. 👑`
            })
        } else {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Usage: \`/hmg set start [on/off]\`` })
        }
        return
    }

    // ─── /hmg set autojoin ────────────────────────
    if (cmd[0] === 'set' && cmd[1] === 'autojoin') {
        const mode = cmd[2]
        if (mode === 'on' || mode === 'off') {
            const newValue = (mode === 'on')
            writeSetting(tier, 'autoJoin', newValue, settings)
            saveSettings()
            const roleLabel = senderIsCreator ? 'Creator' : 'Admin'
            await sendSafeMessage(sock, replyTo, {
                text: newValue
                    ? `🟢 *Auto-Join: ON*\nYou (${roleLabel}) will automatically join every lobby when it opens. 🎮`
                    : `🔴 *Auto-Join: OFF*\nYou (${roleLabel}) must type *${config.PREFIX} join* to enter lobbies manually. 👋`
            })
        } else {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Usage: \`/hmg set autojoin [on/off]\`` })
        }
        return
    }

    // ─── Word pool commands (flat pool, no levels) ────────
    if (cmd[0] === 'addword') {
        const word = cmd[1]
        if (word) {
            const tw = word.trim().toLowerCase()
            if (words.includes(tw)) {
                await sendSafeMessage(sock, replyTo, { text: `⚠️ *${tw.toUpperCase()}* is already in the pool.` })
            } else if (!/^[a-z]{2,}$/.test(tw)) {
                await sendSafeMessage(sock, replyTo, { text: `⚠️ Words must be letters only, at least 2 characters.` })
            } else {
                words.push(tw)
                saveWords()
                await sendSafeMessage(sock, replyTo, { text: `✅ *${tw.toUpperCase()}* added to the pool (${tw.length} letters). 📚` })
            }
        } else {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Usage: \`/hmg addword [word]\`` })
        }
        return
    }

    if (cmd[0] === 'removeword') {
        const word = cmd[1]
        if (word) {
            const tw    = word.trim().toLowerCase()
            const index = words.indexOf(tw)
            if (index !== -1) {
                if (words.length <= 1) {
                    await sendSafeMessage(sock, replyTo, { text: `⚠️ Cannot remove the last word — the pool would be empty.` })
                    return
                }
                words.splice(index, 1)
                saveWords()
                await sendSafeMessage(sock, replyTo, { text: `🗑️ *${tw.toUpperCase()}* removed from the pool.` })
            } else {
                await sendSafeMessage(sock, replyTo, { text: `⚠️ *${tw.toUpperCase()}* not found in the pool.` })
            }
        } else {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Usage: \`/hmg removeword [word]\`` })
        }
        return
    }

    if (cmd[0] === 'listwords') {
        const list = words.slice().sort((a, b) => a.length - b.length).join(', ')
        await sendSafeMessage(sock, replyTo, {
            text: `📖 *Word Pool (${words.length}):*\n\n${list || '[Empty — use /hmg addword to add words]'}`
        })
        return
    }

    if (cmd[0] === 'setwords') {
        const newWords = cmd.slice(1).map(w => w.trim().toLowerCase()).filter(Boolean)
        if (newWords.length > 0) {
            if (newWords.length > 60) {
                await sendSafeMessage(sock, replyTo, { text: `⚠️ Maximum 60 words in the pool. You provided ${newWords.length}.` })
            } else {
                const unique = [...new Set(newWords)]
                words.length = 0
                words.push(...unique)
                saveWords()
                await sendSafeMessage(sock, replyTo, { text: `✅ Pool replaced with ${words.length} word(s). 📚` })
            }
        } else {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Usage: \`/hmg setwords word1 word2 ...\`` })
        }
        return
    }

    if (cmd[0] === 'clearwords') {
        await sendSafeMessage(sock, replyTo, {
            text: `⚠️ Word pool can't be fully cleared — it would crash the game. Use \`/hmg setwords\` to replace it instead.`
        })
        return
    }

    // ─── /hmg clearadmin ─────────────────────────
    // NOTE: this now only resets HANGMAN'S OWN admin-layer settings
    // (max tries, public access, etc). Clearing the admin IDENTITY
    // itself (settings.adminNumber/adminJid) moved to the universal
    // "/admin clear" — same reasoning as "/admin set": who the admin
    // is isn't Hangman's to decide, so it shouldn't be Hangman's to
    // un-decide either.
    if (cmd[0] === 'clearadmin') {
        settings.maxTries       = 'auto'
        settings.publicVisible  = true
        settings.publicCanStart = false
        settings.autoJoin       = true
        saveSettings()
        await sendSafeMessage(sock, replyTo, {
            text:
                `✅ *Hangman's admin-layer settings reset to defaults* (max tries, public access, auto-join).\n\n` +
                `This did *not* remove the admin identity — use */admin clear* for that.`
        })
        return
    }

    // ─── /hmg reset ──────────────────────────────
    if (cmd[0] === 'reset') {
        const keepAdminNumber = settings.adminNumber
        const keepAdminJid    = settings.adminJid
        Object.assign(settings, {
            maxTries: 'auto',
            publicVisible: true, publicCanStart: false
        })
        delete settings.creatorOverrides
        settings.adminNumber = keepAdminNumber
        settings.adminJid    = keepAdminJid
        saveSettings()

        const { DEFAULT_WORDS } = require('./gameEngine')
        words.length = 0
        words.push(...DEFAULT_WORDS)
        saveWords()

        // Scope to THIS game's own keys only — the `games` object is shared
        // across every game module, so wiping every key here would silently
        // nuke other games' active sessions too.
        for (const key in games) {
            if (!key.startsWith(`${config.GAME_KEY}:`)) continue
            const g = games[key]
            if (g.lobbyTimer)    clearInterval(g.lobbyTimer)
            if (g.turnTimer)     clearInterval(g.turnTimer)
            if (g.cooldownTimer) clearInterval(g.cooldownTimer)
            delete games[key]
        }
        persistGames()
        if (activeGameChatRef.value) activeGameChatRef.value = null
        await sendSafeMessage(sock, replyTo, {
            text:
                `🔄 *Reset Complete* ✅\n\n` +
                `Settings, creator overrides, and the word pool were restored to defaults. Any active game was ended.\n\n` +
                (keepAdminNumber
                    ? `👑 Admin (\`${keepAdminNumber}\`) keeps their access — use */hmg clearadmin* if you want to remove them too.`
                    : `The bot has no admin set — the next */admin* request will begin onboarding.`)
        })
        return
    }

    // ─── /hmg status ─────────────────────────────
    if (cmd[0] === 'status') {
        const activeGameChat = activeGameChatRef.value
        if (!activeGameChat) {
            await sendSafeMessage(sock, replyTo, {
                text:
                    `📊 *${config.GAME_ACRONYM} Bot Status*\n\n` +
                    `🎮 No game or lobby is currently active.\n\n` +
                    `*Config:*\n` +
                    `› Max Tries: *${formatMaxTries(resolveSetting('maxTries', settings, 'auto'))}*\n` +
                    `› Public Visible: *${resolveSetting('publicVisible', settings, true) ? '🟢 ON' : '🔴 OFF'}*\n` +
                    `› Public Can Start: *${resolveSetting('publicCanStart', settings, false) ? '🟢 ON' : '🔴 OFF'}*\n` +
                    `› Auto-Join Lobby: *${resolveSetting('autoJoin', settings, true) ? '🟢 ON' : '🔴 OFF'}*\n` +
                    `› Admin: *${settings.adminNumber || 'None'}*`
            })
        } else {
            const gs = getGameState(activeGameChat, games)
            let statusText = `📊 *${config.GAME_ACRONYM} Bot Status*\n\n`

            if (gs.cooldownActive) {
                statusText += `☕ *COOLDOWN* — ${activeGameChat}\n`
                statusText += `⏱️ Next lobby opens in: *${gs.cooldownSecondsLeft}s*\n`
                statusText += `📏 Next word length: *~${gs.wordLengthTarget} letters*\n`
            } else if (gs.lobbyActive) {
                statusText += `🏠 *LOBBY OPEN* — ${activeGameChat}\n`
                statusText += `👥 Players joined: *${gs.players.length}*\n`
                statusText += `⏱️ Time left: *${gs.lobbySecondsLeft}s*\n`
                if (gs.players.length > 0) {
                    statusText += `\n*Players:*\n`
                    gs.players.forEach((num, i) => { statusText += `${i + 1}. ${gs.playerNames[num] || num}\n` })
                }
            } else if (gs.active) {
                const currentPlayer = gs.players[gs.currentTurnIndex]
                statusText += `🎮 *GAME IN PROGRESS* — ${activeGameChat}\n`
                statusText += gs.paused ? `⏸️ Status: *PAUSED*\n` : `▶️ Status: *LIVE*\n`
                statusText += `📝 Word: \`${gs.hiddenWord.join(' ')}\` (${gs.targetWord.length} letters)\n`
                const attemptsUsed = Object.values(gs.attempts || {}).reduce((a, b) => a + b, 0)
                const roundMaxTries = gs.roundMaxTries || resolveSetting('maxTries', settings, 'auto')
                statusText += `💥 Wrong guesses so far: *${attemptsUsed}* total (max ${formatMaxTries(roundMaxTries)}/player)\n`
                statusText += `🎯 Current turn: *${gs.playerNames[currentPlayer] || currentPlayer}*\n`
                statusText += `👥 Players: *${gs.players.length}*\n`
                if (!gs.paused) statusText += `⏱️ Turn timer: *${gs.turnSecondsLeft}s*\n`
            }

            statusText += `\n*Config:*\n`
            statusText += `› Max Tries: *${formatMaxTries(resolveSetting('maxTries', settings, 'auto'))}*`

            await sendSafeMessage(sock, replyTo, { text: statusText })
        }
        return
    }

    // ─── Game control commands ────────────────────
    const activeGameChat = activeGameChatRef.value

    if (cmd[0] === 'start') {
        if (!activeGameChat) {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ No active lobby to force-start. Open one with *${config.PREFIX} start* in the group first.` })
        } else {
            const gs = getGameState(activeGameChat, games)
            if (gs.lobbyActive) {
                if (gs.lobbyTimer) clearInterval(gs.lobbyTimer)
                await sock.sendMessage(activeGameChat, {
                    text: `⚡ *Game starting early!*\n\nThe admin has force-started the game. Lobby is now closed — let's go! 🎮`
                })
                await sendSafeMessage(sock, replyTo, { text: `▶️ *Force-start sent.* Game is launching now in the group. ⚡` })
                await startActualGame(activeGameChat, {
                    sock, games, settings, words, activeGameChatRef, persistGames, nameCache
                })
            } else if (gs.active) {
                await sendSafeMessage(sock, replyTo, { text: `⚠️ The game is already in progress — use */hmg end* to stop it first.` })
            } else if (gs.cooldownActive) {
                // BUG FIX: force-start used to fall through to "No active lobby
                // found" during the 2-minute post-round cooldown, with no way to
                // skip the wait. Now it breaks the cooldown and opens a fresh
                // lobby immediately.
                if (gs.cooldownTimer) clearInterval(gs.cooldownTimer)
                gs.cooldownActive = false
                persistGames()
                await sendSafeMessage(sock, replyTo, { text: `⚡ *Cooldown skipped.* Opening a fresh lobby now. 🎮` })
                await openFreshLobby(activeGameChat, {
                    sock, games, settings, nameCache, activeGameChatRef, persistGames
                })
            } else {
                await sendSafeMessage(sock, replyTo, { text: `⚠️ No active lobby found. Open one with *${config.PREFIX} start* in the group.` })
            }
        }
        return
    }

    if (cmd[0] === 'pause') {
        if (!activeGameChat) {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ No active game to pause right now.` })
        } else {
            const gs = getGameState(activeGameChat, games)
            if (gs.active && !gs.paused) {
                gs.paused = true
                persistGames()
                await sendSafeMessage(sock, replyTo, { text: `⏸️ *Game paused.* ✅` })
                await sock.sendMessage(activeGameChat, { text: `⏸️ *Game paused by the admin.* Sit tight — we'll be right back! ☕` })
            } else {
                await sendSafeMessage(sock, replyTo, { text: `⚠️ Game is already paused or no round is in progress.` })
            }
        }
        return
    }

    if (cmd[0] === 'resume') {
        if (!activeGameChat) {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ No active game to resume right now.` })
        } else {
            const gs = getGameState(activeGameChat, games)
            if (gs.active && gs.paused) {
                gs.paused = false
                persistGames()
                await sendSafeMessage(sock, replyTo, { text: `▶️ *Game resumed!* ✅` })
                await sock.sendMessage(activeGameChat, { text: `▶️ *Game resumed by the admin!* Back in action — keep guessing! 🔥` })
                startTurnCountdown(activeGameChat, { sock, games, settings, activeGameChatRef, persistGames, nameCache: ctx.nameCache })
            } else {
                await sendSafeMessage(sock, replyTo, { text: `⚠️ Game is not currently paused.` })
            }
        }
        return
    }

    if (cmd[0] === 'end' || cmd[0] === 'stop') {
        if (!activeGameChat) {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ No active game or lobby to end right now.` })
        } else {
            const gs        = getGameState(activeGameChat, games)
            const endedChat = activeGameChat
            gs.active = false
            gs.lobbyActive = false
            gs.cooldownActive = false
            if (gs.lobbyTimer)    clearInterval(gs.lobbyTimer)
            if (gs.turnTimer)     clearInterval(gs.turnTimer)
            if (gs.cooldownTimer) clearInterval(gs.cooldownTimer)
            gs.players = []
            gs.playerNames = {}
            gs.playerJids = {}
            gs.skipStreaks = {}
            gs.attempts = {}
            gs.disqualified = []
            activeGameChatRef.value = null
            persistGames()
            await sendSafeMessage(sock, replyTo, { text: `🛑 *Game terminated.* ✅` })
            await sock.sendMessage(endedChat, { text: `🛑 *Game terminated by the admin.* Thanks for playing, everyone! 👋` })
        }
        return
    }

    // Unknown command — absolute silence
}

module.exports = { handleAdminCommand }
