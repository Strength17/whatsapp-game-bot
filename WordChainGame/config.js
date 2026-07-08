// ============================================================
//  WordChainGame/config.js
//  Single shared source for this game's identity, per the
//  plugin contract (ARCHITECTURE.md). Every other file in this
//  folder imports these instead of hardcoding anything.
//
//  Difficulty is now ONE axis (tier), not three independent
//  manual settings. See gameEngine.js `driftTier()` — the tier
//  auto-adjusts once per match based on how the group performed,
//  no admin command needed. `/wcg set difficulty|strikes|timer`
//  are intentionally gone; `/wcg status` reports the current
//  auto-tier read-only.
// ============================================================

module.exports = {
    GAME_KEY:      'wordchain',
    GAME_NAME:     'Word Chain',
    GAME_ACRONYM:  'WCG',
    PREFIX:        '!wcg',
    ADMIN_PREFIX:  '/wcg ',

    LOBBY_SECONDS: 60,
    MIN_TIMER_SECONDS: 20,   // hard floor regardless of tier — connection-lag safety

    // ── One difficulty axis: tier 0/1/2 = easy/normal/difficult ──
    // minLength / timerSeconds / maxStrikes all live on the same
    // table so there is exactly one number to drift, not three
    // settings that can drift out of sync with each other.
    TIER_NAMES: ['easy', 'normal', 'difficult'],
    TIER_TABLE: [
        { minLength: 3, timerSeconds: 30, maxStrikes: 4 },  // tier 0 — easy
        { minLength: 4, timerSeconds: 25, maxStrikes: 3 },  // tier 1 — normal
        { minLength: 5, timerSeconds: 20, maxStrikes: 3 }   // tier 2 — difficult
    ],
    MAX_TIER: 2,   // TIER_TABLE.length - 1

    // ── Auto-drift thresholds — evaluated once per MATCH, not per turn ──
    // strikeRate = totalStrikes / totalTurnsTaken across the whole match.
    DRIFT_STRUGGLE_STRIKE_RATE: 0.4,   // above this → drift easier (tier - 1)
    DRIFT_CRUISE_STRIKE_RATE:   0.1,   // below this → drift harder (tier + 1)

    // ── Milestones — fired once per match the first time the chain
    // reaches these lengths. Purely celebratory, no gameplay effect;
    // per gamification research, milestones + personal bests drive
    // more sustained engagement than a leaderboard alone, and don't
    // carry the loss-aversion pressure a daily streak would.
    CHAIN_MILESTONES: [
        { length: 5,  text: '🔥 *5-word chain!* Warming up.' },
        { length: 10, text: "🚀 *10-word chain!* This one's cooking." },
        { length: 20, text: '🌟 *20-word chain!* Certified legendary run.' },
        { length: 30, text: '👑 *30-word chain!* Are you even human?' }
    ]
}
