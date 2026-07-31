// ============================================================
//  WordClimbGame/publicCommands.js — WCL Bot · Sky Graphics
//  Handles all PUBLIC (non-admin) message flow for this game:
//    !wcl            — explainer card (never stateful — see
//                       ARCHITECTURE.md §9, bare-acronym rule)
//    !wcl start      — open a lobby
//    !wcl join       — join the open lobby
//    !wcl help       — how-to-play card
//    live word guesses while a round is active (no prefix needed,
//    same convention as HangmanGame's letter/word guesses)
//
//  Admin "/" commands live in adminCommands.js. Turn-timer +
//  scoring mechanics live in gameEngine.js — this file is the
//  glue between an inbound WhatsApp message and that engine.
// ============================================================

const { nameTag, resolveSetting } = require('../permissions')
const config = require('./config')
const engine = require('./gameEngine')

function resolveJid(number, playerJids) {
    if (!number) return ''
    if (number.includes('@')) return number
    return (playerJids && playerJids[number]) || `${number}@s.whatsapp.net`
}

const HELP_TEXT =
    `${config.DIVIDER}\n` +
    `${config.BOT_EMOJI}  *${config.GAME_NAME} (${config.GAME_ACRONYM}) Bot*\n` +
    `${config.DIVIDER}\n` +
    `A live elimination word game — the required word length climbs a rung ` +
    `every lap, from *${config.MIN_LENGTH} letters* all the way to *${config.MAX_LENGTH}*.\n\n` +
    `*🎮 How to Play:*\n` +
    `1️⃣ Type *${config.PREFIX} start* to open a lobby\n` +
    `2️⃣ Type *${config.PREFIX} join* to enter it\n` +
    `3️⃣ On your turn, the bot gives you a starting *letter* + required *length* — reply with a real word matching both\n` +
    `4️⃣ You have *${config.TURN_SECONDS} seconds*. Timeout, wrong word, or a repeat = a strike\n` +
    `5️⃣ *${config.MAX_STRIKES} strikes* and you're eliminated 🚫\n` +
    `6️⃣ Last climber standing wins — or if everyone survives to the top, the *longest word reached* wins 🏆`

