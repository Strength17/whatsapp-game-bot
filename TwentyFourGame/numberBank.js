// ============================================================
//  numberBank.js — The 24 Game · Sky Graphics
//  Generates fresh, solver-VERIFIED number quadruples per round —
//  no static puzzle list to exhaust or repeat. Difficulty tiers are
//  graded by a real signal (does an integer-only path exist?), the
//  same signature that makes classic hard 24-cards like 1-3-4-6 or
//  3-3-7-7 feel hard to humans: they're only solvable through a
//  fractional intermediate step.
// ============================================================

const solver = require('./solver')

const TIER_ORDER = ['easy', 'normal', 'difficult']

const TIER_RANGES = {
    // easy: small numbers, must have a clean integer-only path
    easy:      { min: 1, max: 9,  requireIntegerPath: true,  requireFractionOnly: false },
    // normal: slightly wider range, any valid solution counts
    normal:    { min: 1, max: 10, requireIntegerPath: false, requireFractionOnly: false },
    // difficult: solvable ONLY via a fraction step — the classic "hard card" signature
    difficult: { min: 2, max: 13, requireIntegerPath: false, requireFractionOnly: true  }
}

// Hand-verified seeds (confirmed against solver.js — see build notes) used
// only as a fallback if random generation can't find a match in time, so a
// round can never be served unsolvable.
const FALLBACK_PUZZLES = {
    easy:      [[1, 2, 3, 4], [2, 2, 2, 3], [1, 1, 4, 6], [1, 2, 3, 6]],
    normal:    [[2, 3, 4, 6], [4, 4, 10, 10], [1, 2, 7, 7], [3, 4, 5, 6]],
    difficult: [[3, 3, 7, 7], [1, 3, 4, 6], [5, 5, 5, 1], [3, 3, 8, 8]]
}

const MAX_ATTEMPTS = 250

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Rolls a fresh, verified-solvable quadruple for the given tier.
 * Falls back to a hand-verified seed puzzle if generation can't find a
 * qualifying combination within MAX_ATTEMPTS (rare, but keeps the game
 * from ever stalling or serving something unsolvable).
 */
function generatePuzzle(tier) {
    const cfg = TIER_RANGES[tier] || TIER_RANGES.normal

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const numbers = [
            randInt(cfg.min, cfg.max), randInt(cfg.min, cfg.max),
            randInt(cfg.min, cfg.max), randInt(cfg.min, cfg.max)
        ]

        const intSolvable = solver.findSolution(numbers, 24, true).solvable
        const anySolvable = intSolvable || solver.findSolution(numbers, 24, false).solvable

        if (cfg.requireIntegerPath && intSolvable) return numbers
        if (cfg.requireFractionOnly && anySolvable && !intSolvable) return numbers
        if (!cfg.requireIntegerPath && !cfg.requireFractionOnly && anySolvable) return numbers
    }

    const seeds = FALLBACK_PUZZLES[tier] || FALLBACK_PUZZLES.normal
    return [...seeds[Math.floor(Math.random() * seeds.length)]]
}

// ─── Self-check: verify every fallback seed really is solvable (and that
// "difficult" seeds really do require a fraction) the moment this module
// loads. Throws loudly at boot rather than silently risking a bad round.
function selfCheck() {
    for (const tier of TIER_ORDER) {
        for (const puzzle of FALLBACK_PUZZLES[tier]) {
            const any = solver.findSolution(puzzle, 24, false).solvable
            if (!any) {
                throw new Error(`numberBank.js: fallback puzzle [${puzzle}] for tier "${tier}" is NOT solvable — fix before shipping.`)
            }
            if (TIER_RANGES[tier].requireFractionOnly) {
                const intOnly = solver.findSolution(puzzle, 24, true).solvable
                if (intOnly) {
                    throw new Error(`numberBank.js: fallback puzzle [${puzzle}] for tier "${tier}" has an integer-only path, so it isn't actually "difficult" — fix before shipping.`)
                }
            }
        }
    }
}
selfCheck()

module.exports = {
    TIER_ORDER,
    TIER_RANGES,
    FALLBACK_PUZZLES,
    generatePuzzle
}
