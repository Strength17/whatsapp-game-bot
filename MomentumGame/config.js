// MomentumGame/config.js
// Plugin contract: GAME_KEY, GAME_NAME, PREFIX, ADMIN_PREFIX are required.
// Everything else here is Momentum-specific tuning.

module.exports = {
    GAME_KEY:     'momentum',
    GAME_NAME:    'Momentum',
    GAME_ACRONYM: 'MMT',
    PREFIX:       '!mmt',        // public command prefix (group + DM picks)
    ADMIN_PREFIX: '/mmt ',       // admin command prefix — note trailing space

    // ── Round timing ─────────────────────────────────────────
    ROUND_DURATION_MS:  60 * 1000,   // how long players have to DM a pick
    COOLDOWN_MS:        20 * 1000,   // gap between reveal and the next round opening
    MIN_PICKS_TO_SCORE: 2,           // fewer than this and the round is void (no scoring, no meter shift)

    // ── The meter ────────────────────────────────────────────
    // 0 = fully leaning 🌊, 100 = fully leaning ⚡. Starts centered.
    METER_START: 50,
    METER_STEP:  4,     // % the meter shifts per net (⚡ picks − 🌊 picks) this round
    METER_MAX_SHIFT_PER_ROUND: 30, // clamp so one lopsided round can't slam the meter to an edge instantly

    // ── Flavor event thresholds ──────────────────────────────
    // Distance from either edge (0 or 100) at which these trigger, checked
    // against the meter value BEFORE the round's picks are tallied — so the
    // "High Tension" banner can be announced honestly when the round opens.
    DOUBLE_POINTS_EDGE_DISTANCE: 15,  // meter within 15 of 0 or 100 → this round scores double
    REVEAL_PICKS_EDGE_DISTANCE:   5,  // meter within 5 of 0 or 100 AFTER the round → reveal shows who picked what, not just totals

    // ── Symbols ──────────────────────────────────────────────
    SYMBOLS: { A: '⚡', B: '🌊' },
    // Accepted DM input, case-insensitive, mapped to the internal A/B key.
    // Both the raw emoji and a couple of plain-text aliases are accepted so
    // a picker doesn't need an emoji keyboard.
    SYMBOL_ALIASES: {
        '⚡': 'A', 'lightning': 'A', 'bolt': 'A', 'a': 'A',
        '🌊': 'B', 'wave': 'B', 'water': 'B', 'b': 'B'
    },

    HISTORY_LENGTH: 10 // how many past rounds to keep for /mmt status and !mmt scores context
}
