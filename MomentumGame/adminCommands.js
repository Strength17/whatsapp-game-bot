// MomentumGame/adminCommands.js
// Handles "/mmt ..." commands. Exported as handleAdminCommand(ctx) per the
// plugin contract. Game switching itself (/game setgame etc.) never touches
// this file — that's handled entirely upstream by game-switch-commands.js.

const config     = require('./config')
const gameEngine = require('./gameEngine')

let TIERS = { CREATOR: 'creator', ADMIN: 'admin', PUBLIC: 'public' }
try {
    TIERS = require('../permissions').TIERS
} catch (_) {
    // Falls back to the string constants above if permissions.js can't be
    // resolved for some reason — keeps this file from hard-crashing the bot.
}

const ADMIN_HELP =
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🌀 *Momentum — Admin Commands*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `› \`/mmt status\` — session state, meter, round timer\n` +
    `› \`/mmt pause\` — freeze the current round's timer\n` +
    `› \`/mmt resume\` — unfreeze it\n` +
    `› \`/mmt end\` / \`/mmt stop\` — end the session, post final standings\n` +
    `› \`/mmt reset\` — wipe scores + meter without ending the session\n` +
    `› \`/mmt setroundtime [seconds]\` — change how long each round stays open\n\n` +
    `Players use \`!mmt start\`, \`!mmt help\`, \`!mmt scores\`, and DM picks (\`⚡\`/\`🌊\`).`

async function handleAdminCommand(ctx) {
    const {
        sock, games, settings, activeGameChatRef, persistGames,
        senderJid, body, isAdmin, senderTier
    } = ctx

    if (!isAdmin) return // absolute silence for non-admins, matching every other game

    const senderIsCreator = senderTier === TIERS.CREATOR

    // ── Admin scope check — mirrors the contract exactly ────────
    if (!senderIsCreator) {
        const scope = settings.adminGameAccess || 'all'
        if (scope !== 'all' && scope !== config.GAME_KEY) return
    }

    const parts = (body || '').trim().split(/\s+/)
    const cmd   = parts.slice(1) // parts[0] is "/mmt"

    if (cmd[0] === 'help' || !cmd[0]) {
        await sock.sendMessage(senderJid, { text: ADMIN_HELP })
        return
    }

    const chatId = activeGameChatRef.value

    if (cmd[0] === 'status') {
        if (!chatId) {
            await sock.sendMessage(senderJid, { text: `🌀 No Momentum session is currently active anywhere.` })
            return
        }
        const gs = gameEngine.getGameState(chatId, games)
        const secondsLeft = gs.roundActive
            ? Math.max(0, Math.ceil((gs.roundDeadline - Date.now()) / 1000))
            : null

        await sock.sendMessage(senderJid, {
            text:
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `🌀 *Momentum — Status*\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `Chat: \`${chatId}\`\n` +
                `Round: *${gs.round}*  ${gs.paused ? '⏸️ PAUSED' : (gs.roundActive ? `🟢 open (${secondsLeft}s left)` : '⏳ between rounds')}\n` +
                `Meter: ${gs.meter}%\n` +
                `Round length: ${Math.round(gs.roundDurationMs / 1000)}s\n` +
                `Players tracked: ${Object.keys(gs.players).length}\n` +
                `Picks in this round: ${Object.keys(gs.roundPicks).length}\n` +
                `Admin scope: ${settings.adminGameAccess || 'all'}`
        })
        return
    }

    if (!chatId) {
        await sock.sendMessage(senderJid, { text: `🌀 No Momentum session is currently active anywhere.` })
        return
    }

    const gs = gameEngine.getGameState(chatId, games)

    if (cmd[0] === 'pause') {
        const ok = await gameEngine.pauseSession(chatId, games)
        persistGames()
        await sock.sendMessage(senderJid, { text: ok ? `⏸️ Momentum paused.` : `⚠️ Nothing to pause — session isn't active or is already paused.` })
        if (ok) {
            await sock.sendMessage(chatId, { text: `⏸️ *Momentum paused by the admin.* Sit tight — picks won't lock until it resumes. ☕` })
        }
        return
    }

    if (cmd[0] === 'resume') {
        const ok = await gameEngine.resumeSession(chatId, ctx)
        persistGames()
        await sock.sendMessage(senderJid, { text: ok ? `▶️ Momentum resumed.` : `⚠️ Nothing to resume — session isn't paused.` })
        if (ok) {
            await sock.sendMessage(chatId, { text: `▶️ *Momentum resumed by the admin!* Picks are open again. 🌀` })
        }
        return
    }

    if (cmd[0] === 'end' || cmd[0] === 'stop') {
        await gameEngine.endSession(chatId, ctx)
        await sock.sendMessage(senderJid, { text: `🛑 Momentum session ended.` })
        return
    }

    if (cmd[0] === 'reset') {
        gameEngine.resetScores(chatId, games)
        persistGames()
        await sock.sendMessage(senderJid, { text: `🔄 Scores and meter reset. Session keeps running.` })
        await sock.sendMessage(chatId, { text: `🔄 *Scores and the meter were just reset by the admin.* Fresh start! 🌀` })
        return
    }

    if (cmd[0] === 'setroundtime') {
        const seconds = parseInt(cmd[1], 10)
        if (!Number.isFinite(seconds) || seconds < 10) {
            await sock.sendMessage(senderJid, { text: `⚠️ Give me a number of seconds, at least 10. Example: \`/mmt setroundtime 45\`` })
            return
        }
        gs.roundDurationMs = seconds * 1000
        persistGames()
        await sock.sendMessage(senderJid, { text: `⏱️ Round length set to *${seconds}s*. Takes effect starting next round.` })
        return
    }

    // Unknown command — absolute silence, consistent with the rest of the bot
}

module.exports = { handleAdminCommand }
