// MomentumGame/publicCommands.js
// Handles "!mmt ..." group commands AND the DM pick itself — Momentum has
// no other gameplay surface. Exported as handlePublicMessage(msgCtx) per
// the plugin contract (index.js looks for this file automatically since
// gameEngine.js doesn't export handlePublicMessage directly).

const config     = require('./config')
const gameEngine = require('./gameEngine')
const { buildScoreboard } = require('./matchSummary')

const HELP_TEXT =
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🌀 *Momentum*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `A shared meter game — there's no puzzle, the only variable is what the group does.\n\n` +
    `*How to play:*\n` +
    `1️⃣ *!mmt start* opens a session in this group\n` +
    `2️⃣ Every round, DM the bot *⚡* or *🌊* (or type "bolt"/"wave")\n` +
    `3️⃣ Once everyone's picks lock, the round reveals whether it was a *Majority* round (match the crowd) or a *Minority* round (be the outlier) — you never know which until it's too late to change your answer\n` +
    `4️⃣ Score points by being on the winning side that round\n` +
    `5️⃣ *!mmt scores* any time to check the board\n\n` +
    `_Created with ❤️ by Sky Graphics_ 🎨`

function isGroup(chatId) {
    return typeof chatId === 'string' && chatId.endsWith('@g.us')
}

async function handlePublicMessage(msgCtx) {
    const {
        sock, games, settings, activeGameChatRef, persistGames, nameCache,
        from, body, rawBody, senderNumber, senderJid, senderName
    } = msgCtx

    const trimmed = (body || '').trim()
    const lower   = trimmed.toLowerCase()

    // ── !mmt ... commands ────────────────────────────────────
    if (lower.startsWith(config.PREFIX)) {
        const parts  = lower.split(/\s+/)
        const subCmd = parts[1]

        if (!subCmd || subCmd === 'help') {
            await sock.sendMessage(from, { text: HELP_TEXT })
            return true
        }

        if (subCmd === 'start') {
            if (!isGroup(from)) {
                await sock.sendMessage(from, {
                    text: `🌀 Start Momentum from the *group chat*, not a DM — everyone needs to see the meter.`
                })
                return true
            }

            if (activeGameChatRef.value && activeGameChatRef.value !== from) {
                await sock.sendMessage(from, {
                    text: `⚠️ A Momentum session is already running in another chat. It must end before a new one can start here.`
                })
                return true
            }

            const gs = gameEngine.getGameState(from, games)
            if (gs.active) {
                await sock.sendMessage(from, { text: `⚠️ Momentum is already running in this chat! Type *!mmt scores* to check the board.` })
                return true
            }

            await gameEngine.startSession(from, msgCtx)
            return true
        }

        if (subCmd === 'scores') {
            const chatId = isGroup(from) ? from : activeGameChatRef.value
            if (!chatId) {
                await sock.sendMessage(from, { text: `🌀 No Momentum session is currently active anywhere.` })
                return true
            }
            const gs = gameEngine.getGameState(chatId, games)
            await sock.sendMessage(from, { text: buildScoreboard(gs, config, nameCache, settings) })
            return true
        }

        // Unrecognized !mmt subcommand — quiet nudge, not silence, since this
        // IS a Momentum command attempt and the player deserves a pointer.
        await sock.sendMessage(from, {
            text: `🌀 Didn't recognize that. Try *!mmt help* to see everything Momentum supports.`
        })
        return true
    }

    // ── DM pick handling ─────────────────────────────────────
    // Only relevant in a DM (not the group chat itself) while a Momentum
    // session is active somewhere — single-active-game architecture means
    // this file only runs at all when Momentum IS the active game, so any
    // DM here is presumed to be aimed at it.
    if (!isGroup(from) && activeGameChatRef.value) {
        const chatId = activeGameChatRef.value
        const gs = gameEngine.getGameState(chatId, games)

        const key = config.SYMBOL_ALIASES[lower]
        if (key) {
            const result = gameEngine.registerPick(chatId, senderNumber, senderName, senderJid, key, games)
            persistGames()

            if (result.ok) {
                await sock.sendMessage(from, {
                    text: result.changed
                        ? `🔄 Pick updated: *${config.SYMBOLS[key]}* — locked in until the round closes.`
                        : `✅ Pick locked in: *${config.SYMBOLS[key]}*. Round reveals once time's up!`
                })
            } else if (result.reason === 'too_late') {
                await sock.sendMessage(from, { text: `⏰ Too late — this round already locked. Catch the next one!` })
            } else if (result.reason === 'no_round') {
                await sock.sendMessage(from, { text: `🌀 No round is open right now. Hang tight for the next one.` })
            }
            return true
        }

        // Only nudge when it looks like a genuine attempt at a pick (short
        // message) and a round is actually open — avoids noise on unrelated
        // DM chatter when nothing is running.
        if (gs.active && gs.roundActive && trimmed.length > 0 && trimmed.length <= 15) {
            await sock.sendMessage(from, {
                text: `🌀 Didn't catch that — DM me *⚡* or *🌊* (or "bolt"/"wave") to lock in this round's pick.`
            })
            return true
        }
    }

    return false
}

module.exports = { handlePublicMessage }
