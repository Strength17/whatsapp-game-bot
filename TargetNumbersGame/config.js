// ============================================================
//  config.js — Target Numbers (TGT) · Sky Graphics
//  Inspired by the classic "numbers round" format used by several
//  long-running TV arithmetic game shows — not a reproduction of any
//  one show's branding, just the same public-domain arithmetic puzzle
//  mechanic: combine numbers to hit a target.
// ============================================================

module.exports = {
    GAME_KEY:     'target',
    GAME_NAME:    'Target Numbers',
    GAME_ACRONYM: 'TGT',
    PREFIX:       '!tgt',   // public command prefix
    ADMIN_PREFIX: '/tgt ',  // admin command prefix (note trailing space)

    LARGE_POOL: [25, 50, 75, 100],
    SMALL_POOL_EACH_TWICE: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],

    TIERS:      ['easy', 'normal', 'difficult'],
    MIN_TIER:   0,
    MAX_TIER:   2,
    START_TIER: 0,

    TARGET_MIN: 101,
    TARGET_MAX: 999,

    // Scoring — mirrors the real numbers-round partial-credit curve.
    SCORE_EXACT:  10,
    SCORE_WITHIN_5:  7,
    SCORE_WITHIN_10: 5,

    ROUND_SECONDS_DEFAULT:      45,
    COOLDOWN_SECONDS_DEFAULT:   4,
    ROUNDS_PER_SESSION_DEFAULT: 8,
    SESSION_COOLDOWN_SECONDS:  60,

    // Adaptive drift signal: an exact or near-exact (within 5) solve
    // reached quickly bumps the tier up; a round where nobody gets
    // within 10 bumps it down. Same single-signal pattern as every
    // other game in this project.
    SOLVE_FAST_RATIO: 0.5
}
