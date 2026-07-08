// MomentumGame/gameEngine.js
// Pure(ish) game-state logic for Momentum — the collective-psychology meter game.
// No word list, no puzzle content: the only input is what the group does.

const config = require('./config')
const { buildRoundOpenMessage, buildRoundRevealMessage, buildFinalReport } = require('./matchSummary')

// ── Runtime-only timer handles ──────────────────────────────────
// Never stored on the persisted gameState object (it goes into games.json,
// and a Timeout handle can't survive JSON.stringify / a restart anyway).
// Keyed by chatId, module-scoped, exactly like the pattern the other games
// use for their turn/lobby timers.
const roundTimers = {}

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n))
}

// ── Lazy-create per-chat state ───────────────────────────────────
// Same contract as every other game: index.js calls this generically for
// /status-style admin commands and restart recovery.
function getGameState(chatId, games) {
    if (!games[chatId] || !games[chatId].momentum) {
        if (!games[chatId]) games[chatId] = {}
        games[chatId].momentum = {
            active:        false,
            paused:        false,
            round:         0,
            meter:         config.METER_START,
            roundDurationMs: config.ROUND_DURATION_MS, // runtime-adjustable via /mmt setroundtime
            players:       {},   // number -> { name, jid, score }
            roundActive:   false,
            roundPicks:    {},   // number -> 'A' | 'B'
            roundDeadline: 0,
            nextAction:    null, // 'resolve' | 'start' | null — what the pending module-level timer will do
            nextActionAt:  0,
            pausedAction:  null,
            pausedRemainingMs: 0,
            doubleThisRound: false,
            history:       []    // last N { round, type, countA, countB, doubled, revealed }
        }
    }
    return games[chatId].momentum
}

function clearRoundTimer(chatId) {
    if (roundTimers[chatId]) {
        clearTimeout(roundTimers[chatId])
        delete roundTimers[chatId]
    }
}

// ── Session lifecycle ────────────────────────────────────────────
async function startSession(chatId, ctx) {
    const gs = getGameState(chatId, ctx.games)
    gs.active  = true
    gs.paused  = false
    gs.round   = 0
    gs.meter   = config.METER_START
    gs.players = {}
    gs.history = []
    ctx.activeGameChatRef.value = chatId
    ctx.persistGames()

    await ctx.sock.sendMessage(chatId, {
        text:
            `🌀 *Momentum has begun!*\n\n` +
            `Every round, DM me one pick — ⚡ or 🌊 (or type "bolt"/"wave" if emoji keyboard is a hassle).\n\n` +
            `You won't find out if this was a *Majority* round (match the crowd) or a *Minority* round (be the outlier) until *after* picks lock. Read the room — or don't. 👀\n\n` +
            `First round opens now. Type *!mmt scores* any time to check the board.`
    })

    await startRound(chatId, ctx)
}

async function startRound(chatId, ctx) {
    const gs = getGameState(chatId, ctx.games)
    gs.round += 1
    gs.roundActive   = true
    gs.roundPicks    = {}
    gs.roundDeadline = Date.now() + gs.roundDurationMs
    gs.nextAction     = 'resolve'
    gs.nextActionAt   = gs.roundDeadline
    gs.pausedAction   = null
    gs.pausedRemainingMs = 0

    const distFromEdge = Math.min(gs.meter, 100 - gs.meter)
    gs.doubleThisRound = distFromEdge <= config.DOUBLE_POINTS_EDGE_DISTANCE

    ctx.persistGames()

    await ctx.sock.sendMessage(chatId, {
        text: buildRoundOpenMessage(gs, config)
    })

    clearRoundTimer(chatId)
    roundTimers[chatId] = setTimeout(() => {
        resolveRound(chatId, ctx).catch(err => console.error('[Momentum] resolveRound error:', err))
    }, gs.roundDurationMs)
}

function registerPick(chatId, senderNumber, senderName, senderJid, symbolKey, games) {
    const gs = getGameState(chatId, games)
    if (!gs.active || !gs.roundActive) return { ok: false, reason: 'no_round' }
    if (Date.now() > gs.roundDeadline) return { ok: false, reason: 'too_late' }

    if (!gs.players[senderNumber]) {
        gs.players[senderNumber] = { name: senderName, jid: senderJid, score: 0 }
    } else {
        gs.players[senderNumber].name = senderName || gs.players[senderNumber].name
        gs.players[senderNumber].jid  = senderJid  || gs.players[senderNumber].jid
    }

    const alreadyPicked = !!gs.roundPicks[senderNumber]
    gs.roundPicks[senderNumber] = symbolKey
    return { ok: true, changed: alreadyPicked }
}

