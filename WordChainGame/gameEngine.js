// ============================================================
//  WordChainGame/gameEngine.js
//  Pure game-state logic: lobby, turn rotation, word validation,
//  strikes, elimination, adaptive theme-aware acceptance, and
//  the once-per-match auto-difficulty drift.
//  No admin logic, no command-string parsing — that lives in
//  adminCommands.js / publicCommands.js.
// ============================================================

const matchSummary = require('./matchSummary')
const dictionary   = require('./dictionary')
const { nameTag } = require('../permissions')
const { difficultyBadge, themeBadge } = require('./display')
const {
    GAME_KEY, TIER_NAMES, TIER_TABLE, MAX_TIER,
    DRIFT_STRUGGLE_STRIKE_RATE, DRIFT_CRUISE_STRIKE_RATE,
    CHAIN_MILESTONES, LOBBY_SECONDS, PREFIX
} = require('./config')
const { DEFAULT_WORDS } = require('./themeBank')

// A send that can never take down a timer callback with it. setInterval/
// setTimeout bodies aren't covered by index.js's per-message try/catch,
// so every send from inside one is wrapped here (ARCHITECTURE.md §6/§8).
async function safeSend(sock, jid, payload) {
    try {
        await sock.sendMessage(jid, payload)
    } catch (err) {
        console.log(`[WordChain] sendMessage failed for ${jid}:`, err && err.message)
    }
}

// ─── Tier → round config ───────────────────────────────────────
function roundConfigForTier(tier) {
    const clamped = Math.max(0, Math.min(MAX_TIER, tier || 0))
    return { tierIndex: clamped, tierName: TIER_NAMES[clamped], ...TIER_TABLE[clamped] }
}

// Returns the lowercase word list for the currently active theme, or [].
function activeThemeWords(words) {
    const active = (words && words.activeTheme) || 'none'
    if (active === 'none') return []
    const list = words.themes && words.themes[active]
    return Array.isArray(list) ? list.map(w => w.toLowerCase()) : []
}

// ─── getGameState ───────────────────────────────────────────────
// State is stored under a GAME_KEY-prefixed key (not the bare chatId) —
// `games` is shared across every game module (ARCHITECTURE.md §4).
function stateKey(chatId) {
    return `${GAME_KEY}:${chatId}`
}

function getGameState(chatId, games) {
    const key = stateKey(chatId)
    if (!games[key]) {
        games[key] = {
            active:            false,
            lobbyActive:       false,
            lobbyTimer:        null,
            lobbySecondsLeft:  LOBBY_SECONDS,
            turnTimer:         null,
            turnSecondsLeft:   30,
            players:           [],
            playerNames:       {},
            playerJids:        {},
            strikes:           {},
            chain:             [],
            usedWords:         [],
            currentTurnIndex:  0,
            paused:            false,
            tier:              0,     // persists across matches in this chat — the auto-drift memory
            roundMinLength:    3,
            roundTimerSeconds: 30,
            roundMaxStrikes:   4,
            roundTheme:        'none',
            longestWordThisMatch:    '',
            longestWordThisMatchBy: '',
            totalStrikesThisMatch:  0,
            totalTurnsThisMatch:    0,
            milestonesHit:          []
        }
    }
    const gs = games[key]
    if (!gs.strikes)      gs.strikes      = {}
    if (!gs.chain)        gs.chain        = []
    if (!gs.usedWords)    gs.usedWords    = []
    if (!gs.playerJids)   gs.playerJids   = {}
    if (typeof gs.tier !== 'number') gs.tier = 0
    if (!Array.isArray(gs.milestonesHit)) gs.milestonesHit = []
    return gs
}

