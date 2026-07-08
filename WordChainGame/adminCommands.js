// ============================================================
//  WordChainGame/adminCommands.js
//  All "/wcg ..." admin commands. Kept lean — first person to
//  claim admin gets it, creator can always reclaim/reset it.
//  Difficulty is fully automatic now (see gameEngine.js
//  applyAdaptiveDrift) — there is deliberately no manual
//  difficulty/timer/strikes override anymore.
//
//  NOTE: game switching (setgame / setadminaccess / status) is NOT
//  handled here. Per the project architecture, that lives entirely
//  behind the fixed `/game` prefix in the root index.js — no
//  individual game's adminCommands.js wires it in.
// ============================================================

const { TIERS, getTier, resolveSetting, writeSetting } = require('../permissions')
const { difficultyBadge, themeBadge } = require('./display')
const config = require('./config')
const { getGameState, tierConfigFor, endMatch, startTurnCountdown, safeClearActiveRef } = require('./gameEngine')

async function handleAdminCommand(ctx) {
    const {
        sock, settings, words, saveSettings, saveWords, senderNumber, senderJid, senderName,
        sender, body, games, activeGameChatRef, persistGames,
        senderTier, senderIsAdmin
    } = ctx

    const tier = senderTier || getTier(senderNumber, settings, senderJid)
    const senderIsCreator = tier === TIERS.CREATOR
    const isAdmin = typeof senderIsAdmin === 'boolean' ? senderIsAdmin : (tier === TIERS.ADMIN || tier === TIERS.CREATOR)

    const parts = body.trim().split(/\s+/)   // e.g. ['/wcg', 'stop']
    const cmd   = parts.slice(1)              // cmd[0]=command, cmd[1]+=args
    const arg1  = cmd[1] || ''
    const arg2  = cmd[2] || ''

    // Every gameEngine.js call below needs this exact ctx shape — built once
    // here so /wcg pause/resume/stop/reset can't drift out of sync with it.
    const engineCtx = { sock, games, settings, words, activeGameChatRef, persistGames }

    async function reply(text) {
        await sock.sendMessage(sender, { text })
    }

    // ── /wcg admin — public: claim the admin role if unclaimed ──
    if (cmd[0] === 'admin') {
        if (settings.adminNumber) {
            return reply(`⚠️ An admin is already set. Ask the Creator to run */wcg clearadmin* first if this needs to change.`)
        }
        settings.adminNumber = senderNumber
        settings.adminJid    = senderJid
        saveSettings()
        return reply(`👑 *You're now the Word Chain Admin!*\nType */wcg help* to see everything you can configure.`)
    }

    // Everything below requires at least ADMIN tier.
    if (!isAdmin) {
        return reply(`🔒 That command is admin-only. Type */wcg admin* to claim the role if it's unclaimed.`)
    }

    // Respect admin access scoping set by the creator (creator is never scoped).
    if (!senderIsCreator) {
        const scope = settings.adminGameAccess || 'all'
        if (scope !== 'all' && scope !== config.GAME_KEY) return
    }

    if (cmd[0] === 'clearadmin') {
        settings.adminNumber = ''
        settings.adminJid    = ''
        saveSettings()
        return reply(`✅ Admin cleared. Anyone can now claim it with */wcg admin*.`)
    }

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
        return reply(`Usage: */wcg set theme <name|none>*\n_Difficulty/timer/strikes are automatic now — see */wcg status*._`)
    }

    // ── Theme word-bank management ──
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

    if (cmd[0] === 'pause') {
        const gs = getGameState(sender, games)
        if (!gs.active) return reply(`⚠️ No active round to pause.`)
        if (gs.paused) return reply(`⚠️ Already paused.`)
        gs.paused = true
        if (gs.turnTimer) clearInterval(gs.turnTimer)
        persistGames()
        await sock.sendMessage(sender, { text: `⏸️ *Word Chain paused* by an admin. Remaining time on this turn is preserved.` })
        return
    }

    if (cmd[0] === 'resume') {
        const gs = getGameState(sender, games)
        if (!gs.active || !gs.paused) return reply(`⚠️ Nothing is paused right now.`)
        gs.paused = false
        persistGames()
        await sock.sendMessage(sender, { text: `▶️ *Word Chain resumed!* Clock picks up where it left off.` })
        startTurnCountdown(sender, engineCtx, { resume: true })
        return
    }

    // ── /wcg stop — graceful: ends the match now, still posts the full
    // match report + stats, exactly like a natural elimination ending would.
    if (cmd[0] === 'stop' || cmd[0] === 'end') {
        const gs = getGameState(sender, games)
        if (!gs.active && !gs.lobbyActive) return reply(`ℹ️ No *Word Chain* game is running here.`)

        if (gs.lobbyTimer) clearInterval(gs.lobbyTimer)
        if (gs.turnTimer)  clearInterval(gs.turnTimer)
        gs.lobbyActive = false

        if (gs.active) {
            await endMatch(sender, engineCtx, { type: 'admin_stop' })
        } else {
            gs.active = false
            safeClearActiveRef(activeGameChatRef, sender)
            persistGames()
            await sock.sendMessage(sender, { text: `🛑 *Lobby closed* by an admin.` })
        }
        return
    }

    // ── /wcg reset — hard wipe: no report, also resets this chat's
    // auto-difficulty tier back to the starting point. Use /wcg stop
    // instead if you just want a clean, reported end to the current match.
    if (cmd[0] === 'reset') {
        const gs = getGameState(sender, games)
        if (gs.turnTimer)  clearInterval(gs.turnTimer)
        if (gs.lobbyTimer) clearInterval(gs.lobbyTimer)
        gs.active            = false
        gs.lobbyActive        = false
        gs.players            = []
        gs.playerNames        = {}
        gs.playerJids         = {}
        gs.strikes            = {}
        gs.chain              = []
        gs.usedWords          = []
        gs.currentTurnIndex   = 0
        gs.paused             = false
        gs.tier               = config.START_TIER
        gs.totalStrikesThisMatch = 0
        gs.totalTurnsThisMatch   = 0
        safeClearActiveRef(activeGameChatRef, sender)
        persistGames()
        await sock.sendMessage(sender, { text: `♻️ *Word Chain* fully reset for this chat — state wiped, difficulty back to ${difficultyBadge(config.TIERS[config.START_TIER])}. No report sent.` })
        return
    }

    if (cmd[0] === 'status') {
        const gs = getGameState(sender, games)
        const cfg = tierConfigFor(gs.tier)
        const turns = gs.totalTurnsThisMatch
        const strikeRate = turns > 0 ? ((gs.totalStrikesThisMatch / turns) * 100).toFixed(0) + '%' : '—'
        return reply(
            `📊 *Word Chain Status*\n\n` +
            `Difficulty: ${difficultyBadge(cfg.tierKey)} _(auto — drifts after each match)_\n` +
            `Turn timer: ${cfg.timerSeconds}s | Min length: ${cfg.minLength} | Max strikes: ${cfg.maxStrikes}\n` +
            `This match's strike rate so far: ${strikeRate}\n` +
            `Active theme: ${words.activeTheme || 'none'}\n` +
            `Admin: ${settings.adminNumber || '(unclaimed)'}\n` +
            `Active round in this chat: ${gs.active ? 'Yes' : 'No'}\n` +
            `Lobby open in this chat: ${gs.lobbyActive ? 'Yes' : 'No'}`
        )
    }

    return reply(
        `🔧 *Word Chain Admin Commands*\n\n` +
        `*/wcg set theme <name|none>*\n` +
        `*/wcg listthemes* · */wcg listthemewords [theme]*\n` +
        `*/wcg addthemeword [theme] [word]* · */wcg removethemeword [theme] [word]*\n` +
        `*/wcg pause* / */wcg resume*\n` +
        `*/wcg stop* — end the match now, still posts the report\n` +
        `*/wcg reset* — hard wipe, no report, resets difficulty too\n` +
        `*/wcg status*\n` +
        `*/wcg clearadmin*\n\n` +
        `_Difficulty/timer/strikes are automatic — see_ */wcg status*_. ` +
        `Switching games or scoping admin access is done via the platform-level_ */game* _command, not here._`
    )
}

module.exports = { handleAdminCommand }