async function resolveRound(chatId, ctx) {
    const gs = getGameState(chatId, ctx.games)
    if (!gs.active || !gs.roundActive) return
    clearRoundTimer(chatId)
    gs.roundActive = false

    const entries = Object.entries(gs.roundPicks) // [number, 'A'|'B'][]
    const countA  = entries.filter(([, v]) => v === 'A').length
    const countB  = entries.filter(([, v]) => v === 'B').length
    const total   = entries.length

    let roundType   = null
    let winners     = []
    let voidRound   = false
    let tie         = false

    if (total < config.MIN_PICKS_TO_SCORE) {
        voidRound = true
    } else if (countA === countB) {
        tie = true
    } else {
        // The coin flip that makes the whole game work: decided fresh, right
        // now, after picks are already locked in — never predictable in
        // advance and never influenced by the pick counts themselves.
        roundType = Math.random() < 0.5 ? 'majority' : 'minority'
        const majoritySymbol = countA > countB ? 'A' : 'B'
        const minoritySymbol = countA > countB ? 'B' : 'A'
        const scoringSymbol  = roundType === 'majority' ? majoritySymbol : minoritySymbol
        winners = entries.filter(([, v]) => v === scoringSymbol).map(([num]) => num)

        const pointsPerWin = gs.doubleThisRound ? 2 : 1
        winners.forEach(num => {
            if (gs.players[num]) gs.players[num].score += pointsPerWin
        })

        const net = countA - countB
        const rawShift = net * config.METER_STEP
        const shift = clamp(rawShift, -config.METER_MAX_SHIFT_PER_ROUND, config.METER_MAX_SHIFT_PER_ROUND)
        gs.meter = clamp(gs.meter + shift, 0, 100)
    }

    const distFromEdgeAfter = Math.min(gs.meter, 100 - gs.meter)
    const revealPicks = !voidRound && !tie && distFromEdgeAfter <= config.REVEAL_PICKS_EDGE_DISTANCE

    gs.history.unshift({
        round: gs.round, type: voidRound ? 'void' : (tie ? 'tie' : roundType),
        countA, countB, doubled: gs.doubleThisRound && !voidRound && !tie, revealed: revealPicks
    })
    gs.history = gs.history.slice(0, config.HISTORY_LENGTH)

    await ctx.sock.sendMessage(chatId, {
        text: buildRoundRevealMessage(gs, config, {
            voidRound, tie, roundType, countA, countB, winners, revealPicks
        }, ctx.nameCache, ctx.settings)
    })

    ctx.persistGames()

    if (!gs.active) return // an admin may have ended the session during the round
    if (gs.paused) return  // an admin paused mid-reveal — don't auto-schedule the next round
    clearRoundTimer(chatId)
    gs.nextAction   = 'start'
    gs.nextActionAt = Date.now() + config.COOLDOWN_MS
    roundTimers[chatId] = setTimeout(() => {
        startRound(chatId, ctx).catch(err => console.error('[Momentum] startRound error:', err))
    }, config.COOLDOWN_MS)
}

// Pausing works whether a round is currently open OR the game is sitting in
// the cooldown gap between rounds — either way there's exactly one pending
// module-level timer (tracked via gs.nextAction/gs.nextActionAt), and pause
// just clears it and remembers how much time was left.
async function pauseSession(chatId, games) {
    const gs = getGameState(chatId, games)
    if (!gs.active || gs.paused) return false
    gs.paused = true
    if (gs.nextAction) {
        gs.pausedAction      = gs.nextAction
        gs.pausedRemainingMs = Math.max(0, gs.nextActionAt - Date.now())
        clearRoundTimer(chatId)
    }
    return true
}

async function resumeSession(chatId, ctx) {
    const gs = getGameState(chatId, ctx.games)
    if (!gs.active || !gs.paused) return false
    gs.paused = false

    if (gs.pausedAction) {
        const delay  = gs.pausedRemainingMs
        const action = gs.pausedAction
        gs.nextActionAt = Date.now() + delay
        if (action === 'resolve') gs.roundDeadline = gs.nextActionAt

        clearRoundTimer(chatId)
        roundTimers[chatId] = setTimeout(() => {
            const fn = action === 'resolve' ? resolveRound : startRound
            fn(chatId, ctx).catch(err => console.error(`[Momentum] ${action} error:`, err))
        }, delay)
    }

    gs.pausedAction      = null
    gs.pausedRemainingMs = 0
    return true
}

async function endSession(chatId, ctx) {
    const gs = getGameState(chatId, ctx.games)
    clearRoundTimer(chatId)
    const report = buildFinalReport(gs, config, ctx.nameCache, ctx.settings)
    gs.active      = false
    gs.paused      = false
    gs.roundActive = false
    gs.roundPicks  = {}
    if (ctx.activeGameChatRef.value === chatId) ctx.activeGameChatRef.value = null
    ctx.persistGames()
    await ctx.sock.sendMessage(chatId, { text: report })
}

function resetScores(chatId, games) {
    const gs = getGameState(chatId, games)
    Object.keys(gs.players).forEach(num => { gs.players[num].score = 0 })
    gs.meter   = config.METER_START
    gs.history = []
}

module.exports = {
    getGameState,
    startSession,
    startRound,
    registerPick,
    resolveRound,
    pauseSession,
    resumeSession,
    endSession,
    resetScores
}
