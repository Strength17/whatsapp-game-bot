// ============================================================
//  numberBank.js — Target Numbers (TGT) · Sky Graphics
//  Rolls a fresh, solver-VERIFIED { numbers, target } pair every round.
//  Tier controls how many "large" numbers (25/50/75/100) are drawn —
//  the real difficulty lever from the source format: one large number
//  is the easiest mix, two large gives the best odds of an exact
//  solution, and zero or four large numbers are the hardest draws.
// ============================================================

const config = require('./config')
const solver = require('./solver')

const TIER_LARGE_COUNT = {
    easy:      () => 1,
    normal:    () => 2,
    difficult: () => (Math.random() < 0.5 ? 0 : 4)
}

const MAX_ATTEMPTS = 40
const ACCEPT_WITHIN = 10 // never serve a round that can't score at all

// Hand-verified fallback (confirmed against solver.js at module load below).
const FALLBACK = { numbers: [25, 50, 75, 100, 3, 6], target: 952 }

function sampleWithoutReplacement(pool, n) {
    const copy = [...pool]
    const out = []
    for (let i = 0; i < n && copy.length > 0; i++) {
        const idx = Math.floor(Math.random() * copy.length)
        out.push(copy[idx])
        copy.splice(idx, 1)
    }
    return out
}

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
}

function rollPool(largeCount) {
    const large = sampleWithoutReplacement(config.LARGE_POOL, largeCount)
    const smallPool = config.SMALL_POOL_EACH_TWICE.flatMap(n => [n, n]) // two of each 1-10
    const small = sampleWithoutReplacement(smallPool, 6 - largeCount)
    return [...large, ...small]
}

/**
 * Rolls a fresh, verified-scoreable { numbers, target } pair for the
 * given tier. Falls back to a hand-verified pair if generation can't
 * find one within MAX_ATTEMPTS — a round can never be served with zero
 * chance of anyone scoring.
 */
function generatePuzzle(tier) {
    const largeCountFn = TIER_LARGE_COUNT[tier] || TIER_LARGE_COUNT.normal

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const largeCount = largeCountFn()
        const numbers = rollPool(largeCount)
        const target = randInt(config.TARGET_MIN, config.TARGET_MAX)

        const best = solver.bestSolution(numbers, target)
        if (best && best.diff <= ACCEPT_WITHIN) {
            return { numbers, target }
        }
    }

    return { numbers: [...FALLBACK.numbers], target: FALLBACK.target }
}

// ─── Self-check: the fallback pair really must be solvable within range,
// verified against the solver at module load, not just asserted here.
function selfCheck() {
    const best = solver.bestSolution(FALLBACK.numbers, FALLBACK.target)
    if (!best || best.diff > ACCEPT_WITHIN) {
        throw new Error(`numberBank.js: fallback puzzle is not within scoring range — fix before shipping.`)
    }
}
selfCheck()

module.exports = { generatePuzzle, TIER_LARGE_COUNT, FALLBACK }
