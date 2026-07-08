// ============================================================
//  WordChainGame/gameEngine.js
//  Pure game-state logic: lobby, turn rotation, word validation,
//  strikes, elimination, adaptive theme-aware acceptance, and
//  automatic per-chat difficulty drift. No admin logic, no
//  command-string parsing here — that lives in adminCommands.js /
//  publicCommands.js.
// ============================================================

const matchSummary = require('./matchSummary')
const dictionary   = require('./dictionary')
const { nameTag, resolveSetting } = require('../permissions')
const { difficultyBadge, themeBadge } = require('./display')
const {
    GAME_KEY, TIERS, TIER_CONFIG, MIN_TIER, MAX_TIER, START_TIER,
    MIN_TIMER_SECONDS, STRIKE_RATE_EASIER_ABOVE, STRIKE_RATE_HARDER_BELOW,
    CHAIN_MILESTONES, LOBBY_SECONDS, PREFIX
} = require('./config')
const { DEFAULT_WORDS } = require('./themeBank')

// ─── Tier resolution (fully automatic — see README "Adaptive difficulty") ──
function tierConfigFor(tierIndex) {
    const key = TIERS[tierIndex] || TIERS[START_TIER]
    const base = TIER_CONFIG[key] || TIER_CONFIG.easy
    return {
        tierKey: key,
        minLength: base.minLength,
        timerSeconds: Math.max(MIN_TIMER_SECONDS, base.timerSeconds),
        maxStrikes: base.maxStrikes
    }
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
// the `games` object is shared across every game module.
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
            roundMinLength:    3,
            roundTimerSeconds: 30,
            roundMaxStrikes:   TIER_CONFIG.easy.maxStrikes,
            roundTheme:        'none',
            longestWordThisMatch:   '',
            longestWordThisMatchBy: '',
            hintGivenThisTurn: false,
            nextMilestoneIndex: 0,
            // Adaptive difficulty — persists across matches in this chat so
            // each group settles at its own level over time. Only reset by
            // an explicit /wcg reset, never by a normal match ending.
            tier: START_TIER,
            totalStrikesThisMatch: 0,
            totalTurnsThisMatch: 0
        }
    }
    if (!games[key].strikes)    games[key].strikes    = {}
    if (!games[key].chain)      games[key].chain      = []
    if (!games[key].usedWords)  games[key].usedWords  = []
    if (!games[key].playerJids) games[key].playerJids = {}
    if (!Number.isInteger(games[key].tier)) games[key].tier = START_TIER
    return games[key]
}

function safeClearActiveRef(activeGameChatRef, chatId) {
    if (activeGameChatRef.value === chatId) activeGameChatRef.value = null
}

