// ============================================================
//  adminCommands.js — Target Numbers (TGT) · Sky Graphics
//  Handles "/tgt ..." admin commands. Game switching itself
//  ("/game setgame ...") is handled entirely by index.js under the
//  fixed "/game" prefix — never touched here.
//
//  BUG FIX (§A8/C5): every reply in this file used to go to `sender`
//  (the chat where the command was typed) — for a group admin, that's
//  the group itself, leaking every settings change and status dump
//  into the public chat. All admin replies now DM the admin directly.
// ============================================================

const config = require('./config')
const gameEngine = require('./gameEngine')
const permissions = require('../permissions')

async function handleAdminCommand(ctx) {
    const {
        sock, games, settings, activeGameChatRef, persistGames,
        saveSettings, sendSafeMessage,
        sender, senderJid, senderNumber, body, senderTier
    } = ctx

    const text = (body || '').trim()
    if (!text.toLowerCase().startsWith(config.ADMIN_PREFIX)) return false

    const chatId  = sender // the group the command was typed in — used ONLY for game state lookup and the public report, never for admin replies
    const dmTarget = senderJid || (senderNumber ? `${senderNumber}@s.whatsapp.net` : null)

    // BUG FIX (§A8): reply() now DMs the admin, never the group.
    const reply = (t) => {
        if (!dmTarget) return Promise.resolve() // no known DM target — fail closed, never fall back to the group
        return typeof sendSafeMessage === 'function'
            ? sendSafeMessage(sock, dmTarget, { text: t })
            : sock.sendMessage(dmTarget, { text: t })
    }

    const senderIsCreator = senderTier === permissions.TIERS.CREATOR
    const isAdmin = senderIsCreator || senderTier === permissions.TIERS.ADMIN
    // SECURITY (§A3): must be the first thing checked, before cmd[0] is
    // even read. Non-admin senders get zero response — not even an error.
    if (!isAdmin) return false
    if (!senderIsCreator) {
        const scope = settings.adminGameAccess || 'all'
        if (scope !== 'all' && scope !== config.GAME_KEY) return false
    }

    const rest = text.slice(config.ADMIN_PREFIX.length).trim()
    const [cmdRaw, ...args] = rest.split(/\s+/)
    const cmd = (cmdRaw || '').toLowerCase()
    const arg = args.join(' ').toLowerCase()
    const tgt = settings.target || {}

    switch (cmd) {
        case 'setroundtime': {
            const n = parseInt(arg, 10)
            if (!Number.isInteger(n) || n < 15 || n > 180) {
                await reply(`⚠️ Give a number of seconds between 15 and 180.`)
                return true
            }
            settings.target = { ...tgt, roundSeconds: n }
            saveSettings()
            await reply(`✅ Round time set to *${n}s*.`)
            return true
        }

        case 'setcooldown': {
            const n = parseInt(arg, 10)
            if (!Number.isInteger(n) || n < 1 || n > 60) {
                await reply(`⚠️ Give a between-round cooldown of 1-60 seconds.`)
                return true
            }
            settings.target = { ...tgt, cooldownSeconds: n }
            saveSettings()
            await reply(`✅ Between-round cooldown set to *${n}s*.`)
            return true
        }

        case 'setrounds': {
            const val = arg === 'infinite' ? 'infinite' : parseInt(arg, 10)
            if (val !== 'infinite' && (!Number.isInteger(val) || val < 1 || val > 100)) {
                await reply(`⚠️ Give a number of rounds (1-100) or "infinite".`)
                return true
            }
            settings.target = { ...tgt, roundsPerSession: val }
            saveSettings()
            await reply(`✅ Rounds per session set to *${val}*.`)
            return true
        }

        case 'setsessioncooldown': {
            const n = parseInt(arg, 10)
            if (!Number.isInteger(n) || n < 5 || n > 600) {
                await reply(`⚠️ Give a value between 5 and 600 seconds.`)
                return true
            }
            settings.target = { ...tgt, sessionCooldown: n }
            saveSettings()
            await reply(`✅ Auto-restart cooldown between sessions set to *${n}s*.`)
            return true
        }

        case 'stop': {
            const gameState = gameEngine.getGameState(chatId, games)
            if (!gameState.active) {
                await reply(`ℹ️ No *${config.GAME_NAME}* session is running here.`)
                return true
            }
            // §C5: the admin's own acknowledgment goes to their DM; the
            // detailed session report (built inside stopSession) still
            // posts to the group — players need to see that part.
            await reply(`✅ Stopping *${config.GAME_NAME}* — posting the session report to the group now.`)
            await gameEngine.stopSession(chatId, ctx, 'manual')
            return true
        }

        case 'reset': {
            const gameState = gameEngine.getGameState(chatId, games)
            if (gameState.roundTimer)    clearInterval(gameState.roundTimer)
            if (gameState.cooldownTimer) clearTimeout(gameState.cooldownTimer)
            gameState.active       = false
            gameState.roundActive  = false
            gameState.scores       = {}
            gameState.roundsPlayed = 0
            gameState.tier         = config.START_TIER
            gameState.consecutiveEmptyRounds = 0
            gameState.roundHistory = []
            if (activeGameChatRef.value === chatId) activeGameChatRef.value = null
            persistGames()
            await reply(`♻️ *${config.GAME_NAME}* session and scores reset for this chat.`)
            return true
        }

        case 'status': {
            const gameState = gameEngine.getGameState(chatId, games)
            const cfg = gameEngine.getTgtSettings(settings)
            // Status is a dashboard — gets the card treatment per §A9.
            await reply(
                `${config.DIVIDER}\n` +
                `${config.BOT_EMOJI} *${config.GAME_NAME} (${config.GAME_ACRONYM}) — Status*\n` +
                `${config.DIVIDER}\n\n` +
                `Session active: ${gameState.active ? 'Yes' : 'No'}\n` +
                `Current tier: ${gameEngine.tierBadge(config.TIERS[gameState.tier])}\n` +
                `Rounds played: ${gameState.roundsPlayed}\n` +
                `Consecutive empty rounds: ${gameState.consecutiveEmptyRounds || 0}/${config.MAX_CONSECUTIVE_EMPTY_ROUNDS}\n\n` +
                `⚙️ Round time: ${cfg.roundSeconds}s\n` +
                `⚙️ Between-round cooldown: ${cfg.cooldownSeconds}s\n` +
                `⚙️ Rounds/session: ${cfg.roundsPerSession}\n` +
                `⚙️ Auto-restart cooldown: ${cfg.sessionCooldown}s\n\n` +
                `${config.DIVIDER}\n` +
                `_${config.GAME_ACRONYM} Bot · Sky Graphics_ 🎨`
            )
            return true
        }

        default: {
            await reply(
                `❓ Unknown admin command. Options:\n` +
                `${config.ADMIN_PREFIX}setroundtime <15-180>\n` +
                `${config.ADMIN_PREFIX}setcooldown <1-60>\n` +
                `${config.ADMIN_PREFIX}setrounds <1-100|infinite>\n` +
                `${config.ADMIN_PREFIX}setsessioncooldown <5-600>\n` +
                `${config.ADMIN_PREFIX}stop\n` +
                `${config.ADMIN_PREFIX}reset\n` +
                `${config.ADMIN_PREFIX}status`
            )
            return true
        }
    }
}

module.exports = { handleAdminCommand }
