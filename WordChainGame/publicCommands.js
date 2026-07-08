// ============================================================
//  WordChainGame/publicCommands.js
//  Handles all "!wcg ..." public messages plus in-round plain-
//  text word submissions. Exports handlePublicMessage(msgCtx)
//  per the plugin contract. Player surface is intentionally
//  limited to view/start/join/help/hint — see root
//  COMMAND_CONTROL.md; everything that controls or ends a match
//  (pause/resume/stop/reset/config) is admin-only.
// ============================================================

const { nameTag } = require('../permissions')
const { PREFIX, ADMIN_PREFIX } = require('./config')
const {
    getGameState,
    startLobbyCountdown,
    processWordSubmission,
    getHint,
    tierConfigFor
} = require('./gameEngine')
const { difficultyBadge } = require('./display')

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
        sock, games, settings, activeGameChatRef, persistGames,
        buildCtx, from, body, senderNumber, senderJid, senderName
    } = msgCtx

    const bodyLower = (body || '').trim().toLowerCase()
    const ctx = buildCtx ? buildCtx() : msgCtx

    // ── !wcg / !wcg help — rules. Bare acronym is its OWN branch, checked
    // before 'start', and never stateful — see ARCHITECTURE.md §9.
    if (bodyLower === PREFIX || bodyLower === `${PREFIX} help`) {
        await sock.sendMessage(from, {
            text:
                `🔗 *Word Chain!*\n\n` +
                `Say a real word. Next player's word must start with YOUR word's last letter. No repeats. ` +
                `Miss, stall, or break a rule enough times and you're out — last one standing wins!\n\n` +
                `*${PREFIX} start* — open a lobby\n` +
                `*${PREFIX} join* — join it\n` +
                `*${PREFIX} scores* — check the chain, whose turn it is, strikes so far\n` +
                `*${PREFIX} hint* — get a nudge on your turn (once per turn)\n` +
                `_Difficulty adjusts to this group automatically — no setup needed._\n` +
                `_Created with ❤️ by Sky Graphics_ 🎨`
        })
        return true
    }

    // ── !wcg start ──
    if (bodyLower === `${PREFIX} start`) {
        if (activeGameChatRef.value) {
            await sock.sendMessage(from, {
                text: `⚠️ A game is already active${activeGameChatRef.value === from ? ' in this chat' : ' elsewhere'}. Ask an admin to run */wcg stop* first.`
            })
            return true
        }
        const gameState = getGameState(from, games)
        gameState.lobbyActive = true
        gameState.lobbySecondsLeft = 60
        gameState.players = []
        gameState.playerNames = {}
        gameState.playerJids = {}

        const tierKey = tierConfigFor(gameState.tier).tierKey

        await sock.sendMessage(from, {
            text:
                `🔗 *Word Chain is Starting!*\n\n` +
                `You have *60 seconds* to join! ⏱️\n` +
                `🎯 Mode: ${difficultyBadge(tierKey)} _(auto)_\n` +
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
                text: `✅ *${nameTag(senderNumber, gameState.playerNames, settings)} joined!* 🎉\n\n👥 *Lobby:*\n${lobbyText}`,
                mentions: gameState.players.map(num => gameState.playerJids[num]).filter(Boolean)
            })
            persistGames()
        } else {
            await sock.sendMessage(from, { text: `⚠️ You're already in the lobby!` })
        }
        return true
    }

    // ── !wcg scores — read-only view, always available (COMMAND_CONTROL.md) ──
    if (bodyLower === `${PREFIX} scores` || bodyLower === `${PREFIX} status`) {
        const gameState = getGameState(from, games)
        if (gameState.lobbyActive) {
            const lobbyText = gameState.players
                .map((num, i) => `${i + 1}. ${nameTag(num, gameState.playerNames, settings)}`)
                .join('\n') || '[No players yet]'
            await sock.sendMessage(from, {
                text: `⏳ *Lobby open* — ${gameState.lobbySecondsLeft}s left.\n👥 *Players:*\n${lobbyText}`
            })
            return true
        }
        if (!gameState.active) {
            await sock.sendMessage(from, { text: `ℹ️ No *Word Chain* game is running here right now. Type *${PREFIX} start* to open one!` })
            return true
        }
        const currentPlayerNumber = gameState.players[gameState.currentTurnIndex]
        const currentStrikes = gameState.strikes[currentPlayerNumber] || 0
        const lastWord = gameState.chain.length ? gameState.chain[gameState.chain.length - 1].word : null
        await sock.sendMessage(from, {
            text:
                `📊 *Word Chain — Live Standings*\n\n` +
                `🔗 Chain length: *${gameState.chain.length}* words\n` +
                (lastWord ? `Last word: *${lastWord.toUpperCase()}* → next starts with *${lastWord.slice(-1).toUpperCase()}*\n` : '') +
                `🎯 Current turn: *${nameTag(currentPlayerNumber, gameState.playerNames, settings)}* (${currentStrikes}/${gameState.roundMaxStrikes} strikes)\n` +
                `👥 Players remaining: ${gameState.players.length}\n` +
                `📏 Longest word this match: ${gameState.longestWordThisMatch ? gameState.longestWordThisMatch.toUpperCase() : '—'}`
        })
        return true
    }

    // ── !wcg hint — player-facing, once per turn, fragment only ──
    if (bodyLower === `${PREFIX} hint`) {
        const gameState = getGameState(from, games)
        const currentPlayerNumber = gameState.players[gameState.currentTurnIndex]
        if (!gameState.active || gameState.paused) {
            await sock.sendMessage(from, { text: `ℹ️ No live round to hint right now.` })
            return true
        }
        if (senderNumber !== currentPlayerNumber) {
            await sock.sendMessage(from, { text: `⚠️ Hints are only for whoever's turn it is right now.` })
            return true
        }
        const result = getHint(from, ctx)
        if (!result.ok) {
            const msg = result.reason === 'already_given'
                ? `💡 You already used your hint this turn!`
                : `💡 No hint available right now — you've got this!`
            await sock.sendMessage(from, { text: msg })
            return true
        }
        await sock.sendMessage(from, {
            text: `💡 *Hint:* there's a *${result.length}-letter* word starting with *"${result.prefix}..."* that works.`
        })
        return true
    }

    // Any other unmatched "!wcg ..." input is a mistyped command, never a
    // word — don't let it fall through to word validation and cost a strike.
    if (bodyLower.startsWith(PREFIX)) {
        await sock.sendMessage(from, {
            text: `❓ Unknown command. Type *${PREFIX}* for the rules, *${PREFIX} start*, *${PREFIX} join*, *${PREFIX} scores*, or *${PREFIX} hint*.`
        })
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
