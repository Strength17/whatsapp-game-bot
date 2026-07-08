// ============================================================
//  WordChainGame/config.js
//  Single shared source for this game's identity, per the
//  plugin contract (ARCHITECTURE.md). Every other file in this
//  folder imports these instead of hardcoding anything.
//
//  Difficulty has two layers that never fight each other:
//   1. `tier` — persists PER CHAT, across matches. Drifts once
//      per match (driftTierForNextMatch in gameEngine.js) based
//      on how the group performed. This is the "next session
//      starts a little harder/easier" memory.
//   2. Live in-match progression — as THIS match's chain grows,
//      PROGRESSION_STEPS tightens minLength/timer further, on
//      top of whatever tier the match started at. One clock,
//      not two conflicting ones: tier sets the starting point,
//      progression climbs from there as the round plays out.
//
//  `/wcg set difficulty|strikes|timer` are intentionally gone —
//  none of this is admin-settable. `/wcg status` reports it
//  read-only. The only thing an admin *can* tune is how long a
//  match runs (`/wcg set duration`), because that's a scheduling
//  preference, not a difficulty knob.
// ============================================================

module.exports = {
    GAME_KEY:      'wordchain',
    GAME_NAME:     'Word Chain',
    GAME_ACRONYM:  'WCG',
    PREFIX:        '!wcg',
    ADMIN_PREFIX:  '/wcg ',

    // ── Brand / identity band (BOT_STYLE_GUIDE.md §1) ──
    DIVIDER:   '━━━━━━━━━━━━━━━━━━━━━━',
    BOT_EMOJI: '🤖',

    LOBBY_SECONDS: 60,
    MIN_TIMER_SECONDS: 20,   // hard floor regardless of tier/progression — connection-lag safety
    MAX_MIN_LENGTH:     8,   // hard ceiling on required word length — stays humanly playable

    // ── Tier axis: persists per chat, drifts once per MATCH ──
    // minLength / timerSeconds / maxStrikes all live on the same
    // table so there is exactly one number to drift, not three
    // settings that can drift out of sync with each other. This
    // is the STARTING point for a match — see PROGRESSION_STEPS
    // below for what happens live, during the match, on top of it.
    TIER_NAMES: ['easy', 'normal', 'difficult'],
    TIER_TABLE: [
        { minLength: 3, timerSeconds: 30, maxStrikes: 4 },  // tier 0 — easy
        { minLength: 4, timerSeconds: 25, maxStrikes: 3 },  // tier 1 — normal
        { minLength: 5, timerSeconds: 20, maxStrikes: 3 }   // tier 2 — difficult
    ],
    MAX_TIER: 2,   // TIER_TABLE.length - 1

    // ── Auto-drift thresholds — evaluated once per MATCH, not per turn ──
    // strikeRate = totalStrikes / totalTurnsTaken across the whole match.
    // This is what makes tomorrow's match start harder than today's if
    // the group is cruising — the "increasing over time" the word length
    // is supposed to have, carried match to match, per chat.
    DRIFT_STRUGGLE_STRIKE_RATE: 0.4,   // above this → drift easier (tier - 1)
    DRIFT_CRUISE_STRIKE_RATE:   0.1,   // below this → drift harder (tier + 1)

    // ── Live in-match progression — evaluated after EVERY accepted word ──
    // Each step's deltas REPLACE (not stack onto) the previous step's —
    // find the highest atChainLength the current chain has reached and
    // apply that step's deltas on top of the match's starting tier config.
    // Strikes intentionally never tighten mid-match (would risk an
    // instant, confusing elimination for a player already near their
    // strike cap under the old rule) — only length and pace do.
    PROGRESSION_STEPS: [
        { atChainLength: 8,  minLengthDelta: 1, timerDelta: -3  },
        { atChainLength: 16, minLengthDelta: 2, timerDelta: -6  },
        { atChainLength: 26, minLengthDelta: 3, timerDelta: -9  },
        { atChainLength: 40, minLengthDelta: 4, timerDelta: -12 }
    ],

    // ── Themes — common, everyday umbrella categories, not slang ──
    // "Animals" swallows mammals/birds/insects/reptiles as ONE wide
    // category instead of fragmenting the pool; "Food" swallows
    // fruit/veg/dishes the same way. Wide pools = fewer accidental
    // dead-ends and words everyone actually recognizes.
    THEME_ROTATION_ORDER: ['animals', 'food'],
    // How many words a group must land IN A ROW, with no strike, before
    // the active theme auto-rotates to the next one. A strike resets
    // this counter to 0 — struggling groups simply stay on the current
    // theme longer, they're never punished with a switch. This is a
    // QUALIFICATION gate, not a timer — nothing about theme rotation is
    // time-based, only the match itself is (see MATCH_DURATION below).
    THEME_ROTATION_QUALIFY: 6,

    // ── Match duration — the ONLY thing that ends a match without a
    // winner/loser being decided by play. Dynamic (admin can retune it
    // live) but always has sane defaults and hard bounds so it can never
    // be set to something silly (a 5-second match, a 6-hour match).
    // Stored, when overridden, as `wordchain_matchDurationSeconds` — a
    // GAME_KEY-prefixed setting per ARCHITECTURE.md §4.
    MATCH_DURATION_SECONDS:     300,   // 5 minutes — the requested default
    MIN_MATCH_DURATION_SECONDS: 60,    // 1 minute floor
    MAX_MATCH_DURATION_SECONDS: 3600,  // 60 minute ceiling

    // How long the "match over" cooldown lasts before the engine opens a
    // fresh lobby on its own — no admin has to type /wcg start again.
    AUTO_RESTART_COOLDOWN_SECONDS: 15,

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
