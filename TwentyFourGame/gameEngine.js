// ============================================================
//  gameEngine.js — The 24 Game (M4T) · Sky Graphics
//  Pure game-state logic: sessions, rounds, scoring, adaptive
//  difficulty drift, cooldown + auto-restart. No command parsing
//  lives here — see publicCommands.js / adminCommands.js.
// ============================================================

const config = require('./config')
const numberBank = require('./numberBank')
const solver = require('./solver')
const matchSummary = require('./matchSummary')
const { nameTag, resolveSetting } = require('../permissions')

// ─── Per-chat settings (admin-overridable, stored under settings.m4th) ──
function getM4thSettings(settings) {
    const s = (settings && settings.m4th) || {}
    return {
        roundSeconds:      Number.isInteger(s.roundSeconds)      ? s.roundSeconds      : config.ROUND_SECONDS_DEFAULT,
        cooldownSeconds:   Number.isInteger(s.cooldownSeconds)   ? s.cooldownSeconds   : config.COOLDOWN_SECONDS_DEFAULT,
        roundsPerSession:  s.roundsPerSession === 'infinite' ? 'infinite'
                            : Number.isInteger(s.roundsPerSession) ? s.roundsPerSession : config.ROUNDS_PER_SESSION_DEFAULT,
        sessionCooldown:   Number.isInteger(s.sessionCooldown)   ? s.sessionCooldown   : config.SESSION_COOLDOWN_SECONDS
    }
}

// ─── getGameState ─────────────────────────────────────────────
/**
 * Returns (and lazily creates) the game state for a chat. Required export
 * per the plugin contract — index.js calls this generically.
 */
function getGameState(chatId, games) {
    if (!games[chatId]) games[chatId] = {}
    if (!games[chatId].m4th) {
        games[chatId].m4th = {
            active:        false,   // a session is running (accepting joins/guesses)
            roundActive:   false,   // a round is currently open for guesses
            tier:          config.START_TIER,
            currentNumbers: [],
            roundTimer:    null,
            cooldownTimer: null,
            roundSecondsLeft: 0,
            roundStartTs:  0,
            roundsPlayed:  0,
            scores:        {},   // { [senderNumber]: points }
            playerNames:   {},
            playerJids:    {},
            fastestSolveMs: null,
            fastestSolveBy: null,
            hintGivenThisRound: false
        }
    }
    return games[chatId].m4th
}

function clearTimers(gameState) {
    if (gameState.roundTimer)    clearInterval(gameState.roundTimer)
    if (gameState.cooldownTimer) clearTimeout(gameState.cooldownTimer)
    gameState.roundTimer = null
    gameState.cooldownTimer = null
}

function tierBadge(tier) {
    return { easy: '🟢 Easy', normal: '🟡 Normal', difficult: '🔴 Difficult' }[tier] || tier
}

