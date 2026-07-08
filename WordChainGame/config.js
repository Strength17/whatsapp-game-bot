// ============================================================
//  WordChainGame/config.js
//  Single shared source for this game's identity, per the
//  plugin contract in ARCHITECTURE.md. Every other file in this
//  folder imports these instead of hardcoding the prefix or
//  name anywhere.
// ============================================================

module.exports = {
    GAME_KEY:      'wordchain',
    GAME_NAME:     'Word Chain',
    GAME_ACRONYM:  'WCG',
    PREFIX:        '!wcg',
    ADMIN_PREFIX:  '/wcg ',

    LOBBY_SECONDS: 60,

    // ── Difficulty is now fully automatic — one merged tier table,
    // no more separate manual difficulty/timer/strikes settings. See
    // README.md "Adaptive difficulty" for the drift rule.
    TIERS: ['easy', 'normal', 'difficult'],
    MIN_TIER:   0,
    MAX_TIER:   2,
    START_TIER: 0,
    TIER_CONFIG: {
        easy:      { minLength: 3, timerSeconds: 30, maxStrikes: 4 },
        normal:    { minLength: 4, timerSeconds: 25, maxStrikes: 3 },
        difficult: { minLength: 5, timerSeconds: 20, maxStrikes: 2 }
    },
    MIN_TIMER_SECONDS: 20, // hard floor regardless of tier — connection-lag safety

    // ── Adaptive drift signal (computed once per completed match) ──
    // strikeRate = totalStrikes / totalTurnsTaken across the whole match.
    // High strike rate -> the group is struggling -> ease off next match.
    // Low strike rate  -> the group is cruising   -> ramp up next match.
    STRIKE_RATE_EASIER_ABOVE: 0.40,
    STRIKE_RATE_HARDER_BELOW: 0.10,

    // ── Engagement: chain-length milestones get a celebratory callout ──
    CHAIN_MILESTONES: [10, 25, 50, 75, 100, 150, 200],

    DEFAULT_MAX_STRIKES: 3 // fallback only, e.g. before a tier is resolved
}
