// ============================================================
//  WordChainGame/adminCommands.js
//  All "/wcg ..." admin commands. Kept lean — first person to
//  claim admin gets it, creator can always reclaim/reset it.
//
//  NOTE: game switching (setgame / setadminaccess / status) is NOT
//  handled here. Per the updated project architecture, that lives
//  entirely behind the fixed `/game` prefix in the root index.js —
//  no individual game's adminCommands.js wires it in anymore, so
//  there's nothing to remove or maintain here if that dispatcher
//  changes later.
// ============================================================

const { TIERS, getTier, resolveSetting, writeSetting } = require('../permissions')
const { difficultyBadge, themeBadge } = require('./display')
const config = require('./config')

async function handleAdminCommand(ctx) {
    const {
        sock, settings, words, saveSettings, saveWords, senderNumber, senderJid, senderName,
        sender, body, games, activeGameChatRef, persistGames, getGameState,
        startTurnCountdown, senderTier, senderIsAdmin
    } = ctx

    const tier = senderTier || getTier(senderNumber, settings, senderJid)
    const senderIsCreator = tier === TIERS.CREATOR
    const isAdmin = typeof senderIsAdmin === 'boolean' ? senderIsAdmin : (tier === TIERS.ADMIN || tier === TIERS.CREATOR)

    const parts = body.trim().split(/\s+/)   // e.g. ['/wcg', 'set', 'difficulty', 'normal']
    const cmd   = parts.slice(1)             // cmd[0]=command, cmd[1]+=args
    const arg1  = cmd[1] || ''
    const arg2  = cmd[2] || ''

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

    if (cmd[0] === 'set') {
        if (arg1 === 'difficulty') {
            if (!['easy', 'normal', 'difficult'].includes(arg2)) {
                return reply(`Usage: */wcg set difficulty easy|normal|difficult*`)
            }
            writeSetting(tier, 'difficulty', arg2, settings)
            saveSettings()
            return reply(`✅ Difficulty set to ${difficultyBadge(arg2)}. Takes effect next round.`)
        }
        if (arg1 === 'strikes') {
            const n = parseInt(arg2, 10)
            if (!Number.isInteger(n) || n < 1) return reply(`Usage: */wcg set strikes <number, 1 or more>*`)
            writeSetting(tier, 'maxStrikes', n, settings)
            saveSettings()
            return reply(`✅ Max strikes set to *${n}*. Takes effect next round.`)
        }
        if (arg1 === 'timer') {
            if (arg2 === 'auto') {
                writeSetting(tier, 'timerSeconds', 'auto', settings)
                saveSettings()
                return reply(`✅ Turn timer reset to automatic (difficulty-based).`)
            }
            const n = parseInt(arg2, 10)
            if (!Number.isInteger(n)) return reply(`Usage: */wcg set timer <seconds>* or */wcg set timer auto*`)
            if (n < config.MIN_TIMER_SECONDS) return reply(`⚠️ ${config.MIN_TIMER_SECONDS}s is the minimum (connection reliability) — setting to ${config.MIN_TIMER_SECONDS}s instead.`)
            writeSetting(tier, 'timerSeconds', Math.max(config.MIN_TIMER_SECONDS, n), settings)
            saveSettings()
            return reply(`✅ Turn timer set to *${Math.max(config.MIN_TIMER_SECONDS, n)}s*. Takes effect next round.`)
        }
        if (arg1 === 'theme') {
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
        return reply(`Usage: */wcg set difficulty|strikes|timer|theme <value>*`)
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
        gs.paused = true
        if (gs.turnTimer) clearInterval(gs.turnTimer)
        persistGames()
        await sock.sendMessage(sender, { text: `⏸️ *Word Chain paused* by an admin.` })
        return
    }

    if (cmd[0] === 'resume') {
        const gs = getGameState(sender, games)
        if (!gs.active || !gs.paused) return reply(`⚠️ Nothing is paused right now.`)
        gs.paused = false
        persistGames()
        await sock.sendMessage(sender, { text: `▶️ *Word Chain resumed!*` })
        startTurnCountdown(sender)
        return
    }

    if (cmd[0] === 'end' || cmd[0] === 'stop') {
        const gs = getGameState(sender, games)
        gs.active = false
        gs.lobbyActive = false
        if (gs.turnTimer) clearInterval(gs.turnTimer)
        if (gs.lobbyTimer) clearInterval(gs.lobbyTimer)
        activeGameChatRef.value = null
        persistGames()
        await sock.sendMessage(sender, { text: `🛑 *Word Chain ended* by an admin.` })
        return
    }

    if (cmd[0] === 'status') {
        const difficulty = resolveSetting('difficulty', settings, 'easy')
        const timer      = resolveSetting('timerSeconds', settings, 'auto')
        const strikes    = resolveSetting('maxStrikes', settings, config.DEFAULT_MAX_STRIKES)
        const gs = getGameState(sender, games)
        return reply(
            `📊 *Word Chain Status*\n\n` +
            `Difficulty: ${difficultyBadge(difficulty)}\n` +
            `Timer: ${timer === 'auto' ? 'Auto (difficulty-based)' : `${timer}s manual`}\n` +
            `Max strikes: ${strikes}\n` +
            `Active theme: ${words.activeTheme || 'none'}\n` +
            `Admin: ${settings.adminNumber || '(unclaimed)'}\n` +
            `Active round in this chat: ${gs.active ? 'Yes' : 'No'}\n` +
            `Lobby open in this chat: ${gs.lobbyActive ? 'Yes' : 'No'}`
        )
    }

    return reply(
        `🔧 *Word Chain Admin Commands*\n\n` +
        `*/wcg set difficulty easy|normal|difficult*\n` +
        `*/wcg set strikes <n>*\n` +
        `*/wcg set timer <seconds|auto>*\n` +
        `*/wcg set theme <name|none>*\n` +
        `*/wcg listthemes* · */wcg listthemewords [theme]*\n` +
        `*/wcg addthemeword [theme] [word]* · */wcg removethemeword [theme] [word]*\n` +
        `*/wcg pause* / */wcg resume* / */wcg end*\n` +
        `*/wcg status*\n` +
        `*/wcg clearadmin*\n\n` +
        `_Switching games or scoping admin access is done via the platform-level_ */game* _command, not here._`
    )
}

module.exports = { handleAdminCommand }
