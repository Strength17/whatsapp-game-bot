// ============================================================
//  WordChainGame/publicCommands.js
//  Handles all "!wcg ..." public messages plus in-round plain-
//  text word submissions. Exports handlePublicMessage(msgCtx)
//  per the plugin contract (ARCHITECTURE.md).
//
//  Per ARCHITECTURE.md §5, the public self-service "claim the
//  admin role" command lives HERE, not in adminCommands.js — it's
//  the one command any random group member is allowed to run
//  before any tier gate applies.
// ============================================================

const { nameTag } = require('../permissions')
const { PREFIX } = require('./config')
const { card, themeBadge } = require('./display')
const {
    getGameState,
    openLobby,
    processWordSubmission,
    themeWordsFor
} = require('./gameEngine')
const dictionary = require('./dictionary')

/**
 * @param {object} msgCtx {
 *   sock, games, settings, words, activeGameChatRef, persistGames, nameCache,
 *   sendSafeMessage, buildCtx, saveSettings,
 *   from, body, rawBody, senderNumber, senderJid, senderName, isAdmin
 * }
 * @returns {boolean} true if this message was handled by Word Chain
 */
async function handlePublicMessage(msgCtx) {
    const {
        sock, games, settings, activeGameChatRef, persistGames, nameCache, saveSettings,
        buildCtx, from, body, senderNumber, senderJid, senderName
    } = msgCtx

    const bodyLower = (body || '').trim().toLowerCase()
    const ctx = buildCtx ? buildCtx() : msgCtx

    // ── !wcg / !wcg help — bare acronym must ALWAYS explain, never act
    // (ARCHITECTURE.md §9 — checked first, before every other branch) ──
    if (bodyLower === PREFIX || bodyLower === `${PREFIX} help`) {
        await sock.sendMessage(from, {
            text: card('Word Chain!',
                `Say a real word. Next player's word must start with YOUR word's last letter. No repeats. ` +
                `Miss, stall, or break a rule enough times and you're out — last one standing wins!\n\n` +
                `📏 Minimum word length climbs *live* the longer a chain runs, and starts a little higher ` +
                `each match your group cruises through the last one.\n` +
                `🎨 Themed words (Animals, Food) unlock automatically the longer the group goes without a strike.\n` +
                `⏳ Every match runs on its own clock — it ends itself, no admin has to stop it, and a fresh lobby ` +
                `opens right after.\n\n` +
                `1️⃣ *${PREFIX} start* — open a lobby\n` +
                `2️⃣ *${PREFIX} join* — join it\n` +
                `3️⃣ *${PREFIX} scores* — see the chain, whose turn it is, and current strikes\n` +
                `4️⃣ *${PREFIX} hint* — get a small nudge on your turn\n` +
                `5️⃣ *${PREFIX} admin* — claim the admin role (if unclaimed)`)
        })
        return true
    }

    // ── !wcg admin — public self-claim, unclaimed-only ──
    if (bodyLower === `${PREFIX} admin`) {
        if (settings.adminNumber) {
            await sock.sendMessage(from, {
                text: `⚠️ An admin is already set. Ask the Creator to run */wcg clearadmin* first if this needs to change.`
            })
            return true
        }
        settings.adminNumber = senderNumber
        settings.adminJid    = senderJid
        saveSettings()
        await sock.sendMessage(from, {
            text: `👑 *You're now the Word Chain Admin!*\nType */wcg help* to see everything you can configure.`
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
        await openLobby(from, ctx)
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

    // ── !wcg scores — public "view" command: chain, turn, strikes ──
    if (bodyLower === `${PREFIX} scores`) {
        const gameState = getGameState(from, games)
        if (!gameState.active) {
            await sock.sendMessage(from, { text: `⚠️ No round is active right now. Type *${PREFIX} start* to open a lobby!` })
            return true
        }
        const currentPlayerNumber = gameState.players[gameState.currentTurnIndex]
        const currentPlayerName   = nameTag(currentPlayerNumber, gameState.playerNames, settings)
        const currentStrikes      = gameState.strikes[currentPlayerNumber] || 0
        const chainWords = gameState.chain.map(c => c.word.toUpperCase()).join(' → ') || '(empty so far)'
        const themeLine = themeBadge(gameState.roundTheme)
        const matchMin = Math.floor((gameState.matchSecondsLeft || 0) / 60)
        const matchSec = String((gameState.matchSecondsLeft || 0) % 60).padStart(2, '0')

        await sock.sendMessage(from, {
            text:
                `📊 *Word Chain — ${gameState.chain.length} words so far*\n` +
                `${chainWords}\n\n` +
                (themeLine ? `${themeLine}\n` : ``) +
                `🎯 Current turn: *${currentPlayerName}*\n` +
                `💥 Strikes: *${currentStrikes}/${gameState.roundMaxStrikes}*\n` +
                `⏱️ ${gameState.turnSecondsLeft}s left on this turn\n` +
                `⏳ ${matchMin}:${matchSec} left in the match`
        })
        return true
    }

    // ── !wcg hint — fragment, not the answer, same rule as other games ──
    if (bodyLower === `${PREFIX} hint`) {
        const gameState = getGameState(from, games)
        if (!gameState.active) {
            await sock.sendMessage(from, { text: `⚠️ No round is active right now.` })
            return true
        }
        const currentPlayerNumber = gameState.players[gameState.currentTurnIndex]
        if (senderNumber !== currentPlayerNumber) {
            await sock.sendMessage(from, { text: `⚠️ Hints are only for whoever's turn it currently is.` })
            return true
        }
        const lastEntry = gameState.chain.length ? gameState.chain[gameState.chain.length - 1] : null
        const requiredLetter = lastEntry ? lastEntry.word.slice(-1) : null

        if (!requiredLetter) {
            await sock.sendMessage(from, { text: `💡 It's the opening word — any real word, ${gameState.roundMinLength}+ letters, goes!` })
            return true
        }

        const themeWords = themeWordsFor(msgCtx.words, gameState.roundTheme)
        const fragment = dictionary.getHintFragment(requiredLetter, gameState.roundMinLength, gameState.usedWords, themeWords)

        await sock.sendMessage(from, {
            text: fragment
                ? `💡 *Hint:* a valid word starts with "*${fragment.toUpperCase()}...*"`
                : `💡 Nothing left comes to mind for *${requiredLetter.toUpperCase()}* that hasn't been used — you're on your own for this one! 😅`
        })
        return true
    }

    // Any other unmatched "!wcg ..." input is a mistyped command, never a
    // word — don't let it fall through to word validation and cost a strike.
    if (bodyLower.startsWith(PREFIX)) {
        await sock.sendMessage(from, { text: `❓ Unknown command. Type *${PREFIX}* for the rules, *${PREFIX} start*, *${PREFIX} join*, *${PREFIX} scores*, or *${PREFIX} hint*.` })
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
