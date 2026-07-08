// ============================================================
//  publicCommands.js — The 24 Game (M4T) · Sky Graphics
//  Handles "!m4th ..." messages plus live no-prefix guesses while
//  a round is open. No admin logic lives here — see adminCommands.js.
// ============================================================

const config = require('./config')
const gameEngine = require('./gameEngine')
const matchSummary = require('./matchSummary')
const { nameTag, resolveSetting } = require('../permissions')

async function handlePublicMessage(msgCtx) {
    const {
        sock, games, settings, activeGameChatRef, persistGames,
        from, body, rawBody, senderNumber, senderJid, senderName, isAdmin, buildCtx
    } = msgCtx

    const ctx = typeof buildCtx === 'function'
        ? buildCtx()
        : { sock, games, settings, activeGameChatRef, persistGames }

    const text = (body || rawBody || '').trim()
    const lower = text.toLowerCase()

    if (lower.startsWith(config.PREFIX)) {
        const rest = text.slice(config.PREFIX.length).trim().toLowerCase()

        // Bare "!m4th" with no subcommand must always explain the game —
        // never silently attempt to start it. See ARCHITECTURE.md §10.
        if (rest === '') {
            await sock.sendMessage(from, {
                text:
                    `🧮 *${config.GAME_NAME} (${config.GAME_ACRONYM})*\n\n` +
                    `Each round gives 4 numbers. Combine ALL 4 using \`+ − × ÷\` ` +
                    `(any order, any grouping, parentheses allowed) to make exactly *24*. ` +
                    `Just type your equation directly — no prefix needed once a round is live. ` +
                    `First correct answer wins the round! 🏆\n\n` +
                    `*${config.PREFIX} start* — begin a session\n` +
                    `*${config.PREFIX} scores* — show current standings\n` +
                    `*${config.PREFIX} hint* — get a partial hint for the live round\n` +
                    `*${config.PREFIX} help* — show this again`
            })
            return true
        }

        if (rest === 'start') {
            const publicCanStart = resolveSetting('publicCanStart', settings, false)
            if (!isAdmin && !publicCanStart) {
                await sock.sendMessage(from, { text: `🚫 Only an admin can start *${config.GAME_NAME}* right now.` })
                return true
            }
            await gameEngine.startSession(from, ctx)
            return true
        }

        if (rest === 'stop') {
            await sock.sendMessage(from, { text: `🚫 Only an admin can stop a running *${config.GAME_NAME}* session. Ask an admin to run *${config.ADMIN_PREFIX}stop*.` })
            return true
        }

        if (rest === 'hint') {
            const result = gameEngine.getHint(from, ctx)
            if (!result.ok) {
                await sock.sendMessage(from, { text: `ℹ️ No hint available — no round is currently live.` })
                return true
            }
            await sock.sendMessage(from, {
                text: result.step
                    ? `💡 *Hint${result.alreadyGiven ? ' (repeat)' : ''}:* try \`${result.step}\` as one of your steps.`
                    : `💡 No partial hint available for this one — you've got this!`
            })
            return true
        }

        if (rest === 'scores' || rest === 'leaderboard') {
            const gameState = gameEngine.getGameState(from, games)
            const text2 = matchSummary.buildLeaderboardText(
                gameState,
                (n) => nameTag(n, gameState.playerNames, settings),
                gameState.active ? 'in_progress' : 'manual'
            )
            await sock.sendMessage(from, { text: text2 })
            return true
        }

        if (rest === 'help') {
            await sock.sendMessage(from, {
                text:
                    `🧮 *${config.GAME_NAME} (${config.GAME_ACRONYM}) — How to Play*\n\n` +
                    `*${config.PREFIX} start* — begin a session\n` +
                    `*${config.PREFIX} scores* — show current standings\n` +
                    `*${config.PREFIX} hint* — get a partial hint for the live round\n` +
                    `_(only an admin can stop a session — ${config.ADMIN_PREFIX}stop)_\n\n` +
                    `Each round gives 4 numbers. Combine ALL 4 using \`+ − × ÷\` ` +
                    `(any order, any grouping, parentheses allowed) to make exactly *24*. ` +
                    `Just type your equation directly — no prefix needed once a round is live. ` +
                    `First correct answer wins the round! 🏆`
            })
            return true
        }

        await sock.sendMessage(from, { text: `❓ Unknown *${config.GAME_NAME}* command. Try *${config.PREFIX} help*.` })
        return true
    }

    // No prefix — only relevant while a round is actually open in this chat.
    const gameState = gameEngine.getGameState(from, games)
    if (gameState.active && gameState.roundActive) {
        return await gameEngine.handleGuessAttempt(from, text, { senderNumber, senderJid, senderName }, ctx)
    }

    return false
}

module.exports = { handlePublicMessage }
