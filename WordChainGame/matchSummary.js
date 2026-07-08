// ============================================================
//  WordChainGame/matchSummary.js
//  Builds the end-of-match report and updates the all-time
//  bragging-rights stats file: longest single word ever played,
//  longest chain ever reached, and each player's own personal-best
//  word (a non-competitive progress signal alongside the leaderboard —
//  see README.md "Engagement" for why both are worth keeping).
// ============================================================

const fs = require('fs')
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
    return { longestWord: '', longestWordBy: '', longestChain: 0, longestChainDate: '', personalBests: {} }
}

function saveStats(stats) {
    try {
        fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2))
    } catch (err) {
        console.error('[WordChain] failed to save stats file:', err)
    }
}

function updateStats(gameState) {
    const stats = loadStats()
    if (!stats.personalBests) stats.personalBests = {}

    let brokeWordRecord = false
    let brokeChainRecord = false
    let brokePersonalBest = false

    if (gameState.longestWordThisMatch && gameState.longestWordThisMatch.length > (stats.longestWord || '').length) {
        stats.longestWord   = gameState.longestWordThisMatch
        stats.longestWordBy = gameState.longestWordThisMatchBy || ''
        brokeWordRecord = true
    }

    if (gameState.longestWordThisMatch && gameState.longestWordThisMatchBy) {
        const playerNumber = gameState.longestWordThisMatchBy
        const prevBest = stats.personalBests[playerNumber]
        if (!prevBest || gameState.longestWordThisMatch.length > prevBest.length) {
            stats.personalBests[playerNumber] = gameState.longestWordThisMatch
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

function recordStrikeOut(gameState, playerNumber) {
    if (!gameState.disqualified) gameState.disqualified = []
    gameState.disqualified.push({ playerNumber, reason: DQ_REASONS.STRIKES_OUT })
}

function checkLastPlayerStanding(gameState) {
    if (gameState.players.length === 1) return gameState.players[0]
    return null
}

// resultInfo = { type: 'winner' | 'solo_end' | 'admin_stop', winnerNumber? }
async function sendMatchReport(sock, chatId, gameState, resultInfo, nameTagFn) {
    const { stats, brokeWordRecord, brokeChainRecord, brokePersonalBest } = updateStats(gameState)

    const chainWords = gameState.chain.map(c => c.word.toUpperCase()).join(' → ') || '(no words played)'
    const longestThisMatch = gameState.longestWordThisMatch
        ? `${gameState.longestWordThisMatch.toUpperCase()} (${gameState.longestWordThisMatch.length} letters)`
        : '—'

    let headline = ''
    if (resultInfo.type === 'winner') {
        headline = `🏆 *${nameTagFn(resultInfo.winnerNumber)} wins Word Chain!*`
    } else if (resultInfo.type === 'admin_stop') {
        headline = `🛑 *Word Chain ended by an admin.*`
    } else {
        headline = `🏁 *Word Chain ended.*`
    }

    let recordsText = ''
    if (brokeWordRecord) recordsText += `\n🆕 *New all-time longest word!* ${stats.longestWord.toUpperCase()}`
    if (brokeChainRecord) recordsText += `\n🆕 *New all-time longest chain!* ${stats.longestChain} words`
    if (brokePersonalBest && gameState.longestWordThisMatchBy) {
        recordsText += `\n🌟 *${nameTagFn(gameState.longestWordThisMatchBy)} just beat their own personal best!*`
    }

    const report =
        `${headline}\n\n` +
        `🔗 *Chain (${gameState.chain.length} words):*\n${chainWords}\n\n` +
        `📏 *Longest word this match:* ${longestThisMatch}\n` +
        `🏛️ *All-time longest word:* ${stats.longestWord ? stats.longestWord.toUpperCase() : '—'}\n` +
        `🏛️ *All-time longest chain:* ${stats.longestChain || 0} words` +
        recordsText

    await sock.sendMessage(chatId, { text: report })
}

module.exports = {
    DQ_REASONS,
    loadStats,
    saveStats,
    updateStats,
    recordStrikeOut,
    checkLastPlayerStanding,
    sendMatchReport
}
