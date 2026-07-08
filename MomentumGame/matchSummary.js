// MomentumGame/matchSummary.js
// Bookkeeping and message-building only. Never owns state — everything here
// reads the gameState object it's handed and returns text; gameEngine.js
// decides when to call these and when to persist/send.

// permissions.nameTag(number, nameCache, settings) shows "Name (Creator)" /
// "Name (Admin)" / just "Name" — same helper every other game uses. Falls
// back to the plain player-cached name if permissions isn't reachable for
// any reason, so Momentum never crashes just because a name tag failed.
let nameTag
try {
    nameTag = require('../permissions').nameTag
} catch (_) {
    nameTag = null
}

function displayName(number, gs, nameCache, settings) {
    if (nameTag) {
        try { return nameTag(number, nameCache || {}, settings || {}) } catch (_) { /* fall through */ }
    }
    return (gs.players[number] && gs.players[number].name) || number
}

function meterBar(meter, width = 10) {
    const filled = Math.round((meter / 100) * width)
    return '▓'.repeat(filled) + '░'.repeat(width - filled) + ` ${meter}%`
}

function buildRoundOpenMessage(gs, config) {
    const { A, B } = config.SYMBOLS
    const tensionLine = gs.doubleThisRound
        ? `\n🔥 *High Tension Round* — the meter is near an edge. Points are *doubled* this round!\n`
        : ''

    return (
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🌀 *Momentum — Round ${gs.round}*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Meter: ${meterBar(gs.meter)}\n` +
        tensionLine +
        `\nDM me *${A}* or *${B}* before time's up. You'll find out if this is a Majority or Minority round only *after* picks lock.\n\n` +
        `⏱️ You have *${Math.round(config.ROUND_DURATION_MS / 1000)} seconds*.`
    )
}

function buildRoundRevealMessage(gs, config, extra, nameCache, settings) {
    const { A, B } = config.SYMBOLS
    const { voidRound, tie, roundType, countA, countB, winners, revealPicks } = extra

    let header
    if (voidRound) {
        header = `😴 *Not enough picks came in* — this round is void. No points, no meter shift.`
    } else if (tie) {
        header = `🤝 *Dead heat* — ${countA} vs ${countB}. No majority or minority exists, so no one scores this round.`
    } else {
        const typeLabel = roundType === 'majority'
            ? '👥 *MAJORITY ROUND* — matching the crowd scored'
            : '🦄 *MINORITY ROUND* — being the outlier scored'
        header = typeLabel
    }

    const tallyLine = `\n${A} picked: *${countA}*   ${B} picked: *${countB}*\n`

    let winnersLine = ''
    if (!voidRound && !tie) {
        const doubledTag = gs.doubleThisRound ? ' (×2 — High Tension round)' : ''
        winnersLine = winners.length > 0
            ? `\n🏆 Scored this round${doubledTag}:\n` +
              winners.map(num => `  • ${displayName(num, gs, nameCache, settings)}`).join('\n') + `\n`
            : `\nNo one picked the scoring side this round.\n`
    }

    let revealLine = ''
    if (revealPicks) {
        const entries = Object.entries(gs.roundPicks)
        revealLine =
            `\n👁️ *Meter is razor-close to an edge* — full reveal this round:\n` +
            entries.map(([num, sym]) => `  • ${displayName(num, gs, nameCache, settings)} → ${config.SYMBOLS[sym]}`).join('\n') +
            `\n`
    }

    return (
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        header + `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        tallyLine +
        winnersLine +
        revealLine +
        `\nMeter now: ${meterBar(gs.meter)}\n\n` +
        `_Next round opens in ${Math.round(config.COOLDOWN_MS / 1000)}s..._`
    )
}

function buildScoreboard(gs, config, nameCache, settings) {
    const ranked = Object.entries(gs.players)
        .sort(([, a], [, b]) => b.score - a.score)

    if (ranked.length === 0) {
        return `🌀 *Momentum* — no picks recorded yet this session. DM ${config.SYMBOLS.A} or ${config.SYMBOLS.B} to get on the board!`
    }

    const lines = ranked.map(([num, p], i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`
        return `${medal} ${displayName(num, gs, nameCache, settings)} — *${p.score}* pt${p.score === 1 ? '' : 's'}`
    })

    return (
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🏆 *Momentum — Scoreboard*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Round ${gs.round} · Meter: ${meterBar(gs.meter)}\n\n` +
        lines.join('\n')
    )
}

function buildFinalReport(gs, config, nameCache, settings) {
    const ranked = Object.entries(gs.players).sort(([, a], [, b]) => b.score - a.score)
    const winnerLine = ranked.length > 0
        ? `🏆 Winner: *${displayName(ranked[0][0], gs, nameCache, settings)}* with ${ranked[0][1].score} pts`
        : `No one scored any points this session.`

    const lines = ranked.map(([num, p], i) =>
        `${i + 1}. ${displayName(num, gs, nameCache, settings)} — ${p.score} pt${p.score === 1 ? '' : 's'}`
    )

    return (
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🌀 *MOMENTUM — SESSION COMPLETE*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${gs.round} round${gs.round === 1 ? '' : 's'} played · Final meter: ${meterBar(gs.meter)}\n\n` +
        `${winnerLine}\n\n` +
        (lines.length > 0 ? `*Final standings:*\n${lines.join('\n')}\n\n` : '') +
        `_Thanks for playing! Type *!mmt start* in the group to run it back. 🌀_`
    )
}

module.exports = {
    buildRoundOpenMessage,
    buildRoundRevealMessage,
    buildScoreboard,
    buildFinalReport,
    meterBar,
    displayName
}