// ─── Session lifecycle ─────────────────────────────────────────
async function startSession(chatId, ctx, { auto = false } = {}) {
    const { sock, games, activeGameChatRef, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    if (gameState.active) {
        if (!auto) {
            await sock.sendMessage(chatId, { text: `⚠️ A *${config.GAME_NAME}* session is already running here. Type *${config.PREFIX} stop* to end it first.` })
        }
        return
    }

    if (activeGameChatRef.value && activeGameChatRef.value !== chatId) {
        if (!auto) {
            await sock.sendMessage(chatId, { text: `🚫 Another game is currently active in a different chat. Try again shortly.` })
        }
        return
    }

    gameState.active       = true
    gameState.roundActive  = false
    gameState.tier         = config.START_TIER
    gameState.roundsPlayed = 0
    gameState.scores       = {}
    gameState.playerNames  = {}
    gameState.playerJids   = {}
    gameState.fastestSolveMs = null
    gameState.fastestSolveBy = null
    activeGameChatRef.value = chatId
    persistGames()

    if (auto) {
        await sock.sendMessage(chatId, { text: `🔁 *New ${config.GAME_NAME} session starting!*` })
    } else {
        await sock.sendMessage(chatId, {
            text:
                `🧮 *${config.GAME_NAME} (${config.GAME_ACRONYM})*\n` +
                `Combine all 4 numbers with \`+ − × ÷\` (any order, any grouping) to make exactly *24*.\n` +
                `First correct answer wins the round! Just type your equation — no prefix needed once a round is live.\n\n` +
                `_Commands: ${config.PREFIX} scores · ${config.PREFIX} hint · ${config.PREFIX} help_`
        })
    }

    await startRound(chatId, ctx)
}

async function stopSession(chatId, ctx, reason = 'manual') {
    const { sock, games, activeGameChatRef, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    if (!gameState.active) return

    clearTimers(gameState)
    gameState.active      = false
    gameState.roundActive = false
    if (activeGameChatRef.value === chatId) activeGameChatRef.value = null
    persistGames()

    await matchSummary.sendSessionReport(sock, chatId, gameState, (n) => nameTag(n, gameState.playerNames, ctx.settings), reason)

    if (reason === 'rounds_complete') {
        scheduleAutoRestart(chatId, ctx)
    }
}

function scheduleAutoRestart(chatId, ctx) {
    const { sock, games } = ctx
    const gameState = getGameState(chatId, games)
    const { sessionCooldown } = getM4thSettings(ctx.settings)

    sock.sendMessage(chatId, {
        text: `⏱️ Next *${config.GAME_NAME}* session auto-starts in *${sessionCooldown}s* — grab a rematch! Type *${config.PREFIX} stop* any time after it starts to opt out.`
    }).catch(() => {})

    gameState.cooldownTimer = setTimeout(() => {
        startSession(chatId, ctx, { auto: true }).catch(() => {})
    }, sessionCooldown * 1000)
}

// ─── Round lifecycle ────────────────────────────────────────────
async function startRound(chatId, ctx) {
    const { sock, games, settings, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    const { roundSeconds } = getM4thSettings(settings)

    const tierKey = config.TIERS[gameState.tier]
    gameState.currentNumbers = numberBank.generatePuzzle(tierKey)
    gameState.roundActive    = true
    gameState.roundStartTs   = Date.now()
    gameState.roundSecondsLeft = roundSeconds
    gameState.hintGivenThisRound = false
    persistGames()

    await sock.sendMessage(chatId, {
        text:
            `🎲 *Round ${gameState.roundsPlayed + 1}* — ${tierBadge(tierKey)}\n` +
            `Numbers: *${gameState.currentNumbers.join('  ·  ')}*\n` +
            `Make *24*! ⏱️ ${roundSeconds}s — first correct equation wins.`
    })

    if (gameState.roundTimer) clearInterval(gameState.roundTimer)
    gameState.roundTimer = setInterval(async () => {
        if (!gameState.roundActive) { clearInterval(gameState.roundTimer); return }
        gameState.roundSecondsLeft--

        if (gameState.roundSecondsLeft <= 0) {
            clearInterval(gameState.roundTimer)
            await handleRoundTimeout(chatId, ctx)
        } else if (gameState.roundSecondsLeft === 5) {
            await sock.sendMessage(chatId, { text: `🚨 *5 seconds left!* (${gameState.currentNumbers.join(', ')})` })
        }
        persistGames()
    }, 1000)
}

function adjustTier(gameState, { solvedFast }) {
    if (solvedFast) {
        gameState.tier = Math.min(config.MAX_TIER, gameState.tier + 1)
    } else {
        gameState.tier = Math.max(config.MIN_TIER, gameState.tier - 1)
    }
}

async function advanceAfterRound(chatId, ctx) {
    const { games, settings } = ctx
    const gameState = getGameState(chatId, games)
    gameState.roundsPlayed++

    const { roundsPerSession, cooldownSeconds } = getM4thSettings(settings)
    if (roundsPerSession !== 'infinite' && gameState.roundsPlayed >= roundsPerSession) {
        await stopSession(chatId, ctx, 'rounds_complete')
        return
    }

    gameState.roundActive = false
    ctx.persistGames()
    gameState.cooldownTimer = setTimeout(() => {
        startRound(chatId, ctx).catch(() => {})
    }, cooldownSeconds * 1000)
}

async function handleRoundTimeout(chatId, ctx) {
    const { sock, games } = ctx
    const gameState = getGameState(chatId, games)
    gameState.roundActive = false

    const example = solver.findSolution(gameState.currentNumbers).expression
    await sock.sendMessage(chatId, {
        text:
            `⏰ *Time's up!* Nobody hit 24 with *${gameState.currentNumbers.join(', ')}*.\n` +
            (example ? `💡 One way: \`${example}\`\n` : '') +
            `Next round in a few seconds...`
    })

    adjustTier(gameState, { solvedFast: false })
    await advanceAfterRound(chatId, ctx)
}

/**
 * Called by publicCommands.js for any non-prefixed message while a round
 * is live. Returns true if the message was consumed as a (correct or
 * incorrect) guess attempt, false if it should be ignored/passed through.
 */
async function handleGuessAttempt(chatId, text, sender, ctx) {
    const { sock, games, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    if (!gameState.active || !gameState.roundActive) return false
    if (!solver.looksLikeExpression(text)) return false

    const { senderNumber, senderJid, senderName } = sender
    const validation = solver.validateSolution(text, gameState.currentNumbers)

    if (!validation.valid) {
        if (validation.reason === 'wrong_numbers') {
            await sock.sendMessage(chatId, { text: `❌ Use exactly *${gameState.currentNumbers.join(', ')}*, each once.` })
        } else if (validation.reason === 'wrong_result') {
            await sock.sendMessage(chatId, { text: `❌ That's ${validation.result}, not 24. Try again!` })
        }
        return true
    }

    // Correct! Stop the clock immediately.
    gameState.roundActive = false
    if (gameState.roundTimer) clearInterval(gameState.roundTimer)

    const elapsedMs = Date.now() - gameState.roundStartTs
    gameState.playerNames[senderNumber] = senderName
    gameState.playerJids[senderNumber]  = senderJid
    gameState.scores[senderNumber] = (gameState.scores[senderNumber] || 0) + 1

    if (gameState.fastestSolveMs === null || elapsedMs < gameState.fastestSolveMs) {
        gameState.fastestSolveMs = elapsedMs
        gameState.fastestSolveBy = senderNumber
    }

    const roundSecondsConfigured = getM4thSettings(ctx.settings).roundSeconds
    const solvedFast = elapsedMs < roundSecondsConfigured * 1000 * config.SOLVE_FAST_RATIO

    await sock.sendMessage(chatId, {
        text:
            `✅ *${nameTag(senderNumber, gameState.playerNames, ctx.settings)}* got it in ${(elapsedMs / 1000).toFixed(1)}s!\n` +
            `\`${text.trim()} = 24\` 🎉\n` +
            `🏅 Score: ${gameState.scores[senderNumber]}`,
        mentions: senderJid ? [senderJid] : []
    })

    adjustTier(gameState, { solvedFast })
    persistGames()
    await advanceAfterRound(chatId, ctx)
    return true
}

// ─── Hints ──────────────────────────────────────────────────────
/**
 * Reveals only the innermost first step of one valid solution (e.g. "3 + 1"),
 * never the full expression — called by publicCommands.js for "!m4th hint".
 * One hint per round; asking again just repeats the same hint rather than
 * escalating, so a round can't be trivially solved via repeated hinting.
 */
function getHint(chatId, ctx) {
    const { games } = ctx
    const gameState = getGameState(chatId, games)
    if (!gameState.active || !gameState.roundActive) return { ok: false, reason: 'no_round' }

    const solution = solver.findSolution(gameState.currentNumbers)
    if (!solution.solvable) return { ok: false, reason: 'no_solution' }

    const match = solution.expression.match(/\(\s*-?\d+(?:\.\d+)?\s*[+\-*/]\s*-?\d+(?:\.\d+)?\s*\)/)
    const step = match ? match[0].replace(/[()]/g, '').trim() : null
    const alreadyGiven = !!gameState.hintGivenThisRound

    gameState.hintGivenThisRound = true
    ctx.persistGames()
    return { ok: true, step, alreadyGiven }
}

module.exports = {
    getGameState,
    getM4thSettings,
    startSession,
    stopSession,
    startRound,
    handleGuessAttempt,
    getHint,
    tierBadge
}
