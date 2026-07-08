// ============================================================
//  WordChainGame/matchSummary.js
//  Builds the end-of-match report and updates the all-time
//  bragging-rights stats file: longest single word ever played,
//  longest chain ever reached, and each player's personal best
//  word. Personal bests matter as much as the global record —
//  per gamification research, rewarding a player for beating
//  their OWN past performance keeps players of every skill level
//  engaged, not just whoever's currently #1.
// ============================================================

const fs = require('fs')
const { card } = require('./display')
const STATS_FILE = 'wordchain-stats.json'   // namespaced so it never collides
                                             // with another game's stats file
                                             // in the shared project root.

const DQ_REASONS = {
    STRIKES_OUT: 'STRIKES_OUT'
}

function loadStats() {
    if (fs.existsSync(STATS_FILE)) {
        try { return JSON.parse(fs.readFileSync(STATS_FILE)) } catch (_) {}
    }
    return { longestWord: '', longestWordBy: '', longestChain: 0, longestChainDate: '', players: {} }
}

function saveStats(stats) {
    try {
        fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2))
    } catch (err) {
        console.log('[WordChain] Could not save stats file:', err && err.message)
    }
}

function updateStats(gameState) {
    const stats = loadStats()
    if (!stats.players) stats.players = {}

    let brokeWordRecord    = false
    let brokeChainRecord   = false
    let brokePersonalBest  = false

    const bestWord   = gameState.longestWordThisMatch
    const bestWordBy = gameState.longestWordThisMatchBy

    if (bestWord && bestWord.length > (stats.longestWord || '').length) {
        stats.longestWord   = bestWord
        stats.longestWordBy = bestWordBy || ''
        brokeWordRecord = true
    }

    if (bestWord && bestWordBy) {
        if (!stats.players[bestWordBy]) stats.players[bestWordBy] = { longestWord: '', longestWordLength: 0, matchesWon: 0 }
        if (bestWord.length > stats.players[bestWordBy].longestWordLength) {
            stats.players[bestWordBy].longestWord       = bestWord
            stats.players[bestWordBy].longestWordLength = bestWord.length
            brokePersonalBest = true
        }
    }

    const chainLength = gameState.chain.length
    if (chainLength > (stats.longestChain || 0)) {
        stats.longestChain     = chainLength
        stats.longestChainDate = new Date().toISOString().slice(0, 10)
        brokeChainRecord = true
    }

    saveStats(stats)
    return { stats, brokeWordRecord, brokeChainRecord, brokePersonalBest }
}

function recordWin(winnerNumber) {
    const stats = loadStats()
    if (!stats.players) stats.players = {}
    if (!stats.players[winnerNumber]) stats.players[winnerNumber] = { longestWord: '', longestWordLength: 0, matchesWon: 0 }
    stats.players[winnerNumber].matchesWon = (stats.players[winnerNumber].matchesWon || 0) + 1
    saveStats(stats)
    return stats.players[winnerNumber].matchesWon
}

function recordStrikeOut(gameState, playerNumber) {
    if (!gameState.disqualified) gameState.disqualified = []
    gameState.disqualified.push({ playerNumber, reason: DQ_REASONS.STRIKES_OUT })
}

function checkLastPlayerStanding(gameState) {
    if (gameState.players.length === 1) return gameState.players[0]
    return null
}

// resultInfo = { type: 'winner' | 'solo_end' | 'admin_stop' | 'time_up', winnerNumber? }
// driftInfo (optional) = { changed, from, to, strikeRate } from gameEngine.driftTierForNextMatch
async function sendMatchReport(sock, chatId, gameState, resultInfo, nameTagFn, driftInfo) {
    const { stats, brokeWordRecord, brokeChainRecord, brokePersonalBest } = updateStats(gameState)

    let winsTotal = null
    if ((resultInfo.type === 'winner' || resultInfo.type === 'time_up') && resultInfo.winnerNumber) {
        winsTotal = recordWin(resultInfo.winnerNumber)
    }

    const chainWords = gameState.chain.map(c => c.word.toUpperCase()).join(' → ') || '(no words played)'
    const longestThisMatch = gameState.longestWordThisMatch
        ? `${gameState.longestWordThisMatch.toUpperCase()} (${gameState.longestWordThisMatch.length} letters)`
        : '—'

    let headline = ''
    if (resultInfo.type === 'winner') {
        headline = `🏆 *${nameTagFn(resultInfo.winnerNumber)} wins Word Chain!*` + (winsTotal ? ` _(win #${winsTotal})_` : '')
    } else if (resultInfo.type === 'time_up' && resultInfo.winnerNumber) {
        const played = gameState.wordsPlayedByPlayer ? (gameState.wordsPlayedByPlayer[resultInfo.winnerNumber] || 0) : 0
        headline = `⏰ *Time's up! ${nameTagFn(resultInfo.winnerNumber)} takes it!*` +
            (winsTotal ? ` _(win #${winsTotal})_` : ``) +
            `\n_Most words contributed this match: ${played}_`
    } else if (resultInfo.type === 'time_up') {
        headline = `⏰ 💔 *Time's up! Word Chain ended with no clear winner.*`
    } else if (resultInfo.type === 'admin_stop') {
        headline = `🛑 *Word Chain ended by an admin.*`
    } else {
        headline = `🏁 *Word Chain ended.*`
    }

    let recordsText = ''
    if (brokeWordRecord)   recordsText += `\n🆕 *New all-time longest word!* ${stats.longestWord.toUpperCase()}`
    if (brokeChainRecord)  recordsText += `\n🆕 *New all-time longest chain!* ${stats.longestChain} words`
    if (brokePersonalBest && gameState.longestWordThisMatchBy) {
        recordsText += `\n⭐ *Personal best for ${nameTagFn(gameState.longestWordThisMatchBy)}!* ${gameState.longestWordThisMatch.toUpperCase()}`
    }

    let driftText = ''
    if (driftInfo && driftInfo.changed) {
        driftText = driftInfo.to > driftInfo.from
            ? `\n📈 _Group's on fire — next match starts a little harder._`
            : `\n📉 _That one was rough — next match eases up a bit._`
    }

    const body =
        `${headline}\n\n` +
        `🔗 *Chain (${gameState.chain.length} words):*\n${chainWords}\n\n` +
        `📏 *Longest word this match:* ${longestThisMatch}\n` +
        `🏛️ *All-time longest word:* ${stats.longestWord ? stats.longestWord.toUpperCase() : '—'}\n` +
        `🏛️ *All-time longest chain:* ${stats.longestChain || 0} words` +
        recordsText +
        (driftText ? `\n${driftText}` : ``)

    await sock.sendMessage(chatId, { text: card('Match Report', body) }).catch(err =>
        console.log('[WordChain] Could not send match report:', err && err.message)
    )
}

module.exports = {
    DQ_REASONS,
    loadStats,
    saveStats,
    updateStats,
    recordWin,
    recordStrikeOut,
    checkLastPlayerStanding,
    sendMatchReport
}
