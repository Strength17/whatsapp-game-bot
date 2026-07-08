// ============================================================
//  WordChainGame/gameEngine.js
//  Pure game-state logic: lobby, turn rotation, word validation,
//  strikes, elimination, LIVE in-match difficulty progression,
//  auto-rotating themes, a self-governing match-duration clock,
//  and the once-per-match auto-tier drift that carries into the
//  NEXT match. No admin logic, no command-string parsing — that
//  lives in adminCommands.js / publicCommands.js.
//
//  ── IMPORTANT: timer handles are NEVER stored on gameState ──
//  `gameState` (via getGameState) is exactly what `persistGames()`
//  serializes to disk. A raw setInterval/setTimeout handle is a
//  Node `Timeout` object with internal circular references —
//  JSON.stringify on it throws "Converting circular structure to
//  JSON". Storing one on gameState (the previous design) meant
//  persistGames() would throw the instant a timer existed, and
//  because that call sits inside an async setInterval callback —
//  not covered by index.js's per-message try/catch — the failure
//  was silent: the round would go dead right after a card message,
//  with no error visible to players or the admin. All three timer
//  handles now live in `timerStore`, a module-level Map keyed by
//  chatId, completely outside anything that ever gets persisted.
// ============================================================

const matchSummary = require('./matchSummary')
const dictionary   = require('./dictionary')
const { nameTag, resolveSetting } = require('../permissions')
const { difficultyBadge, themeBadge, card } = require('./display')
const {
    GAME_KEY, TIER_NAMES, TIER_TABLE, MAX_TIER,
    DRIFT_STRUGGLE_STRIKE_RATE, DRIFT_CRUISE_STRIKE_RATE,
    PROGRESSION_STEPS, MAX_MIN_LENGTH, MIN_TIMER_SECONDS,
    THEME_ROTATION_ORDER, THEME_ROTATION_QUALIFY,
    MATCH_DURATION_SECONDS, MIN_MATCH_DURATION_SECONDS, MAX_MATCH_DURATION_SECONDS,
    AUTO_RESTART_COOLDOWN_SECONDS,
    CHAIN_MILESTONES, LOBBY_SECONDS, PREFIX
} = require('./config')
const { DEFAULT_WORDS } = require('./themeBank')

// ─── In-memory-only timer registry — see header note above ─────────
// Never read from or written to games.json. Lost on process restart,
// which is fine: a restart already orphans any live round (a known,
// pre-existing limitation), and this keeps persisted state 100% JSON-safe.
const timerStore = new Map()

function getTimers(chatId) {
    if (!timerStore.has(chatId)) timerStore.set(chatId, { lobbyTimer: null, turnTimer: null, matchTimer: null })
    return timerStore.get(chatId)
}

function clearAllTimers(chatId) {
    const t = getTimers(chatId)
    if (t.lobbyTimer) clearInterval(t.lobbyTimer)
    if (t.turnTimer)  clearInterval(t.turnTimer)
    if (t.matchTimer) clearInterval(t.matchTimer)
    t.lobbyTimer = null
    t.turnTimer  = null
    t.matchTimer = null
}

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

// Wraps an entire setInterval/setTimeout async body so a bug ANYWHERE in
// it (not just the sends) can never silently kill the timer or leave a
// round stuck with zero explanation to the group — defense in depth per
// ARCHITECTURE.md §8, since this class of callback is otherwise uncaught.
function guardedTimerCallback(sock, chatId, fn) {
    return async (...args) => {
        try {
            await fn(...args)
        } catch (err) {
            console.log(`[WordChain] timer callback error in ${chatId}:`, err && err.stack || err)
            await safeSend(sock, chatId, {
                text: `⚠️ *Word Chain hit a snag and had to stop this round.* An admin can check */wcg status* or run */wcg end* + */wcg start* to get a fresh one going.`
            })
        }
    }
}

// ─── Tier → starting round config for a match ──────────────────────
function roundConfigForTier(tier) {
    const clamped = Math.max(0, Math.min(MAX_TIER, tier || 0))
    return { tierIndex: clamped, tierName: TIER_NAMES[clamped], ...TIER_TABLE[clamped] }
}

