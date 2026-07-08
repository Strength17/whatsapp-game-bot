// ============================================================
//  config.js — The 24 Game (M4T) · Sky Graphics
// ============================================================

module.exports = {
    GAME_KEY:     'm4th',
    GAME_NAME:    'The 24 Game',
    GAME_ACRONYM: 'M4T',
    PREFIX:       '!m4th',   // public command prefix
    ADMIN_PREFIX: '/m4th ',  // admin command prefix (note trailing space)

    // Tier order used by the adaptive-difficulty drift in gameEngine.js.
    TIERS:      ['easy', 'normal', 'difficult'],
    MIN_TIER:   0,
    MAX_TIER:   2,
    START_TIER: 0,

    // Defaults — all admin-overridable per chat via /m4th set... (stored
    // under settings.m4th.<key>, root settings.json stays game-agnostic).
    ROUND_SECONDS_DEFAULT:      20,
    COOLDOWN_SECONDS_DEFAULT:   4,     // pause between rounds within a session
    ROUNDS_PER_SESSION_DEFAULT: 10,    // 'infinite' also accepted
    SESSION_COOLDOWN_SECONDS:  60,     // pause before an auto-restarted fresh session

    // A round that's solved within this fraction of the round time bumps
    // the tier up; a round nobody solves bumps it down. Same single-signal
    // adaptive pattern used by HangmanGame and WordLadderGame.
    SOLVE_FAST_RATIO: 0.4
}
