// ============================================================
//  gameEngine.js — Target Numbers (TGT) · Sky Graphics
//  Pure game-state logic: sessions, rounds, scoring, adaptive
//  difficulty drift, cooldown + auto-restart. No command parsing
//  lives here — see publicCommands.js / adminCommands.js.
// ============================================================

const config = require('./config')
const numberBank = require('./numberBank')
const solver = require('./solver')
const matchSummary = require('./matchSummary')
const { nameTag, resolveSetting } = require('../permissions')

function getTgtSettings(settings) {
    const s = (settings && settings.target) || {}
    return {
        roundSeconds:      Number.isInteger(s.roundSeconds)      ? s.roundSeconds      : config.ROUND_SECONDS_DEFAULT,
        cooldownSeconds:   Number.isInteger(s.cooldownSeconds)   ? s.cooldownSeconds   : config.COOLDOWN_SECONDS_DEFAULT,
        roundsPerSession:  s.roundsPerSession === 'infinite' ? 'infinite'
                            : Number.isInteger(s.roundsPerSession) ? s.roundsPerSession : config.ROUNDS_PER_SESSION_DEFAULT,
        sessionCooldown:   Number.isInteger(s.sessionCooldown)   ? s.sessionCooldown   : config.SESSION_COOLDOWN_SECONDS
    }
}