// ─── Live in-match progression ──────────────────────────────────────
// Finds the highest atChainLength threshold the current chain has
// reached and applies THAT step's deltas on top of the match's
// starting (tier) config — steps replace, not stack, so this can
// never runaway compound. Strikes never tighten mid-match on purpose.
function progressionConfigForChain(baseCfg, chainLength) {
    let minLength    = baseCfg.minLength
    let timerSeconds = baseCfg.timerSeconds
    for (const step of PROGRESSION_STEPS) {
        if (chainLength >= step.atChainLength) {
            minLength    = baseCfg.minLength    + step.minLengthDelta
            timerSeconds = baseCfg.timerSeconds  + step.timerDelta
        }
    }
    minLength    = Math.min(minLength, MAX_MIN_LENGTH)
    timerSeconds = Math.max(timerSeconds, MIN_TIMER_SECONDS)
    return { minLength, timerSeconds }
}

async function applyProgression(chatId, gameState, ctx) {
    const baseCfg = roundConfigForTier(gameState.tier)
    const prog = progressionConfigForChain(baseCfg, gameState.chain.length)
    const grew = prog.minLength > gameState.roundMinLength
    gameState.roundMinLength    = prog.minLength
    gameState.roundTimerSeconds = prog.timerSeconds
    if (grew) {
        await safeSend(ctx.sock, chatId, {
            text: `📏 *Chain's heating up!* Minimum word length is now *${prog.minLength}+ letters*.`
        })
    }
}

// ─── Auto theme rotation — qualification-gated, never timed, never admin-set ──
function themeWordsFor(words, themeKey) {
    if (!themeKey || themeKey === 'none') return []
    const list = words && words.themes && words.themes[themeKey]
    return Array.isArray(list) ? list.map(w => w.toLowerCase()) : []
}

async function maybeRotateTheme(chatId, gameState, ctx) {
    if (gameState.wordsSinceStrike < THEME_ROTATION_QUALIFY) return
    gameState.wordsSinceStrike = 0
    gameState.themeRotationIndex = (gameState.themeRotationIndex + 1) % THEME_ROTATION_ORDER.length
    gameState.roundTheme = THEME_ROTATION_ORDER[gameState.themeRotationIndex]
    const badge = themeBadge(gameState.roundTheme)
    await safeSend(ctx.sock, chatId, {
        text: `🎨 *Theme shift!* ${badge} words are now also accepted, on top of regular words.`
    })
}

// ─── getGameState ───────────────────────────────────────────────
// State is stored under a GAME_KEY-prefixed key (not the bare chatId) —
// `games` is shared across every game module (ARCHITECTURE.md §4).
// This object is exactly what persistGames() writes to disk, so it must
// stay 100% plain-JSON-serializable — no Timer handles, no functions.
function stateKey(chatId) {
    return `${GAME_KEY}:${chatId}`
}

function getGameState(chatId, games) {
    const key = stateKey(chatId)
    if (!games[key]) {
        games[key] = {
            active:            false,
            lobbyActive:       false,
            lobbySecondsLeft:  LOBBY_SECONDS,
            turnSecondsLeft:   30,
            matchSecondsLeft:  0,
            matchDurationSeconds: MATCH_DURATION_SECONDS,
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
            wordsSinceStrike:  0,
            themeRotationIndex: -1,
            wordsPlayedByPlayer:    {},
            strikesTotalByPlayer:   {},
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
    if (typeof gs.wordsSinceStrike !== 'number') gs.wordsSinceStrike = 0
    if (typeof gs.themeRotationIndex !== 'number') gs.themeRotationIndex = -1
    if (!gs.wordsPlayedByPlayer)  gs.wordsPlayedByPlayer  = {}
    if (!gs.strikesTotalByPlayer) gs.strikesTotalByPlayer = {}
    if (typeof gs.matchDurationSeconds !== 'number') gs.matchDurationSeconds = MATCH_DURATION_SECONDS
    if (typeof gs.matchSecondsLeft !== 'number') gs.matchSecondsLeft = 0
    // Purge any lingering non-serializable remnants from a pre-fix save —
    // these fields must never live on the persisted object (see header note).
    delete gs.lobbyTimer
    delete gs.turnTimer
    delete gs.matchTimer
    return gs
}

// ─── Admin-tunable match duration (dynamic default, admin-settable) ──
function matchDurationSecondsFor(settings) {
    const raw = resolveSetting(`${GAME_KEY}_matchDurationSeconds`, settings, MATCH_DURATION_SECONDS)
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) return MATCH_DURATION_SECONDS
    return Math.max(MIN_MATCH_DURATION_SECONDS, Math.min(MAX_MATCH_DURATION_SECONDS, Math.round(n)))
}

// ─── Lobby open — used by both the public !wcg start command AND the
// engine's own auto-restart after a match ends, so a fresh lobby opens
// on autopilot with zero admin involvement. ─────────────────────────
async function openLobby(chatId, ctx, opts = {}) {
    const { sock, games, activeGameChatRef, persistGames } = ctx
    if (activeGameChatRef.value && activeGameChatRef.value !== chatId) return false

    const gameState = getGameState(chatId, games)
    gameState.lobbyActive      = true
    gameState.lobbySecondsLeft = LOBBY_SECONDS
    gameState.players          = []
    gameState.playerNames      = {}
    gameState.playerJids       = {}
    activeGameChatRef.value    = chatId
    persistGames()

    const introBody =
        (opts.auto ? `That match is done — a fresh one is opening automatically! 🔁\n\n` : ``) +
        `You have *${LOBBY_SECONDS} seconds* to join! ⏱️\n` +
        `Type *${PREFIX} join* now!`

    await safeSend(sock, chatId, { text: card('Word Chain is Starting!', introBody) })
    startLobbyCountdown(chatId, ctx)
    return true
}

// ─── Lobby countdown ─────────────────────────────────────────────
function startLobbyCountdown(chatId, ctx) {
    const { sock, games, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    const timers = getTimers(chatId)
    if (timers.lobbyTimer) clearInterval(timers.lobbyTimer)

    timers.lobbyTimer = setInterval(guardedTimerCallback(sock, chatId, async () => {
        if (!gameState.lobbyActive) {
            clearInterval(timers.lobbyTimer)
            return
        }

        gameState.lobbySecondsLeft--

        if (gameState.lobbySecondsLeft <= 0) {
            clearInterval(timers.lobbyTimer)
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
                    `🎯 Starting mode: ${difficultyBadge(cfg.tierName)} _(auto — climbs live as the chain grows)_\n\n` +
                    `👥 *Current Lobby:*\n${lobbyText || '[No players yet — be first! 🎯]'}`,
                mentions: lobbyMentions
            })
        }
        persistGames()
    }), 1000)
}