// ─── Lobby countdown ─────────────────────────────────────────────
function startLobbyCountdown(chatId, ctx) {
    const { sock, games, settings, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    if (gameState.lobbyTimer) clearInterval(gameState.lobbyTimer)

    gameState.lobbyTimer = setInterval(async () => {
        try {
            if (!gameState.lobbyActive) {
                clearInterval(gameState.lobbyTimer)
                return
            }

            gameState.lobbySecondsLeft--

            if (gameState.lobbySecondsLeft <= 0) {
                clearInterval(gameState.lobbyTimer)
                await startActualGame(chatId, ctx)
            } else if (gameState.lobbySecondsLeft % 10 === 0) {
                const tierKey = tierConfigFor(gameState.tier).tierKey
                const lobbyMentions = gameState.players.map(num => gameState.playerJids[num]).filter(Boolean)
                const lobbyText = gameState.players
                    .map((num, i) => `${i + 1}. ${nameTag(num, gameState.playerNames, settings)}`)
                    .join('\n')

                await sock.sendMessage(chatId, {
                    text:
                        `⏱️ *Word Chain Lobby — Hurry Up!*\n` +
                        `*${gameState.lobbySecondsLeft} seconds* left to join! Type *${PREFIX} join* now.\n` +
                        `🎯 Mode: ${difficultyBadge(tierKey)} _(auto — adjusts to this group over time)_\n\n` +
                        `👥 *Current Lobby:*\n${lobbyText || '[No players yet — be first! 🎯]'}`,
                    mentions: lobbyMentions
                })
            }
            persistGames()
        } catch (err) {
            console.error('[WordChain] lobby timer error:', err)
            clearInterval(gameState.lobbyTimer)
        }
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
        safeClearActiveRef(activeGameChatRef, chatId)
        persistGames()
        return await sock.sendMessage(chatId, {
            text: `🚫 *Word Chain Cancelled*\nNo one joined the lobby in time. Type *${PREFIX} start* to open a fresh lobby! 🎮`
        })
    }

    const cfg = tierConfigFor(gameState.tier)
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
    gameState.longestWordThisMatch   = ''
    gameState.longestWordThisMatchBy = ''
    gameState.hintGivenThisTurn = false
    gameState.nextMilestoneIndex = 0
    gameState.totalStrikesThisMatch = 0
    gameState.totalTurnsThisMatch = 0

    const openerNumber = gameState.players[0]
    const openerJid    = gameState.playerJids[openerNumber]
    const themeLine    = themeBadge(gameState.roundTheme)

    await sock.sendMessage(chatId, {
        text:
            `🎬 *Lobby Closed — Word Chain is ON!*\n\n` +
            `🎯 *Mode:* ${difficultyBadge(cfg.tierKey)} _(auto)_ — words must be *${cfg.minLength}+ letters*\n` +
            (themeLine ? `${themeLine} — themed words are also accepted, on top of regular English words\n` : ``) +
            `⏱️ *${cfg.timerSeconds}s per turn* | 💥 *${cfg.maxStrikes} strikes* and you're out\n\n` +
            `📜 *How it works:* say a real word. The next player must say a NEW word ` +
            `starting with the LAST letter of yours. No repeats!\n` +
            `💡 Stuck? Type *${PREFIX} hint* on your turn for a nudge. Type *${PREFIX} scores* any time to check the board.\n\n` +
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
    boardText += `_⏱️ ${gameState.roundTimerSeconds}s — type a real word, ${gameState.roundMinLength}+ letters, no repeats! (${PREFIX} hint if stuck)_`

    await sock.sendMessage(chatId, {
        text: boardText,
        mentions: currentPlayerJid ? [currentPlayerJid] : []
    })

    gameState.hintGivenThisTurn = false
    startTurnCountdown(chatId, ctx)
}

// ─── Turn countdown ───────────────────────────────────────────────
// resume:true preserves gameState.turnSecondsLeft instead of resetting it
// to the full round duration — used by /wcg resume so a pause can't be
// used to refresh a player's clock for free.
function startTurnCountdown(chatId, ctx, { resume = false } = {}) {
    const { sock, games, settings, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    if (gameState.turnTimer) clearInterval(gameState.turnTimer)

    if (!resume) {
        gameState.turnSecondsLeft = gameState.roundTimerSeconds || 30
    }

    gameState.turnTimer = setInterval(async () => {
        try {
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
                await sock.sendMessage(chatId, {
                    text: `⏱️ *${currentPlayerName}, 10 seconds left!* 🤔`,
                    mentions: currentPlayerJid ? [currentPlayerJid] : []
                })
            } else if (gameState.turnSecondsLeft === 5) {
                await sock.sendMessage(chatId, {
                    text: `🚨 *${currentPlayerName} — 5 seconds! GO!* ⚡`,
                    mentions: currentPlayerJid ? [currentPlayerJid] : []
                })
            }

            persistGames()
        } catch (err) {
            console.error('[WordChain] turn timer error:', err)
            clearInterval(gameState.turnTimer)
        }
    }, 1000)
}

// ─── Adaptive drift — runs once, when a match actually ends ────────
function applyAdaptiveDrift(gameState) {
    const turns = gameState.totalTurnsThisMatch
    if (turns <= 0) return // nobody took a turn (e.g. instant admin stop) — no signal, leave tier alone

    const strikeRate = gameState.totalStrikesThisMatch / turns
    if (strikeRate > STRIKE_RATE_EASIER_ABOVE) {
        gameState.tier = Math.max(MIN_TIER, gameState.tier - 1)
    } else if (strikeRate < STRIKE_RATE_HARDER_BELOW) {
        gameState.tier = Math.min(MAX_TIER, gameState.tier + 1)
    }
}

async function endMatch(chatId, ctx, resultInfo) {
    const { sock, games, settings, activeGameChatRef, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    applyAdaptiveDrift(gameState)
    gameState.active = false
    safeClearActiveRef(activeGameChatRef, chatId)

    await matchSummary.sendMatchReport(sock, chatId, gameState, resultInfo, (n) => nameTag(n, gameState.playerNames, settings))
    persistGames()
}

// ─── Apply a strike and handle elimination ─────────────────────────
async function applyStrike(chatId, playerNumber, reasonText, ctx) {
    const { sock, games, settings } = ctx
    const gameState = getGameState(chatId, games)

    gameState.totalTurnsThisMatch++
    gameState.totalStrikesThisMatch++
    gameState.strikes[playerNumber] = (gameState.strikes[playerNumber] || 0) + 1
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
            await sock.sendMessage(chatId, { text: `${dqText}\n\n🏆 *LAST PLAYER STANDING!*` })
            await endMatch(chatId, ctx, { type: 'winner', winnerNumber: lastStanding })
            return
        }

        if (gameState.players.length === 0) {
            await sock.sendMessage(chatId, { text: `${dqText}\n\n💀 *GAME OVER!* No players remain.` })
            await endMatch(chatId, ctx, { type: 'solo_end' })
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

// ─── Milestone celebration (engagement) ─────────────────────────────
function milestoneLineIfAny(gameState) {
    const nextMilestone = CHAIN_MILESTONES[gameState.nextMilestoneIndex]
    if (nextMilestone && gameState.chain.length >= nextMilestone) {
        gameState.nextMilestoneIndex++
        return `\n\n🎉 *${nextMilestone}-word chain!* This group is on fire.`
    }
    return ''
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
    gameState.totalTurnsThisMatch++
    gameState.chain.push({ word, playerNumber: senderNumber })
    gameState.usedWords.push(word)
    gameState.strikes[senderNumber] = 0

    if (word.length > gameState.longestWordThisMatch.length) {
        gameState.longestWordThisMatch   = word
        gameState.longestWordThisMatchBy = senderNumber
    }

    const nextTurnIndex = (gameState.currentTurnIndex + 1) % gameState.players.length
    gameState.currentTurnIndex = nextTurnIndex

    const themeNote = (themeWords.includes(word) && !dictionary.isRealWord(word)) ? ' 🎨' : ''
    const feedback = `✅ *${currentPlayerName}* played *${word.toUpperCase()}*!${themeNote} 🟢${milestoneLineIfAny(gameState)}`
    persistGames()
    await sendChainBoard(chatId, feedback, ctx)
}

// ─── Hint (player-facing, once per turn — see COMMAND_CONTROL.md) ──
// Reveals only a fragment: the required starting letter's word LENGTH
// and its first two letters from one real dictionary candidate that
// hasn't been used yet — never the full word.
function getHint(chatId, ctx) {
    const { games, words } = ctx
    const gameState = getGameState(chatId, games)
    if (!gameState.active || gameState.paused) return { ok: false, reason: 'no_round' }
    if (gameState.hintGivenThisTurn) return { ok: false, reason: 'already_given' }

    const lastEntry = gameState.chain.length ? gameState.chain[gameState.chain.length - 1] : null
    const requiredLetter = lastEntry ? lastEntry.word.slice(-1) : null
    const themeWords = activeThemeWords(words)
    const candidate = dictionary.findHintCandidate(requiredLetter, gameState.roundMinLength, gameState.usedWords, themeWords)

    if (!candidate) return { ok: false, reason: 'no_candidate' }

    gameState.hintGivenThisTurn = true
    ctx.persistGames()
    return { ok: true, length: candidate.length, prefix: candidate.slice(0, 2).toUpperCase(), requiredLetter }
}

module.exports = {
    DEFAULT_WORDS,
    tierConfigFor,
    activeThemeWords,
    getGameState,
    stateKey,
    startLobbyCountdown,
    startActualGame,
    sendChainBoard,
    startTurnCountdown,
    processWordSubmission,
    applyAdaptiveDrift,
    endMatch,
    getHint,
    safeClearActiveRef
}
