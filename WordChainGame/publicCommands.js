// ============================================================
//  WordChainGame/publicCommands.js
//  Handles all "!wcg ..." public messages plus in-round plain-
//  text word submissions. Exports handlePublicMessage(msgCtx)
//  per the plugin contract in the project root README.md.
// ============================================================

const { nameTag } = require('../permissions')
const { PREFIX } = require('./config')
const {
    getGameState,
    startLobbyCountdown,
    startActualGame,
    processWordSubmission
} = require('./gameEngine')

/**
 * @param {object} msgCtx {
 *   sock, games, settings, words, activeGameChatRef, persistGames, nameCache,
 *   sendSafeMessage, buildCtx,
 *   from, body, rawBody, senderNumber, senderJid, senderName, isAdmin
 * }
 * @returns {boolean} true if this message was handled by Word Chain
 */
async function handlePublicMessage(msgCtx) {
    const {
        sock, games, settings, activeGameChatRef, persistGames, nameCache,
        buildCtx, from, body, senderNumber, senderJid, senderName
    } = msgCtx

    const bodyLower = (body || '').trim().toLowerCase()
    const ctx = buildCtx ? buildCtx() : msgCtx

    // ── !wcg / !wcg help — rules ──
    if (bodyLower === PREFIX || bodyLower === `${PREFIX} help`) {
        await sock.sendMessage(from, {
            text:
                `🔗 *Word Chain!*\n\n` +
                `Say a real word. Next player's word must start with YOUR word's last letter. No repeats. ` +
                `Miss, stall, or break a rule enough times and you're out — last one standing wins!\n\n` +
                `*${PREFIX} start* — open a lobby\n` +
                `*${PREFIX} join* — join it\n` +
                `_Created with ❤️ by Sky Graphics_ 🎨`
        })
        return true
    }

    // ── !wcg start ──
    if (bodyLower === `${PREFIX} start`) {
        if (activeGameChatRef.value) {
            await sock.sendMessage(from, {
                text: `⚠️ A game is already active${activeGameChatRef.value === from ? ' in this chat' : ' elsewhere'}. Use */wcg end* to stop it first.`
            })
            return true
        }
        const gameState = getGameState(from, games)
        gameState.lobbyActive = true
        gameState.lobbySecondsLeft = 60
        gameState.players = []
        gameState.playerNames = {}
        gameState.playerJids = {}

        await sock.sendMessage(from, {
            text:
                `🔗 *Word Chain is Starting!*\n\n` +
                `You have *60 seconds* to join! ⏱️\n` +
                `Type *${PREFIX} join* now!`
        })

        activeGameChatRef.value = from
        persistGames()
        startLobbyCountdown(from, ctx)
        return true
    }

    // ── !wcg join ──
    if (bodyLower === `${PREFIX} join`) {
        const gameState = getGameState(from, games)
        if (!gameState.lobbyActive) {
            await sock.sendMessage(from, { text: `⚠️ No active lobby. Type *${PREFIX} start* to open one!` })
            return true
        }
        if (!gameState.players.includes(senderNumber)) {
            gameState.players.push(senderNumber)
            gameState.playerNames[senderNumber] = senderName || senderNumber
            gameState.playerJids[senderNumber]  = senderJid

            const lobbyText = gameState.players
                .map((num, i) => `${i + 1}. ${nameTag(num, gameState.playerNames, settings)}`)
                .join('\n')

            await sock.sendMessage(from, {
                text: `✅ *${nameTag(senderNumber, nameCache, settings)} joined!* 🎉\n\n👥 *Lobby:*\n${lobbyText}`,
                mentions: gameState.players.map(num => gameState.playerJids[num]).filter(Boolean)
            })
            persistGames()
        } else {
            await sock.sendMessage(from, { text: `⚠️ You're already in the lobby!` })
        }
        return true
    }

    // Any other unmatched "!wcg ..." input is a mistyped command, never a
    // word — don't let it fall through to word validation and cost a strike.
    if (bodyLower.startsWith(PREFIX)) {
        await sock.sendMessage(from, { text: `❓ Unknown command. Type *${PREFIX}* for the rules, *${PREFIX} start*, or *${PREFIX} join*.` })
        return true
    }

    // ── Active round: plain-text word submissions (no prefix) ──
    const gameState = getGameState(from, games)
    if (gameState.active && !gameState.paused && senderNumber) {
        await processWordSubmission(from, senderNumber, body, ctx)
        return true
    }

    return false
}

module.exports = { handlePublicMessage }
