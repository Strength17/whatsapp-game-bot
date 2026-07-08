// WordLadderGame/matchSummary.js
// Generates a session-end summary report.
// Called by admin command or at end of a timed session.

'use strict';

const cfg    = require('./config');
const engine = require('./gameEngine');

const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * buildSessionReport(state, nameCache)
 * Returns a formatted WhatsApp-friendly session summary string.
 */
function buildSessionReport(state, nameCache = {}) {
    const sorted = Object.entries(state.scores)
        .sort(([, a], [, b]) => b - a);

    if (!sorted.length) {
        return `📋 *Word Ladder Session Report*\n\nNo scores recorded this session.`;
    }

    const lines = [`🏆 *Word Ladder Session Report*\n`];
    lines.push(`📊 Rounds played: *${state.roundCount}*`);
    lines.push(`📏 Final word length: *${state.wordLength} letters*`);
    lines.push(`🎨 Theme: *${state.theme}*\n`);
    lines.push(`*Final Standings:*`);

    sorted.slice(0, cfg.MAX_PLAYERS_SCOREBOARD).forEach(([num, pts], i) => {
        const name   = nameCache[num] || num;
        const medal  = MEDALS[i] || `${i + 1}.`;
        lines.push(`${medal} *${name}* — ${pts} pts`);
    });

    if (sorted.length > 1) {
        const winner = nameCache[sorted[0][0]] || sorted[0][0];
        lines.push(`\n🎉 Congratulations to *${winner}* for topping the ladder!`);
    }

    lines.push(`\nType *!wlg start* to play again!`);
    return lines.join('\n');
}

/**
 * getTopPlayer(state, nameCache)
 * Returns { name, points } for the current leader, or null.
 */
function getTopPlayer(state, nameCache = {}) {
    const sorted = Object.entries(state.scores).sort(([, a], [, b]) => b - a);
    if (!sorted.length) return null;
    const [num, points] = sorted[0];
    return { name: nameCache[num] || num, points };
}

module.exports = { buildSessionReport, getTopPlayer };
