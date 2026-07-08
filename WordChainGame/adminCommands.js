// ============================================================
//  WordChainGame/adminCommands.js
//  All "/wcg ..." admin commands. The public self-claim ("/wcg
//  admin"-equivalent) lives in publicCommands.js per
//  ARCHITECTURE.md §5 — everything below this point requires at
//  least ADMIN tier, checked first, no exceptions.
//
//  NOTE: game switching (setgame / setadminaccess / status) is NOT
//  handled here — that lives entirely behind the fixed `/game`
//  prefix in the root index.js, the same for every game.
//
//  NOTE: theme SELECTION is no longer admin-settable — themes now
//  auto-rotate live during a match based on a qualification streak
//  (gameEngine.maybeRotateTheme). Admins can still curate the word
//  banks themselves (add/remove/list), just not switch which one
//  is live mid-match.
// ============================================================

const { TIERS, getTier, resolveSetting, writeSetting } = require('../permissions')
const { difficultyBadge, themeBadge, card } = require('./display')
const config = require('./config')
const gameEngine = require('./gameEngine')

async function handleAdminCommand(ctx) {
    const {
        sock, settings, words, saveSettings, saveWords, senderNumber, senderJid,
        sender, body, games, activeGameChatRef, persistGames, getGameState,
        senderTier, senderIsAdmin, buildCtx
    } = ctx

    const tier = senderTier || getTier(senderNumber, settings, senderJid)
    const senderIsCreator = tier === TIERS.CREATOR

    // ── Gate FIRST, before looking at cmd[0] at all (ARCHITECTURE.md §5) ──
    const isAdmin = typeof senderIsAdmin === 'boolean' ? senderIsAdmin : (tier === TIERS.ADMIN || senderIsCreator)
    if (!isAdmin) {
        await sock.sendMessage(sender, { text: `🔒 That command is admin-only. Type */wcg admin* to claim the role if it's unclaimed.` })
        return
    }

    // Respect admin access scoping set by the creator (creator is never scoped).
    if (!senderIsCreator) {
        const scope = settings.adminGameAccess || 'all'
        if (scope !== 'all' && scope !== config.GAME_KEY) return
    }

    const parts = body.trim().split(/\s+/)   // e.g. ['/wcg', 'pause']
    const cmd   = parts.slice(1)
    const arg1  = cmd[1] || ''
    const arg2  = cmd[2] || ''

    async function reply(text) {
        await sock.sendMessage(sender, { text })
    }

    const chatId = sender   // the chat this admin command targets — always the chat it was sent in
    const gameCtx = buildCtx ? buildCtx() : ctx

    if (cmd[0] === 'clearadmin') {
        settings.adminNumber = ''
        settings.adminJid    = ''
        saveSettings()
        return reply(`✅ Admin cleared. Anyone can now claim it with */wcg admin*.`)
    }

    // ── Match duration — the only thing an admin can tune. Dynamic
    // default (config.MATCH_DURATION_SECONDS), always clamped to sane
    // bounds, stored under a GAME_KEY-prefixed setting (ARCHITECTURE.md §4). ──
    if (cmd[0] === 'set' && arg1 === 'duration') {
        const raw = (arg2 || '').toLowerCase().replace(/[^0-9.]/g, '')
        const minutes = parseFloat(raw)
        if (!raw || !Number.isFinite(minutes) || minutes <= 0) {
            return reply(`Usage: */wcg set duration [minutes]* (e.g. */wcg set duration 5*)`)
        }
        const seconds = Math.round(minutes * 60)
        const clamped = Math.max(config.MIN_MATCH_DURATION_SECONDS, Math.min(config.MAX_MATCH_DURATION_SECONDS, seconds))
        writeSetting(tier, `${config.GAME_KEY}_matchDurationSeconds`, clamped, settings)
        saveSettings()
        const clampedNote = clamped !== seconds
            ? ` _(clamped to the allowed ${config.MIN_MATCH_DURATION_SECONDS / 60}–${config.MAX_MATCH_DURATION_SECONDS / 60} minute range)_`
            : ``
        return reply(`✅ Match duration set to *${Math.round(clamped / 60 * 10) / 10} minutes*.${clampedNote}\n_Takes effect on the next match — the current one keeps its original clock._`)
    }

    if (cmd[0] === 'set') {
        return reply(
            `Usage: */wcg set duration [minutes]*\n` +
            `_Word length/timer/strikes are fully automatic — see */wcg status*. Themes auto-rotate live during play and can't be force-switched._`
        )
    }

    // ── Theme word-bank CONTENT management — curating the banks is still
    // admin-editable; which theme is LIVE is not (gameEngine auto-rotates). ──
    if (cmd[0] === 'listthemes') {
        const names = Object.keys(words.themes || {})
        return reply(`🎨 *Theme Banks:* ${names.length ? names.join(', ') : '(none)'}\n_These auto-rotate live in-match — nothing to switch manually._`)
    }

    if (cmd[0] === 'addthemeword') {
        const theme = arg1, word = (arg2 || '').toLowerCase()
        if (!theme || !word) return reply(`Usage: */wcg addthemeword [theme] [word]*`)
        if (!words.themes) words.themes = {}
        if (!words.themes[theme]) words.themes[theme] = []
        if (words.themes[theme].includes(word)) return reply(`⚠️ *${word}* is already in "${theme}".`)
        words.themes[theme].push(word)
        saveWords()
        return reply(`✅ *${word}* added to theme "${theme}".`)
    }

    if (cmd[0] === 'removethemeword') {
        const theme = arg1, word = (arg2 || '').toLowerCase()
        if (!theme || !word || !words.themes || !words.themes[theme]) return reply(`Usage: */wcg removethemeword [theme] [word]*`)
        const idx = words.themes[theme].indexOf(word)
        if (idx === -1) return reply(`⚠️ *${word}* isn't in "${theme}".`)
        words.themes[theme].splice(idx, 1)
        saveWords()
        return reply(`🗑️ *${word}* removed from theme "${theme}".`)
    }

    if (cmd[0] === 'listthemewords') {
        const theme = arg1
        if (!theme || !words.themes || !words.themes[theme]) return reply(`Usage: */wcg listthemewords [theme]*`)
        return reply(`📖 *${theme}:* ${words.themes[theme].join(', ') || '[empty]'}`)
    }

    // ── Pause / resume — resume now preserves remaining turn time.
    // The match-duration clock freezes together with the turn timer. ──
    if (cmd[0] === 'pause') {
        const gs = getGameState(chatId, games)
        if (!gs.active) return reply(`⚠️ No active round to pause.`)
        gs.paused = true
        const timers = gameEngine.getTimers(chatId)
        if (timers.turnTimer) clearInterval(timers.turnTimer)
        persistGames()
        return reply(`⏸️ *Word Chain paused* by an admin. ${gs.turnSecondsLeft}s were left on the turn clock, ${Math.floor((gs.matchSecondsLeft||0)/60)}:${String((gs.matchSecondsLeft||0)%60).padStart(2,'0')} left on the match clock — both resume from here, not reset.`)
    }

    if (cmd[0] === 'resume') {
        const gs = getGameState(chatId, games)
        if (!gs.active || !gs.paused) return reply(`⚠️ Nothing is paused right now.`)
        gs.paused = false
        persistGames()
        await reply(`▶️ *Word Chain resumed!* ${gs.turnSecondsLeft}s left on this turn.`)
        gameEngine.startTurnCountdown(chatId, gameCtx, { preserveRemaining: true })
        return
    }

    // ── end/stop — always guards activeGameChatRef, always sends a report.
    // Unlike a natural or timed ending, an admin-forced stop never
    // auto-restarts a fresh lobby — that's the admin's call to make. ──
    if (cmd[0] === 'end' || cmd[0] === 'stop') {
        const gs = getGameState(chatId, games)
        if (!gs.active && !gs.lobbyActive) return reply(`⚠️ No active game or lobby in this chat.`)

        const wasActive = gs.active
        gs.active = false
        gs.lobbyActive = false
        gameEngine.clearAllTimers(chatId)

        // Only release the global lock if IT WAS THIS CHAT holding it — an
        // admin stopping Chat A's game must never sever Chat B's live lock.
        if (activeGameChatRef.value === chatId) activeGameChatRef.value = null

        persistGames()

        if (wasActive) {
            await gameEngine.endMatch(chatId, gs, gameCtx, { type: 'admin_stop' }, { autoRestart: false })
        } else {
            await reply(`🛑 *Lobby cancelled* by an admin.`)
        }
        return
    }

    if (cmd[0] === 'status') {
        const gs = getGameState(chatId, games)
        const cfg = gameEngine.roundConfigForTier(gs.tier)
        const durationSeconds = gameEngine.matchDurationSecondsFor(settings)
        const themeLine = gs.active ? (themeBadge(gs.roundTheme) || '🎨 *Theme: none yet* (unlocks after a no-strike streak)') : '—'
        return reply(
            `📊 *Word Chain Status*\n\n` +
            `Auto-difficulty: ${difficultyBadge(cfg.tierName)} _(tier ${cfg.tierIndex}/${config.MAX_TIER}, drifts after each match)_\n` +
            `Starting word length: ${cfg.minLength}+ | Starting timer: ${cfg.timerSeconds}s | Strikes: ${cfg.maxStrikes}\n` +
            `_Word length/timer climb further LIVE as any single chain grows — see PROGRESSION_STEPS in config.js._\n` +
            `Match duration: ${Math.round(durationSeconds / 60 * 10) / 10} min _(admin-settable, */wcg set duration*)_\n` +
            `Live theme this round: ${themeLine}\n` +
            `Admin: ${settings.adminNumber || '(unclaimed)'}\n` +
            `Active round in this chat: ${gs.active ? 'Yes' : 'No'}${gs.paused ? ' (paused)' : ''}\n` +
            `Lobby open in this chat: ${gs.lobbyActive ? 'Yes' : 'No'}`
        )
    }

    return reply(card('Word Chain Admin Commands',
        `*/wcg set duration [minutes]* — match length (default 5 min)\n` +
        `*/wcg listthemes* · */wcg listthemewords [theme]*\n` +
        `*/wcg addthemeword [theme] [word]* · */wcg removethemeword [theme] [word]*\n` +
        `*/wcg pause* / */wcg resume* / */wcg end*\n` +
        `*/wcg status*\n` +
        `*/wcg clearadmin*\n\n` +
        `_Word length & timer are fully automatic — they drift match-to-match AND climb live within a match. ` +
        `Themes auto-rotate live too, based on a no-strike streak. Neither is admin-settable._\n` +
        `_Switching games or scoping admin access is done via the platform-level_ */game* _command, not here._`
    ))
}

module.exports = { handleAdminCommand }
