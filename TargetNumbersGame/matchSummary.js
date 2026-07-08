// ============================================================
//  matchSummary.js — Target Numbers (TGT) · Sky Graphics
//  Builds and sends the end-of-session leaderboard report.
// ============================================================

function buildLeaderboardText(gameState, nameTagFn, reason) {
    const entries = Object.entries(gameState.scores || {}).sort((a, b) => b[1] - a[1])

    const reasonLine = {
        manual:          '🏁 *Session ended.*',
        rounds_complete: '🏁 *Session complete — all rounds played!*',
        no_players:      '🏁 *Session ended — no one played.*',
        in_progress:     '📊 *Current standings:*'
    }[reason] || '🏁 *Session ended.*'

    let text = `${reasonLine}\n\n`

    if (entries.length === 0) {
        text += `No one scored a point this session. 😅`
        return text
    }

    text += `🏆 *Leaderboard:*\n`
    entries.forEach(([num, score], i) => {
        const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`
        text += `${medal} ${nameTagFn(num)} — ${score} pt${score === 1 ? '' : 's'}\n`
    })

    if (gameState.bestSolveBy && gameState.bestSolveDiff !== null) {
        text += `\n🎯 *Closest solve overall:* ${nameTagFn(gameState.bestSolveBy)} — off by ${gameState.bestSolveDiff}`
    }

    text += `\n\n🎲 Rounds played: ${gameState.roundsPlayed}`
    return text
}

async function sendSessionReport(sock, chatId, gameState, nameTagFn, reason) {
    const text = buildLeaderboardText(gameState, nameTagFn, reason)
    await sock.sendMessage(chatId, { text })
}

module.exports = { buildLeaderboardText, sendSessionReport }
