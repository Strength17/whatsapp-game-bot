// ============================================================
//  matchSummary.js — Target Numbers (TGT) · Sky Graphics
//  Builds and sends the end-of-session report. REWRITTEN per
//  TARGET_NUMBERS_FIX_SPEC.md Part C4 — the old version only showed a
//  one-line reason header, a leaderboard, the single best solve of the
//  whole session, and a round count. It never showed the round-by-round
//  recap, a distinct winner callout, or card-style formatting, even
//  though a session-end report is exactly the kind of message that
//  should get the divider/brand treatment (§A9).
// ============================================================

function reasonHeader(reason, config) {
    if (reason === 'manual' || reason === 'admin_stop') return `${config.GAME_NAME.toUpperCase()} — ENDED BY ADMIN`
    return `${config.GAME_NAME.toUpperCase()} — SESSION COMPLETE`
}

function reasonEmoji(reason) {
    return (reason === 'manual' || reason === 'admin_stop') ? '🛑' : '🏁'
}

function roundLine(entry) {
    const base = `Round ${entry.roundNumber} — Target ${entry.target}`
    if (entry.winnerNumber === null) return `${base} — 💔 nobody within 10`
    if (entry.diff === 0)            return `${base} — ✅ ${entry.winnerName || entry.winnerNumber} hit it exactly`
    return `${base} — 🎯 ${entry.winnerName || entry.winnerNumber} closest, off by ${entry.diff}`
}

function buildLeaderboardText(gameState, nameTagFn, reason, config) {
    const entries = Object.entries(gameState.scores || {}).sort((a, b) => b[1] - a[1])
    const history = gameState.roundHistory || []

    let text =
        `${config.DIVIDER}\n` +
        `${config.BOT_EMOJI} ${reasonEmoji(reason)} *${reasonHeader(reason, config)}*\n` +
        `${config.DIVIDER}\n\n`

    // ── Winner callout — distinct from just being #1 on the leaderboard ──
    if (entries.length === 0) {
        text += `🏆 *Winner*\nNo one scored — no winner this session. 😅\n\n`
    } else {
        const [topNum, topScore] = entries[0]
        text += `🏆 *Winner*\n✅ ${nameTagFn(topNum)} — ${topScore} pt${topScore === 1 ? '' : 's'}\n\n`
    }

    // ── Final standings ──
    if (entries.length > 0) {
        text += `👥 *Final Standings*\n`
        entries.forEach(([num, score], i) => {
            const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`
            text += `${medal} ${nameTagFn(num)} — ${score} pt${score === 1 ? '' : 's'}\n`
        })
        text += `\n`
    }

    // ── Round-by-round recap — trimmed to the most recent N (§C4) ──
    if (history.length > 0) {
        const showN = config.ROUND_HISTORY_REPORT_SHOW || 8
        const shown = history.slice(-showN)
        const hiddenCount = history.length - shown.length

        text += `🎲 *Round-by-Round*\n`
        shown.forEach(entry => { text += `${roundLine(entry)}\n` })
        if (hiddenCount > 0) text += `_...and ${hiddenCount} earlier round${hiddenCount === 1 ? '' : 's'}_\n`
        text += `\n`
    }

    // ── Best solve this session ──
    if (gameState.bestSolveBy && gameState.bestSolveDiff !== null) {
        const bestRound = history.find(h => h.winnerNumber === gameState.bestSolveBy && h.diff === gameState.bestSolveDiff)
        const roundNote = bestRound ? `, Round ${bestRound.roundNumber}` : ''
        const diffNote = gameState.bestSolveDiff === 0 ? `off by 0 (exact${roundNote})` : `off by ${gameState.bestSolveDiff}${roundNote}`
        text += `🎯 *Best Solve This Session*\n${nameTagFn(gameState.bestSolveBy)} — ${diffNote}\n\n`
    }

    // ── Stats footer ──
    text += `📊 *Match Statistics*\n` +
            `Rounds played: ${gameState.roundsPlayed}\n\n`

    text += `${config.DIVIDER}\n` +
            `_${config.GAME_ACRONYM} Bot · Sky Graphics_ 🎨`

    return text
}

async function sendSessionReport(sock, chatId, gameState, nameTagFn, reason, config) {
    const text = buildLeaderboardText(gameState, nameTagFn, reason, config)
    await sock.sendMessage(chatId, { text })
}

// Lightweight, transactional — for "!tgt scores" while a session is still
// running. The full card-style report (buildLeaderboardText) is reserved
// for actual session endings, per §A9's card-vs-transactional distinction.
function buildLiveStandingsText(gameState, nameTagFn) {
    const entries = Object.entries(gameState.scores || {}).sort((a, b) => b[1] - a[1])
    if (entries.length === 0) return `📊 *Current standings:* no one has scored yet this session.`

    let text = `📊 *Current standings:*\n`
    entries.forEach(([num, score], i) => {
        const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`
        text += `${medal} ${nameTagFn(num)} — ${score} pt${score === 1 ? '' : 's'}\n`
    })
    return text.trim()
}

module.exports = { buildLeaderboardText, buildLiveStandingsText, sendSessionReport }