// ─── Start actual game ────────────────────────────────────────────
async function startActualGame(chatId, ctx) {
    const { sock, games, settings, activeGameChatRef, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    const timers = getTimers(chatId)
    gameState.lobbyActive = false
    if (timers.lobbyTimer) clearInterval(timers.lobbyTimer)

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
    gameState.roundTheme        = 'none'          // themes always start off — earned live via rotation
    gameState.wordsSinceStrike  = 0
    gameState.themeRotationIndex = -1
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
    gameState.wordsPlayedByPlayer     = {}
    gameState.strikesTotalByPlayer    = {}
    gameState.matchDurationSeconds    = matchDurationSecondsFor(settings)
    gameState.matchSecondsLeft        = gameState.matchDurationSeconds

    const openerNumber = gameState.players[0]
    const openerJid    = gameState.playerJids[openerNumber]
    const minutesLabel = Math.round(gameState.matchDurationSeconds / 60 * 10) / 10

    // persistGames() runs BEFORE anything else after this point can throw,
    // and gameState is now guaranteed plain-JSON — no more silent death
    // between "Lobby Closed" and the round actually starting.
    persistGames()

    await safeSend(sock, chatId, {
        text: card('Lobby Closed — Word Chain is ON!',
            `🎯 *Mode:* ${difficultyBadge(cfg.tierName)} _(auto — starts here, climbs as the chain grows)_ — words must be *${cfg.minLength}+ letters*\n` +
            `⏱️ *${cfg.timerSeconds}s per turn* | 💥 *${cfg.maxStrikes} strikes* and you're out\n` +
            `⏳ *Match length: ${minutesLabel} min* — the clock runs on its own; no one has to stop it\n` +
            `🎨 Themed words (Animals, Food) unlock automatically the longer the group goes without a strike\n\n` +
            `📜 *How it works:* say a real word. The next player must say a NEW word ` +
            `starting with the LAST letter of yours. No repeats!\n\n` +
            `🎯 *${nameTag(openerNumber, gameState.playerNames, settings)}, you open the chain!* Say any word (${cfg.minLength}+ letters) to start. 🔥`),
        mentions: openerJid ? [openerJid] : []
    })

    startTurnCountdown(chatId, ctx)
    startMatchCountdown(chatId, ctx)
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
    const themeLine = themeBadge(gameState.roundTheme)
    if (themeLine) boardText += `${themeLine}\n`
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
    const timers = getTimers(chatId)
    if (timers.turnTimer) clearInterval(timers.turnTimer)

    if (!opts.preserveRemaining) {
        gameState.turnSecondsLeft = gameState.roundTimerSeconds || 30
    }

    timers.turnTimer = setInterval(guardedTimerCallback(sock, chatId, async () => {
        if (!gameState.active || gameState.paused) {
            clearInterval(timers.turnTimer)
            return
        }

        gameState.turnSecondsLeft--

        const currentPlayerNumber = gameState.players[gameState.currentTurnIndex]
        const currentPlayerJid    = gameState.playerJids[currentPlayerNumber]
        const currentPlayerName   = nameTag(currentPlayerNumber, gameState.playerNames, settings)

        if (gameState.turnSecondsLeft <= 0) {
            clearInterval(timers.turnTimer)
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
    }), 1000)
}

// ─── Match-duration countdown — the ONLY clock that can end a match
// without a winner/loser being decided by play. Runs alongside the
// turn timer; freezes together with it on /wcg pause. ────────────────
function startMatchCountdown(chatId, ctx) {
    const { sock, games, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    const timers = getTimers(chatId)
    if (timers.matchTimer) clearInterval(timers.matchTimer)

    timers.matchTimer = setInterval(guardedTimerCallback(sock, chatId, async () => {
        if (!gameState.active) {
            clearInterval(timers.matchTimer)
            return
        }
        if (gameState.paused) return   // frozen together with the turn timer

        gameState.matchSecondsLeft--

        if (gameState.matchSecondsLeft <= 0) {
            clearInterval(timers.matchTimer)
            await endMatchByTime(chatId, ctx)
        } else if (gameState.matchSecondsLeft === 60) {
            await safeSend(sock, chatId, { text: `⏳ *1 minute left in this match!*` })
        } else if (gameState.matchSecondsLeft === 30) {
            await safeSend(sock, chatId, { text: `⏳ *30 seconds left in this match!*` })
        } else if (gameState.matchSecondsLeft === 10) {
            await safeSend(sock, chatId, { text: `🚨 *10 seconds — final words!*` })
        }
        persistGames()
    }), 1000)
}

// Picks a result when the match clock — not play — ends the round.
// Tie-break order: most words contributed to the chain → fewest
// lifetime strikes → earliest player in turn order (deterministic,
// since the loop below only replaces `best` on a strict improvement).
function pickTimeUpWinner(gameState) {
    const candidates = gameState.players || []
    if (candidates.length === 0) return null
    let best = null
    for (const num of candidates) {
        const played  = gameState.wordsPlayedByPlayer[num] || 0
        const strikes = gameState.strikesTotalByPlayer[num] || 0
        if (!best || played > best.played || (played === best.played && strikes < best.strikes)) {
            best = { num, played, strikes }
        }
    }
    return best ? best.num : null
}

async function endMatchByTime(chatId, ctx) {
    const { sock, games, activeGameChatRef, persistGames } = ctx
    const gameState = getGameState(chatId, games)
    if (!gameState.active) return

    gameState.active = false
    clearAllTimers(chatId)
    if (activeGameChatRef.value === chatId) activeGameChatRef.value = null

    const winnerNumber = pickTimeUpWinner(gameState)
    await safeSend(sock, chatId, { text: `⏰ *Time's up!* The match has ended.` })
    persistGames()
    await endMatch(chatId, gameState, ctx, { type: 'time_up', winnerNumber }, { autoRestart: true })
}

// ─── Once-per-match auto-difficulty drift — carries into the NEXT match ──
// Evaluated when a match ends, not per turn — Word Chain's natural
// difficulty unit is a whole match (many turns), unlike the math games.
// This is what makes tomorrow's starting word length higher than
// today's if the group keeps cruising, on top of the live in-match
// progression climbing further during any single match.
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

// ─── End-of-match wrapper — drifts tier, delegates to matchSummary,
// and (unless this was an admin-forced stop) schedules the engine's
// own autopilot restart. No admin has to type /wcg start again. ────────
async function endMatch(chatId, gameState, ctx, resultInfo, opts = {}) {
    clearAllTimers(chatId)

    const drift = driftTierForNextMatch(gameState)
    await matchSummary.sendMatchReport(
        ctx.sock, chatId, gameState, resultInfo,
        (n) => nameTag(n, gameState.playerNames, ctx.settings),
        drift
    )

    if (opts.autoRestart) scheduleAutoRestart(chatId, ctx)
}

function scheduleAutoRestart(chatId, ctx) {
    const { activeGameChatRef } = ctx
    setTimeout(async () => {
        try {
            // Don't steal the lock if something else has claimed it in the
            // meantime (another chat's game, or an admin already acting).
            if (activeGameChatRef.value) return
            await openLobby(chatId, ctx, { auto: true })
        } catch (err) {
            console.log('[WordChain] auto-restart failed:', err && err.message)
        }
    }, AUTO_RESTART_COOLDOWN_SECONDS * 1000)
}

// ─── Apply a strike and handle elimination ─────────────────────────
async function applyStrike(chatId, playerNumber, reasonText, ctx) {
    const { sock, games, settings, activeGameChatRef, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    gameState.strikes[playerNumber] = (gameState.strikes[playerNumber] || 0) + 1
    gameState.strikesTotalByPlayer[playerNumber] = (gameState.strikesTotalByPlayer[playerNumber] || 0) + 1
    gameState.totalStrikesThisMatch++
    gameState.totalTurnsThisMatch++
    gameState.wordsSinceStrike = 0   // a strike keeps the group on the current theme longer, never punishes with a switch
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
            await endMatch(chatId, gameState, ctx, { type: 'winner', winnerNumber: lastStanding }, { autoRestart: true })
            persistGames()
            return
        }

        if (gameState.players.length === 0) {
            gameState.active = false
            if (activeGameChatRef.value === chatId) activeGameChatRef.value = null
            await safeSend(sock, chatId, { text: `${dqText}\n\n💀 *GAME OVER!* No players remain.` })
            await endMatch(chatId, gameState, ctx, { type: 'solo_end' }, { autoRestart: true })
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

    const timers = getTimers(chatId)
    if (timers.turnTimer) clearInterval(timers.turnTimer)

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
    const themeWords = themeWordsFor(words, gameState.roundTheme)
    if (!dictionary.isAcceptedWord(word, themeWords)) {
        return applyStrike(chatId, senderNumber, `❌ *${currentPlayerName}* — *${word.toUpperCase()}* isn't a recognized word.`, ctx)
    }

    // ── Accepted ──
    gameState.chain.push({ word, playerNumber: senderNumber })
    gameState.usedWords.push(word)
    gameState.strikes[senderNumber] = 0
    gameState.totalTurnsThisMatch++
    gameState.wordsPlayedByPlayer[senderNumber] = (gameState.wordsPlayedByPlayer[senderNumber] || 0) + 1
    gameState.wordsSinceStrike++

    if (word.length > gameState.longestWordThisMatch.length) {
        gameState.longestWordThisMatch   = word
        gameState.longestWordThisMatchBy = senderNumber
    }

    const nextTurnIndex = (gameState.currentTurnIndex + 1) % gameState.players.length
    gameState.currentTurnIndex = nextTurnIndex

    const themeNote = (themeWords.includes(word) && !dictionary.isRealWord(word)) ? ' 🎨' : ''
    const feedback = `✅ *${currentPlayerName}* played *${word.toUpperCase()}*!${themeNote} 🟢`
    persistGames()

    await applyProgression(chatId, gameState, ctx)
    await maybeRotateTheme(chatId, gameState, ctx)
    await checkChainMilestone(chatId, gameState, ctx)
    await sendChainBoard(chatId, feedback, ctx)
}

// ─── Force-stop — optional contract addition (ARCHITECTURE.md §10) ──
// Called ONLY by game-switch-commands.js, ONLY when the creator runs
// "/game setgame ..." while Word Chain has a live session in this chat.
// Reuses clearAllTimers() (the same in-memory timerStore every other
// timer function here already goes through) so there's exactly one
// place that knows how to tear down lobby/turn/match timers — no
// duplicated timer-clearing logic to drift out of sync.
// Never sends a chat message itself — the caller (game-switch-commands.js)
// reports what was stopped, once, in its own confirmation message.
// Returns true if something was actually running (worth reporting),
// false if there was nothing to clean up.
function forceStopActiveSession(chatId, ctx) {
    const { games, persistGames } = ctx
    const gameState = getGameState(chatId, games)

    const wasRunning = !!(gameState.active || gameState.lobbyActive)

    clearAllTimers(chatId)
    gameState.active      = false
    gameState.lobbyActive = false
    gameState.paused      = false

    if (typeof persistGames === 'function') persistGames()
    return wasRunning
}

module.exports = {
    DEFAULT_WORDS,
    stateKey,
    roundConfigForTier,
    progressionConfigForChain,
    themeWordsFor,
    matchDurationSecondsFor,
    getGameState,
    getTimers,
    clearAllTimers,
    openLobby,
    startLobbyCountdown,
    startActualGame,
    sendChainBoard,
    startTurnCountdown,
    startMatchCountdown,
    processWordSubmission,
    applyStrike,
    driftTierForNextMatch,
    pickTimeUpWinner,
    endMatch,
    endMatchByTime,
    safeSend,
    forceStopActiveSession
}
