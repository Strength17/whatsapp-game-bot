// WordLadderGame/config.js
// Plug-in contract: GAME_KEY, GAME_NAME, GAME_ACRONYM, PREFIX, ADMIN_PREFIX
// Drop this folder in the project root — zero changes to any existing file needed.

module.exports = {
    GAME_KEY:     'wordladder',
    GAME_NAME:    'Word Ladder Game',
    GAME_ACRONYM: 'WLG',
    PREFIX:       '!wlg',
    ADMIN_PREFIX: '/wlg ',

    // ── Timing ──────────────────────────────────────────────────────────────
    TURN_TIMEOUT_MS:     60_000,   // 60 s per guess before auto-skip
    HINT_DELAY_MS:       30_000,   // hint fires after 30 s of silence
    ROUND_COOLDOWN_MS:   90_000,   // 90 s between rounds
    COOLDOWN_WARNING_MS: 30_000,   // "starting in 30 s" ping

    // ── Difficulty / adaptive knobs ──────────────────────────────────────────
    MIN_WORD_LENGTH:  3,
    MAX_WORD_LENGTH:  6,
    START_WORD_LENGTH: 4,          // first round word length
    // Adaptive: if group solves in ≤ MIN_STEPS steps → lengthen; if they time out → shorten
    MIN_STEPS_FOR_UPGRADE: 3,      // chain too easy — nudge up
    MAX_TIMEOUTS_FOR_DOWNGRADE: 2, // two timeouts in a row — nudge down

    // ── Scoring ─────────────────────────────────────────────────────────────
    POINTS_CORRECT_STEP:  10,  // each correct word in the ladder
    POINTS_FIRST_SOLVE:   30,  // bonus for the player who completes the chain
    POINTS_HINT_PENALTY: -5,   // deducted from the requesting player only
    POINTS_SKIP_PENALTY: -5,   // auto-skip for timeout

    // ── Themes (5 built-in) ──────────────────────────────────────────────────
    // 'general' uses the open dictionary; others restrict start/end pairs
    THEMES: ['general', 'animals', 'food', 'nature', 'tech'],
    DEFAULT_THEME: 'general',

    // ── Misc ─────────────────────────────────────────────────────────────────
    MAX_HINTS_PER_ROUND: 2,
    MAX_PLAYERS_SCOREBOARD: 10,
};