function getGameState(chatId, games) {
    if (!games[chatId]) games[chatId] = {}
    if (!games[chatId].target) {
        games[chatId].target = {
            active:        false,
            roundActive:   false,
            tier:          config.START_TIER,
            currentNumbers: [],
            currentTarget: 0,
            roundTimer:    null,
            cooldownTimer: null,
            roundSecondsLeft: 0,
            roundStartTs:  0,
            roundsPlayed:  0,
            scores:        {},
            playerNames:   {},
            playerJids:    {},
            bestSolveDiff: null,
            bestSolveBy:   null,
            hintGivenThisRound: false,
            submissions:   []   // [{ senderNumber, value, diff, expr, ts }] — this round only
        }
    }
    return games[chatId].target
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
        if (!auto) await sock.sendMessage(chatId, { text: `⚠️ A *${config.GAME_NAME}* session is already running here. Ask an admin to run *${config.ADMIN_PREFIX}stop* first.` })
        return
    }
    if (activeGameChatRef.value && activeGameChatRef.value !== chatId) {
        if (!auto) await sock.sendMessage(chatId, { text: `🚫 Another game is currently active in a different chat. Try again shortly.` })
        return
    }

    gameState.active       = true
    gameState.roundActive  = false
    gameState.tier         = config.START_TIER
    gameState.roundsPlayed = 0
    gameState.scores       = {}
    gameState.playerNames  = {}
    gameState.playerJids   = {}
    gameState.bestSolveDiff = null
    gameState.bestSolveBy   = null
    activeGameChatRef.value = chatId
    persistGames()

    if (auto) {
        await sock.sendMessage(chatId, { text: `🔁 *New ${config.GAME_NAME} session starting!*` })
    } else {
        await sock.sendMessage(chatId, {
            text:
                `🎯 *${config.GAME_NAME} (${config.GAME_ACRONYM})*\n` +
                `Each round: 6 numbers + a 3-digit target. Combine any of the numbers with \`+ − × ÷\` ` +
                `(don't have to use them all, each used once, every step must stay a positive whole number) to hit the target.\n` +
                `🎯 Exact = ${config.SCORE_EXACT}pts · within 5 = ${config.SCORE_WITHIN_5}pts · within 10 = ${config.SCORE_WITHIN_10}pts.\n` +
                `An exact hit ends the round instantly — otherwise the closest submission wins when time's up!\n\n` +
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

    if (reason === 'rounds_complete') scheduleAutoRestart(chatId, ctx)
}

function scheduleAutoRestart(chatId, ctx) {
    const { sock, games } = ctx
    const gameState = getGameState(chatId, games)
    const { sessionCooldown } = getTgtSettings(ctx.settings)

    sock.sendMessage(chatId, {
        text: `⏱️ Next *${config.GAME_NAME}* session auto-starts in *${sessionCooldown}s* — grab a rematch!`
    }).catch(() => {})

    gameState.cooldownTimer = setTimeout(() => {
        startSession(chatId, ctx, { auto: true }).catch(() => {})
    }, sessionCooldown * 1000)
}

// ─── Round lifecycle ────────────────────────────────────────────
async function startRound(chatId, ctx) {
    const { sock, games, settings, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    const { roundSeconds } = getTgtSettings(settings)

    const tierKey = config.TIERS[gameState.tier]
    const puzzle = numberBank.generatePuzzle(tierKey)
    gameState.currentNumbers = puzzle.numbers
    gameState.currentTarget  = puzzle.target
    gameState.roundActive    = true
    gameState.roundStartTs   = Date.now()
    gameState.roundSecondsLeft = roundSeconds
    gameState.hintGivenThisRound = false
    gameState.submissions    = []
    persistGames()

    await sock.sendMessage(chatId, {
        text:
            `🎲 *Round ${gameState.roundsPlayed + 1}* — ${tierBadge(tierKey)}\n` +
            `Numbers: *${gameState.currentNumbers.join('  ·  ')}*\n` +
            `🎯 Target: *${gameState.currentTarget}*\n` +
            `⏱️ ${roundSeconds}s — exact hit wins instantly, closest wins at the buzzer!`
    })

    if (gameState.roundTimer) clearInterval(gameState.roundTimer)
    gameState.roundTimer = setInterval(async () => {
        if (!gameState.roundActive) { clearInterval(gameState.roundTimer); return }
        gameState.roundSecondsLeft--

        if (gameState.roundSecondsLeft <= 0) {
            clearInterval(gameState.roundTimer)
            await handleRoundTimeout(chatId, ctx)
        } else if (gameState.roundSecondsLeft === 10) {
            await sock.sendMessage(chatId, { text: `🚨 *10 seconds left!* Target *${gameState.currentTarget}* — numbers: ${gameState.currentNumbers.join(', ')}` })
        }
        persistGames()
    }, 1000)
}

function adjustTier(gameState, { scoredWell }) {
    if (scoredWell) gameState.tier = Math.min(config.MAX_TIER, gameState.tier + 1)
    else            gameState.tier = Math.max(config.MIN_TIER, gameState.tier - 1)
}

async function advanceAfterRound(chatId, ctx) {
    const { games, settings } = ctx
    const gameState = getGameState(chatId, games)
    gameState.roundsPlayed++

    const { roundsPerSession, cooldownSeconds } = getTgtSettings(settings)
    if (roundsPerSession !== 'infinite' && gameState.roundsPlayed >= roundsPerSession) {
        await stopSession(chatId, ctx, 'rounds_complete')
        return
    }

    gameState.roundActive = false
    ctx.persistGames()
    gameState.cooldownTimer = setTimeout(() => { startRound(chatId, ctx).catch(() => {}) }, cooldownSeconds * 1000)
}

function scoreForDiff(diff) {
    if (diff === 0) return config.SCORE_EXACT
    if (diff <= 5)  return config.SCORE_WITHIN_5
    if (diff <= 10) return config.SCORE_WITHIN_10
    return 0
}

async function awardAndAdvance(chatId, ctx, senderNumber, diff, elapsedMs) {
    const { sock, games, settings } = ctx
    const gameState = getGameState(chatId, games)
    const points = scoreForDiff(diff)
    gameState.scores[senderNumber] = (gameState.scores[senderNumber] || 0) + points

    if (gameState.bestSolveDiff === null || diff < gameState.bestSolveDiff) {
        gameState.bestSolveDiff = diff
        gameState.bestSolveBy = senderNumber
    }

    const roundSecondsConfigured = getTgtSettings(settings).roundSeconds
    const scoredWell = diff === 0 && elapsedMs !== null && elapsedMs < roundSecondsConfigured * 1000 * config.SOLVE_FAST_RATIO
    adjustTier(gameState, { scoredWell })
    await advanceAfterRound(chatId, ctx)
}

async function handleRoundTimeout(chatId, ctx) {
    const { sock, games } = ctx
    const gameState = getGameState(chatId, games)
    gameState.roundActive = false

    // Best of everyone's submissions this round, if any.
    let winner = null
    for (const sub of gameState.submissions) {
        if (!winner || sub.diff < winner.diff) winner = sub
    }

    if (winner && winner.diff <= 10) {
        gameState.playerNames[winner.senderNumber] = winner.senderName
        gameState.playerJids[winner.senderNumber]  = winner.senderJid
        const points = scoreForDiff(winner.diff)
        await sock.sendMessage(chatId, {
            text:
                `⏰ *Time's up!* Closest was *${nameTag(winner.senderNumber, gameState.playerNames, ctx.settings)}*: ` +
                `\`${winner.expr} = ${winner.value}\` (target ${gameState.currentTarget}, off by ${winner.diff}) — +${points}pts 🎉`
        })
        await awardAndAdvance(chatId, ctx, winner.senderNumber, winner.diff, null)
        return
    }

    const example = solver.bestSolution(gameState.currentNumbers, gameState.currentTarget)
    await sock.sendMessage(chatId, {
        text:
            `⏰ *Time's up!* Nobody got within 10 of *${gameState.currentTarget}*.\n` +
            (example ? `💡 Best possible was \`${example.expr} = ${example.value}\` (off by ${example.diff})\n` : '') +
            `Next round in a few seconds...`
    })

    adjustTier(gameState, { scoredWell: false })
    await advanceAfterRound(chatId, ctx)
}

/**
 * Called by publicCommands.js for any non-prefixed message while a round
 * is live. An exact hit ends the round immediately; anything else within
 * range is just recorded as a candidate for the closest-at-the-buzzer
 * scoring at round timeout. Returns true if the message was consumed.
 */
async function handleGuessAttempt(chatId, text, sender, ctx) {
    const { sock, games } = ctx
    const gameState = getGameState(chatId, games)
    if (!gameState.active || !gameState.roundActive) return false
    if (!solver.looksLikeExpression(text)) return false

    const { senderNumber, senderJid, senderName } = sender
    const validation = solver.validateSolution(text, gameState.currentNumbers, gameState.currentTarget)

    if (!validation.valid) {
        if (validation.reason === 'wrong_numbers') {
            await sock.sendMessage(chatId, { text: `❌ Only use numbers from *${gameState.currentNumbers.join(', ')}*, each no more times than it appears.` })
        } else if (validation.reason === 'rule_violation') {
            await sock.sendMessage(chatId, { text: `❌ ${validation.message}` })
        }
        return true
    }

    gameState.submissions.push({
        senderNumber, senderJid, senderName,
        value: validation.result, diff: validation.diff, expr: text.trim(), ts: Date.now()
    })
    gameState.playerNames[senderNumber] = senderName
    gameState.playerJids[senderNumber]  = senderJid

    if (validation.diff === 0) {
        // Exact hit — stop the clock, win instantly.
        gameState.roundActive = false
        if (gameState.roundTimer) clearInterval(gameState.roundTimer)

        const elapsedMs = Date.now() - gameState.roundStartTs
        gameState.playerNames[senderNumber] = senderName
        gameState.playerJids[senderNumber]  = senderJid

        await sock.sendMessage(chatId, {
            text:
                `✅ *${nameTag(senderNumber, gameState.playerNames, ctx.settings)}* hit it EXACTLY in ${(elapsedMs / 1000).toFixed(1)}s!\n` +
                `\`${text.trim()} = ${gameState.currentTarget}\` 🎯\n` +
                `🏅 +${config.SCORE_EXACT}pts — total: ${(gameState.scores[senderNumber] || 0) + config.SCORE_EXACT}`,
            mentions: senderJid ? [senderJid] : []
        })

        ctx.persistGames()
        await awardAndAdvance(chatId, ctx, senderNumber, 0, elapsedMs)
        return true
    }

    // Not exact — acknowledge quietly without ending the round.
    await sock.sendMessage(chatId, {
        text: `📥 *${nameTag(senderNumber, gameState.playerNames, ctx.settings) || senderName}*: \`${text.trim()} = ${validation.result}\` (off by ${validation.diff}) — noted, keep trying!`
    })
    ctx.persistGames()
    return true
}

// ─── Hints ──────────────────────────────────────────────────────
function getHint(chatId, ctx) {
    const { games } = ctx
    const gameState = getGameState(chatId, games)
    if (!gameState.active || !gameState.roundActive) return { ok: false, reason: 'no_round' }

    const best = solver.bestSolution(gameState.currentNumbers, gameState.currentTarget)
    if (!best) return { ok: false, reason: 'no_solution' }

    const match = best.expr.match(/\(\s*\d+\s*[+\-*/]\s*\d+\s*\)/)
    const step = match ? match[0].replace(/[()]/g, '').trim() : null
    const alreadyGiven = !!gameState.hintGivenThisRound

    gameState.hintGivenThisRound = true
    ctx.persistGames()
    return { ok: true, step, alreadyGiven }
}

module.exports = {
    getGameState,
    getTgtSettings,
    startSession,
    stopSession,
    startRound,
    handleGuessAttempt,
    getHint,
    tierBadge
}
