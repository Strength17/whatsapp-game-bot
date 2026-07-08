// ============================================================
//  publicCommands.js — Target Numbers (TGT) · Sky Graphics
//  Handles "!tgt ..." messages plus live no-prefix guesses while a
//  round is open. Player surface is intentionally limited to
//  start / scores (view) / hint / help — see root COMMAND_CONTROL.md.
//  No admin logic lives here — see adminCommands.js.
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

        // Bare "!tgt" with no subcommand must always explain the game —
        // never silently attempt to start it. See ARCHITECTURE.md §9.
        // COMPLIANCE FIX: card-formatted per §A9/BOT_STYLE_GUIDE — HMG's
        // own bare-prefix intro gets the divider/brand treatment, and this
        // is exactly the "help dashboard" card type listed there.
        if (rest === '') {
            await sock.sendMessage(from, {
                text:
                    `${config.DIVIDER}\n` +
                    `${config.BOT_EMOJI} *${config.GAME_NAME} (${config.GAME_ACRONYM})*\n` +
                    `${config.DIVIDER}\n\n` +
                    `Each round gives 6 numbers and a 3-digit target. Combine any of the ` +
                    `numbers (don't have to use them all, each only as many times as it appears) ` +
                    `with \`+ − × ÷\` — every step must stay a positive whole number, no fractions. ` +
                    `Just type your equation while a round is open. Exact hit ends the round instantly; ` +
                    `otherwise the closest submission wins when time's up!\n\n` +
                    `*${config.PREFIX} start* — begin a session\n` +
                    `*${config.PREFIX} scores* — show current standings\n` +
                    `*${config.PREFIX} hint* — get a partial hint for the live round\n` +
                    `*${config.PREFIX} help* — show this again\n\n` +
                    `${config.DIVIDER}\n` +
                    `_${config.GAME_ACRONYM} Bot · Sky Graphics_ 🎨`
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

        // Control verbs are admin-only, everywhere in this project — see
        // COMMAND_CONTROL.md §2/§5. Redirect clearly instead of a silent
        // "unknown command".
        if (rest === 'stop' || rest === 'reset') {
            await sock.sendMessage(from, { text: `🚫 Only an admin can ${rest} a running *${config.GAME_NAME}* session. Ask an admin to run *${config.ADMIN_PREFIX}${rest}*.` })
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
            const text2 = matchSummary.buildLiveStandingsText(
                gameState,
                (n) => nameTag(n, gameState.playerNames, settings)
            )
            await sock.sendMessage(from, { text: text2 })
            return true
        }

        if (rest === 'help') {
            await sock.sendMessage(from, {
                text:
                    `${config.DIVIDER}\n` +
                    `${config.BOT_EMOJI} *${config.GAME_NAME} (${config.GAME_ACRONYM}) — How to Play*\n` +
                    `${config.DIVIDER}\n\n` +
                    `*${config.PREFIX} start* — begin a session\n` +
                    `*${config.PREFIX} scores* — show current standings\n` +
                    `*${config.PREFIX} hint* — get a partial hint for the live round\n` +
                    `_(only an admin can stop/reset a session)_\n\n` +
                    `Each round gives 6 numbers and a 3-digit target. Combine any of the ` +
                    `numbers (don't have to use them all, each only as many times as it appears) ` +
                    `with \`+ − × ÷\` — every step must stay a positive whole number, no fractions. ` +
                    `Just type your equation while a round is open. Exact hit ends the round instantly; ` +
                    `otherwise the closest submission wins when time's up!\n\n` +
                    `${config.DIVIDER}\n` +
                    `_${config.GAME_ACRONYM} Bot · Sky Graphics_ 🎨`
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
