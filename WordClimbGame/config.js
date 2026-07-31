// ============================================================
//  WordClimbGame/config.js — WCL Bot · Sky Graphics
//  Single source of truth for this game's identity + prefixes.
// ============================================================

module.exports = {
    GAME_KEY:      'wordclimb',
    GAME_NAME:     'Word Climb',
    GAME_ACRONYM:  'WCL',

    // Public command prefix (e.g. "!wcl join")
    PREFIX:        '!wcl',
    // Admin command prefix — note trailing space, matches project convention
    ADMIN_PREFIX:  '/wcl ',

    // ── The climb ────────────────────────────────────────────
    // Length starts here and climbs by +1 every time the turn
    // rotation completes a full cycle through the surviving
    // players — never per-turn, so everyone faces each rung
    // of the ladder at the same length before it gets harder.
    MIN_LENGTH:  3,
    MAX_LENGTH:  8,

    // ── Lobby + turn timers ─────────────────────────────────
    LOBBY_SECONDS: 45,
    TURN_SECONDS:  30,

    // ── Strikes ──────────────────────────────────────────────
    // A strike is a timeout OR a wrong/invalid guess. 3 strikes
    // and that player is eliminated from the climb.
    MAX_STRIKES: 3,

    // ── Shared brand identity (mirrors HangmanGame's banding) ──
    BOT_EMOJI: '🧗',
    DIVIDER:   '━━━━━━━━━━━━━━━━━━━━━━'
}