async function handlePublicMessage(msgCtx) {
    const {
        sock, games, settings, activeGameChatRef, persistGames, nameCache,
        from, body, rawBody, senderNumber, senderJid, senderName, isAdmin
    } = msgCtx

    const ctx = { sock, games, settings, activeGameChatRef, persistGames, nameCache }
    const gameState = engine.getGameState(from, games)

    // ── Bare "!wcl" = explainer only, NEVER stateful (§9) ────
    if (body === config.PREFIX) {
        await sock.sendMessage(from, { text: HELP_TEXT })
        return true
    }

    if (!body.startsWith(config.PREFIX)) {
        // ── Live guess during an active round ─────────────────
        if (gameState.active && senderNumber === gameState.currentPlayer) {
            const consumed = await engine.submitGuess(from, ctx, senderNumber, rawBody.trim())
            if (consumed) return true
        }
        return false
    }

    const parts = body.split(' ')
    const subCmd = parts[1]

    if (!subCmd || subCmd === 'help') {
        await sock.sendMessage(from, { text: HELP_TEXT })
        return true
    }

    if (subCmd === 'start') {
        const effectivePublicCanStart = resolveSetting('publicCanStart', settings, false)
        if (!isAdmin && !effectivePublicCanStart) {
            await sock.sendMessage(from, {
                text: `🔒 *Game Locked*\nThe admin hasn't enabled public game starts. Only the admin can open a lobby right now.`
            })
            return true
        }

        if (activeGameChatRef.value) {
            if (activeGameChatRef.value === from) {
                await sock.sendMessage(from, { text: `⚠️ A game or lobby is *already active in this chat!* ⏳` })
            } else {
                await sock.sendMessage(from, {
                    text: `⚠️ A game is currently running in another chat. It must end before a new one can start.`
                })
            }
            return true
        }

        gameState.players = []
        gameState.playerNames = {}
        gameState.playerJids = {}
        gameState.lobbyActive = true
        gameState.lobbySecondsLeft = config.LOBBY_SECONDS
        activeGameChatRef.value = from
        persistGames()

        await sock.sendMessage(from, {
            text:
                `${config.DIVIDER}\n` +
                `${config.BOT_EMOJI} *${config.GAME_NAME} is Starting!*\n` +
                `${config.DIVIDER}\n\n` +
                `The climb begins at *${config.MIN_LENGTH} letters* and tops out at *${config.MAX_LENGTH}*.\n\n` +
                `You have *${config.LOBBY_SECONDS} seconds* to join! ⏱️\n\n` +
                `*Commands:*\n` +
                `*${config.PREFIX} join* — Enter the lobby\n` +
                `*${config.PREFIX} begin* — Start early once 2+ have joined\n\n` +
                `_Type *${config.PREFIX} join* now!_ 🔥`
        })

        if (gameState.lobbyTimer) clearInterval(gameState.lobbyTimer)
        gameState.lobbyTimer = setInterval(async () => {
            if (!gameState.lobbyActive) {
                clearInterval(gameState.lobbyTimer)
                return
            }
            gameState.lobbySecondsLeft--
            if (gameState.lobbySecondsLeft <= 0) {
                clearInterval(gameState.lobbyTimer)
                await closeLobbyAndStart(from, ctx, gameState)
            } else if (gameState.lobbySecondsLeft % 10 === 0) {
                const lobbyText = gameState.players
                    .map((num, i) => `${i + 1}. ${nameTag(num, gameState.playerNames, settings)}`)
                    .join('\n')
                await sock.sendMessage(from, {
                    text:
                        `⏱️ *${gameState.lobbySecondsLeft}s* left to join *${config.GAME_NAME}*!\n\n` +
                        `👥 *Lobby:*\n${lobbyText || '[No one yet — be first! 🎯]'}`
                })
            }
            persistGames()
        }, 1000)

        return true
    }

    if (subCmd === 'join') {
        if (!gameState.lobbyActive) {
            await sock.sendMessage(from, { text: `⚠️ No active lobby to join! Type *${config.PREFIX} start* to open one. 🎮` })
            return true
        }
        if (gameState.players.includes(senderNumber)) {
            await sock.sendMessage(from, { text: `⚠️ You're already in the lobby! Sit tight. 🕐` })
            return true
        }
        engine.addToLobby(gameState, senderNumber, senderName, senderJid)
        const lobbyMentions = gameState.players.map(num => resolveJid(num, gameState.playerJids))
        const lobbyText = gameState.players
            .map((num, i) => `${i + 1}. ${nameTag(num, gameState.playerNames, settings)}`)
            .join('\n')
        await sock.sendMessage(from, {
            text:
                `✅ *${nameTag(senderNumber, nameCache, settings)} joined the climb!* 🧗\n\n` +
                `👥 *Lobby:*\n${lobbyText}\n\n` +
                `_Type *${config.PREFIX} join* to hop in!_`,
            mentions: lobbyMentions
        })
        persistGames()
        return true
    }

    if (subCmd === 'begin') {
        if (!gameState.lobbyActive) {
            await sock.sendMessage(from, { text: `⚠️ No active lobby! Type *${config.PREFIX} start* to open one. 🎮` })
            return true
        }
        if (gameState.players.length < 2) {
            await sock.sendMessage(from, { text: `⚠️ Need at least *2 players* to start the climb.` })
            return true
        }
        if (gameState.players.includes(senderNumber) || isAdmin) {
            if (gameState.lobbyTimer) clearInterval(gameState.lobbyTimer)
            await closeLobbyAndStart(from, ctx, gameState)
        }
        return true
    }

    // Unrecognised !wcl subcommand — still "handled" (silently ignored),
    // same convention as HangmanGame.
    return true
}

async function closeLobbyAndStart(chatId, ctx, gameState) {
    const { sock, settings } = ctx
    if (gameState.players.length < 2) {
        gameState.lobbyActive = false
        ctx.activeGameChatRef.value = null
        await sock.sendMessage(chatId, {
            text: `⚠️ Not enough players joined — *${config.GAME_NAME}* lobby closed without a climb.`
        })
        return
    }
    await sock.sendMessage(chatId, {
        text: `🚀 *Lobby closed — the climb begins!* ${gameState.players.length} climbers ready.`
    })
    await engine.startClimb(chatId, ctx)
}

module.exports = { handlePublicMessage }
