// ============================================================
//  WordChainGame/config.js
//  Single shared source for this game's identity, per the
//  plugin contract in the project root README.md. Every other
//  file in this folder imports these instead of hardcoding the
//  prefix or name anywhere.
// ============================================================

module.exports = {
    GAME_KEY:      'wordchain',
    GAME_NAME:     'Word Chain',
    GAME_ACRONYM:  'WCG',
    PREFIX:        '!wcg',
    ADMIN_PREFIX:  '/wcg ',

    LOBBY_SECONDS: 60,

    // ── Difficulty (unchanged from the standalone build) ─────
    DIFFICULTY_CONFIG: {
        easy:      { minLength: 3, timerSeconds: 30 },
        normal:    { minLength: 4, timerSeconds: 25 },
        difficult: { minLength: 5, timerSeconds: 20 }
    },
    MIN_TIMER_SECONDS: 20,  // floor kept even on manual overrides — connection-lag safety
    DEFAULT_MAX_STRIKES: 3
}