// ─── Lobby countdown ─────────────────────────────────────────────
function startLobbyCountdown(chatId, ctx) {
    const { sock, games, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    if (gameState.lobbyTimer) clearInterval(gameState.lobbyTimer)

    gameState.lobbyTimer = setInterval(async () => {
        if (!gameState.lobbyActive) {
            clearInterval(gameState.lobbyTimer)
            return
        }

        gameState.lobbySecondsLeft--

        if (gameState.lobbySecondsLeft <= 0) {
            clearInterval(gameState.lobbyTimer)
            await startActualGame(chatId, ctx)
        } else if (gameState.lobbySecondsLeft % 10 === 0) {
            const cfg = roundConfigForTier(gameState.tier)
            const lobbyMentions = gameState.players.map(num => gameState.playerJids[num]).filter(Boolean)
            const lobbyText = gameState.players
                .map((num, i) => `${i + 1}. ${nameTag(num, gameState.playerNames, ctx.settings)}`)
                .join('\n')

            await safeSend(sock, chatId, {
                text:
                    `⏱️ *Word Chain Lobby — Hurry Up!*\n` +
                    `*${gameState.lobbySecondsLeft} seconds* left to join! Type *${PREFIX} join* now.\n` +
                    `🎯 Mode: ${difficultyBadge(cfg.tierName)} _(auto)_\n\n` +
                    `👥 *Current Lobby:*\n${lobbyText || '[No players yet — be first! 🎯]'}`,
                mentions: lobbyMentions
            })
        }
        persistGames()
    }, 1000)
}

// ─── Start actual game ────────────────────────────────────────────
async function startActualGame(chatId, ctx) {
    const { sock, games, settings, words, activeGameChatRef, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    gameState.lobbyActive = false
    if (gameState.lobbyTimer) clearInterval(gameState.lobbyTimer)

    if (gameState.players.length === 0) {
        gameState.active = false
        if (activeGameChatRef.value === chatId) activeGameChatRef.value = null
        persistGames()
        return safeSend(sock, chatId, {
            text: `🚫 *Word Chain Cancelled*\nNo one joined the lobby in time. Type *${PREFIX} start* to open a fresh lobby! 🎮`
        })
    }

    const cfg = roundConfigForTier(gameState.tier)
    gameState.roundMinLength    = cfg.minLength
    gameState.roundTimerSeconds = cfg.timerSeconds
    gameState.roundMaxStrikes   = cfg.maxStrikes
    gameState.roundTheme        = (words && words.activeTheme) || 'none'
    gameState.chain             = []
    gameState.usedWords         = []
    gameState.strikes           = {}
    gameState.currentTurnIndex  = 0
    gameState.active            = true
    gameState.paused            = false
    gameState.longestWordThisMatch    = ''
    gameState.longestWordThisMatchBy  = ''
    gameState.totalStrikesThisMatch   = 0
    gameState.totalTurnsThisMatch     = 0
    gameState.milestonesHit           = []

    const openerNumber = gameState.players[0]
    const openerJid    = gameState.playerJids[openerNumber]
    const themeLine    = themeBadge(gameState.roundTheme)

    await safeSend(sock, chatId, {
        text:
            `🎬 *Lobby Closed — Word Chain is ON!*\n\n` +
            `🎯 *Mode:* ${difficultyBadge(cfg.tierName)} _(auto)_ — words must be *${cfg.minLength}+ letters*\n` +
            (themeLine ? `${themeLine} — themed words are also accepted, on top of regular English words\n` : ``) +
            `⏱️ *${cfg.timerSeconds}s per turn* | 💥 *${cfg.maxStrikes} strikes* and you're out\n\n` +
            `📜 *How it works:* say a real word. The next player must say a NEW word ` +
            `starting with the LAST letter of yours. No repeats!\n\n` +
            `🎯 *${nameTag(openerNumber, gameState.playerNames, settings)}, you open the chain!* Say any word (${cfg.minLength}+ letters) to start. 🔥`,
        mentions: openerJid ? [openerJid] : []
    })

    persistGames()
    startTurnCountdown(chatId, ctx)
}

// ─── Chain board ──────────────────────────────────────────────────
async function sendChainBoard(chatId, actionFeedback = '', ctx) {
    const { sock, games, settings } = ctx
    const gameState = getGameState(chatId, games)
    if (!gameState.active) return

    const currentPlayerNumber = gameState.players[gameState.currentTurnIndex]
    const currentPlayerJid    = gameState.playerJids[currentPlayerNumber]
    const currentPlayerName   = nameTag(currentPlayerNumber, gameState.playerNames, settings)
    const currentStrikes      = gameState.strikes[currentPlayerNumber] || 0

    const lastWord   = gameState.chain.length ? gameState.chain[gameState.chain.length - 1].word : null
    const nextLetter = lastWord ? lastWord.slice(-1).toUpperCase() : null

    let boardText = ''
    if (actionFeedback) boardText += `${actionFeedback}\n\n`

    boardText += `🔗 *Word Chain*\n`
    if (lastWord) {
        boardText += `Last word: *${lastWord.toUpperCase()}* → next word must start with *${nextLetter}*\n`
    } else {
        boardText += `Chain is empty — first word can be anything!\n`
    }
    boardText += `💥 *${currentPlayerName}'s strikes: ${currentStrikes}/${gameState.roundMaxStrikes}*\n\n`
    boardText += `🎯 *Your turn:* ${currentPlayerName}\n`
    boardText += `_⏱️ ${gameState.roundTimerSeconds}s — type a real word, ${gameState.roundMinLength}+ letters, no repeats!_`

    await safeSend(sock, chatId, {
        text: boardText,
        mentions: currentPlayerJid ? [currentPlayerJid] : []
    })

    startTurnCountdown(chatId, ctx)
}

// ─── Turn countdown ───────────────────────────────────────────────
// opts.preserveRemaining=true resumes from gameState.turnSecondsLeft
// instead of resetting to the full duration — used by /wcg resume so a
// pause doesn't hand the current player a free full timer refresh.
function startTurnCountdown(chatId, ctx, opts = {}) {
    const { sock, games, settings, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    if (gameState.turnTimer) clearInterval(gameState.turnTimer)

    if (!opts.preserveRemaining) {
        gameState.turnSecondsLeft = gameState.roundTimerSeconds || 30
    }

    gameState.turnTimer = setInterval(async () => {
        if (!gameState.active || gameState.paused) {
            clearInterval(gameState.turnTimer)
            return
        }

        gameState.turnSecondsLeft--

        const currentPlayerNumber = gameState.players[gameState.currentTurnIndex]
        const currentPlayerJid    = gameState.playerJids[currentPlayerNumber]
        const currentPlayerName   = nameTag(currentPlayerNumber, gameState.playerNames, settings)

        if (gameState.turnSecondsLeft <= 0) {
            clearInterval(gameState.turnTimer)
            await applyStrike(chatId, currentPlayerNumber, `⏰ *Timeout!* ${currentPlayerName} ran out of time.`, ctx)
        } else if (gameState.turnSecondsLeft === 10) {
            await safeSend(sock, chatId, {
                text: `⏱️ *${currentPlayerName}, 10 seconds left!* 🤔`,
                mentions: currentPlayerJid ? [currentPlayerJid] : []
            })
        } else if (gameState.turnSecondsLeft === 5) {
            await safeSend(sock, chatId, {
                text: `🚨 *${currentPlayerName} — 5 seconds! GO!* ⚡`,
                mentions: currentPlayerJid ? [currentPlayerJid] : []
            })
        }

        persistGames()
    }, 1000)
}

// ─── Once-per-match auto-difficulty drift ──────────────────────────
// Evaluated when a match ends, not per turn — Word Chain's natural
// difficulty unit is a whole match (many turns), unlike the math games.
function driftTierForNextMatch(gameState) {
    const turns = gameState.totalTurnsThisMatch
    if (turns === 0) return { changed: false }

    const strikeRate = gameState.totalStrikesThisMatch / turns
    const before = gameState.tier

    if (strikeRate > DRIFT_STRUGGLE_STRIKE_RATE) {
        gameState.tier = Math.max(0, gameState.tier - 1)
    } else if (strikeRate < DRIFT_CRUISE_STRIKE_RATE) {
        gameState.tier = Math.min(MAX_TIER, gameState.tier + 1)
    }

    return { changed: gameState.tier !== before, from: before, to: gameState.tier, strikeRate }
}

// ─── Milestones ───────────────────────────────────────────────────
async function checkChainMilestone(chatId, gameState, ctx) {
    const hit = CHAIN_MILESTONES.find(m =>
        gameState.chain.length === m.length && !gameState.milestonesHit.includes(m.length)
    )
    if (!hit) return
    gameState.milestonesHit.push(hit.length)
    await safeSend(ctx.sock, chatId, { text: hit.text })
}

// ─── End-of-match wrapper — drifts tier, then delegates to matchSummary ──
async function endMatch(chatId, gameState, ctx, resultInfo) {
    const drift = driftTierForNextMatch(gameState)
    await matchSummary.sendMatchReport(
        ctx.sock, chatId, gameState, resultInfo,
        (n) => nameTag(n, gameState.playerNames, ctx.settings),
        drift
    )
}

// ─── Apply a strike and handle elimination ─────────────────────────
async function applyStrike(chatId, playerNumber, reasonText, ctx) {
    const { sock, games, settings, activeGameChatRef, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    gameState.strikes[playerNumber] = (gameState.strikes[playerNumber] || 0) + 1
    gameState.totalStrikesThisMatch++
    gameState.totalTurnsThisMatch++
    const strikeCount = gameState.strikes[playerNumber]
    const removedIndex = gameState.currentTurnIndex

    if (strikeCount >= gameState.roundMaxStrikes) {
        matchSummary.recordStrikeOut(gameState, playerNumber)
        if (gameState.players.includes(playerNumber)) {
            gameState.players.splice(gameState.players.indexOf(playerNumber), 1)
        }
        delete gameState.playerJids[playerNumber]
        delete gameState.strikes[playerNumber]

        const dqText = `${reasonText}\n\n🚫 *Eliminated!* ${nameTag(playerNumber, gameState.playerNames, settings)} used all *${gameState.roundMaxStrikes}* strikes. 💀`

        const lastStanding = matchSummary.checkLastPlayerStanding(gameState)
        if (lastStanding) {
            gameState.active = false
            if (activeGameChatRef.value === chatId) activeGameChatRef.value = null
            await safeSend(sock, chatId, { text: `${dqText}\n\n🏆 *LAST PLAYER STANDING!*` })
            await endMatch(chatId, gameState, ctx, { type: 'winner', winnerNumber: lastStanding })
            persistGames()
            return
        }

        if (gameState.players.length === 0) {
            gameState.active = false
            if (activeGameChatRef.value === chatId) activeGameChatRef.value = null
            await safeSend(sock, chatId, { text: `${dqText}\n\n💀 *GAME OVER!* No players remain.` })
            await endMatch(chatId, gameState, ctx, { type: 'solo_end' })
            persistGames()
            return
        }

        gameState.currentTurnIndex = removedIndex % gameState.players.length
        await sendChainBoard(chatId, dqText, ctx)
        return
    }

    const nextTurnIndex = (gameState.currentTurnIndex + 1) % gameState.players.length
    gameState.currentTurnIndex = nextTurnIndex
    const feedback = `${reasonText}\n_(${strikeCount}/${gameState.roundMaxStrikes} strikes)_`
    await sendChainBoard(chatId, feedback, ctx)
}

// ─── Word submission — the core validation pipeline ────────────────
async function processWordSubmission(chatId, senderNumber, rawWord, ctx) {
    const { games, settings, words, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    if (!gameState.active || gameState.paused) return

    const currentPlayerNumber = gameState.players[gameState.currentTurnIndex]
    if (senderNumber !== currentPlayerNumber) return // not their turn — ignore silently

    if (gameState.turnTimer) clearInterval(gameState.turnTimer)

    const word = (rawWord || '').trim().toLowerCase()
    const currentPlayerName = nameTag(senderNumber, gameState.playerNames, settings)
    const lastEntry = gameState.chain.length ? gameState.chain[gameState.chain.length - 1] : null
    const requiredLetter = lastEntry ? lastEntry.word.slice(-1) : null

    if (!/^[a-z]+$/.test(word)) {
        return applyStrike(chatId, senderNumber, `❌ *${currentPlayerName}* — that's not a single word.`, ctx)
    }
    if (word.length < gameState.roundMinLength) {
        return applyStrike(chatId, senderNumber, `❌ *${currentPlayerName}* — *${word.toUpperCase()}* is too short (needs ${gameState.roundMinLength}+ letters).`, ctx)
    }
    if (requiredLetter && word[0] !== requiredLetter) {
        return applyStrike(chatId, senderNumber, `❌ *${currentPlayerName}* — *${word.toUpperCase()}* must start with *${requiredLetter.toUpperCase()}*.`, ctx)
    }
    if (gameState.usedWords.includes(word)) {
        return applyStrike(chatId, senderNumber, `❌ *${currentPlayerName}* — *${word.toUpperCase()}* was already used in this chain.`, ctx)
    }
    const themeWords = activeThemeWords(words)
    if (!dictionary.isAcceptedWord(word, themeWords)) {
        return applyStrike(chatId, senderNumber, `❌ *${currentPlayerName}* — *${word.toUpperCase()}* isn't a recognized word.`, ctx)
    }

    // ── Accepted ──
    gameState.chain.push({ word, playerNumber: senderNumber })
    gameState.usedWords.push(word)
    gameState.strikes[senderNumber] = 0
    gameState.totalTurnsThisMatch++

    if (word.length > gameState.longestWordThisMatch.length) {
        gameState.longestWordThisMatch   = word
        gameState.longestWordThisMatchBy = senderNumber
    }

    const nextTurnIndex = (gameState.currentTurnIndex + 1) % gameState.players.length
    gameState.currentTurnIndex = nextTurnIndex

    const themeNote = (themeWords.includes(word) && !dictionary.isRealWord(word)) ? ' 🎨' : ''
    const feedback = `✅ *${currentPlayerName}* played *${word.toUpperCase()}*!${themeNote} 🟢`
    persistGames()

    await checkChainMilestone(chatId, gameState, ctx)
    await sendChainBoard(chatId, feedback, ctx)
}

module.exports = {
    DEFAULT_WORDS,
    stateKey,
    roundConfigForTier,
    activeThemeWords,
    getGameState,
    startLobbyCountdown,
    startActualGame,
    sendChainBoard,
    startTurnCountdown,
    processWordSubmission,
    applyStrike,
    driftTierForNextMatch,
    endMatch,
    safeSend
}
