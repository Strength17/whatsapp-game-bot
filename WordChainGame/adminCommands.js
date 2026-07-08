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
// ============================================================

const { TIERS, getTier, resolveSetting, writeSetting } = require('../permissions')
const { difficultyBadge, themeBadge } = require('./display')
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

    // ── Theme word-bank management (unchanged — themes stay admin-editable) ──
    if (cmd[0] === 'set' && arg1 === 'theme') {
        const themeKey = (arg2 || '').toLowerCase()
        if (themeKey === 'none') {
            words.activeTheme = 'none'
            saveWords()
            return reply(`✅ Theme cleared — standard dictionary words only.`)
        }
        if (!words.themes || !words.themes[themeKey]) {
            const available = Object.keys(words.themes || {}).join(', ') || '(none yet)'
            return reply(`⚠️ No theme called "${themeKey}". Available: ${available}, or *none*.`)
        }
        words.activeTheme = themeKey
        saveWords()
        return reply(`✅ Theme set to ${themeBadge(themeKey)}.\nThemed words are ACCEPTED alongside regular dictionary words — the dictionary is never replaced, so chains won't dead-end.`)
    }
    if (cmd[0] === 'set') {
        return reply(`Usage: */wcg set theme <name|none>*\n_Difficulty (length/timer/strikes) is now fully automatic — see */wcg status*._`)
    }

    if (cmd[0] === 'listthemes') {
        const names = Object.keys(words.themes || {})
        return reply(`🎨 *Available Themes:* ${names.length ? names.join(', ') : '(none)'}\nActive: *${words.activeTheme || 'none'}*`)
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

    // ── Pause / resume — resume now preserves remaining turn time ──
    if (cmd[0] === 'pause') {
        const gs = getGameState(chatId, games)
        if (!gs.active) return reply(`⚠️ No active round to pause.`)
        gs.paused = true
        if (gs.turnTimer) clearInterval(gs.turnTimer)
        persistGames()
        return reply(`⏸️ *Word Chain paused* by an admin. ${gs.turnSecondsLeft}s were left on the clock — resuming will pick up from there, not reset.`)
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

    // ── end/stop — always guards activeGameChatRef, always sends a report ──
    if (cmd[0] === 'end' || cmd[0] === 'stop') {
        const gs = getGameState(chatId, games)
        if (!gs.active && !gs.lobbyActive) return reply(`⚠️ No active game or lobby in this chat.`)

        const wasActive = gs.active
        gs.active = false
        gs.lobbyActive = false
        if (gs.turnTimer)  clearInterval(gs.turnTimer)
        if (gs.lobbyTimer) clearInterval(gs.lobbyTimer)

        // Only release the global lock if IT WAS THIS CHAT holding it — an
        // admin stopping Chat A's game must never sever Chat B's live lock.
        if (activeGameChatRef.value === chatId) activeGameChatRef.value = null

        persistGames()

        if (wasActive) {
            await gameEngine.endMatch(chatId, gs, gameCtx, { type: 'admin_stop' })
        } else {
            await reply(`🛑 *Lobby cancelled* by an admin.`)
        }
        return
    }

    if (cmd[0] === 'status') {
        const gs = getGameState(chatId, games)
        const cfg = gameEngine.roundConfigForTier(gs.tier)
        return reply(
            `📊 *Word Chain Status*\n\n` +
            `Auto-difficulty: ${difficultyBadge(cfg.tierName)} _(tier ${cfg.tierIndex}/${config.MAX_TIER}, auto-adjusts after each match)_\n` +
            `Word length: ${cfg.minLength}+ | Timer: ${cfg.timerSeconds}s | Strikes: ${cfg.maxStrikes}\n` +
            `Active theme: ${words.activeTheme || 'none'}\n` +
            `Admin: ${settings.adminNumber || '(unclaimed)'}\n` +
            `Active round in this chat: ${gs.active ? 'Yes' : 'No'}${gs.paused ? ' (paused)' : ''}\n` +
            `Lobby open in this chat: ${gs.lobbyActive ? 'Yes' : 'No'}`
        )
    }

    return reply(
        `🔧 *Word Chain Admin Commands*\n\n` +
        `*/wcg set theme <name|none>*\n` +
        `*/wcg listthemes* · */wcg listthemewords [theme]*\n` +
        `*/wcg addthemeword [theme] [word]* · */wcg removethemeword [theme] [word]*\n` +
        `*/wcg pause* / */wcg resume* / */wcg end*\n` +
        `*/wcg status*\n` +
        `*/wcg clearadmin*\n\n` +
        `_Difficulty is fully automatic now — no set difficulty|strikes|timer. It drifts after each match based on how the group did._\n` +
        `_Switching games or scoping admin access is done via the platform-level_ */game* _command, not here._`
    )
}

module.exports = { handleAdminCommand }
