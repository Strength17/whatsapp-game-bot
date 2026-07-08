// ============================================================
//  WordChainGame/display.js
//  Small display helpers kept LOCAL to this game folder rather
//  than assumed to exist on the shared root permissions.js —
//  the plugin contract only guarantees tier/name-tag helpers
//  there, not game-specific badges.
//
//  Also home to the identity-band helper (BOT_STYLE_GUIDE.md §1)
//  — "card" messages (lobby open/close, help dashboards, match
//  reports) get the divider/header/footer band; quick
//  transactional replies (single-line confirms/errors) never do.
// ============================================================

const config = require('./config')

const DIFFICULTY_EMOJI = { easy: '🟢', normal: '🟡', difficult: '🔴' }
const DIFFICULTY_LABEL = { easy: 'Easy', normal: 'Normal', difficult: 'Difficult' }
const THEME_EMOJI = { animals: '🐾', food: '🍎' }
const THEME_LABEL = { animals: 'Animals', food: 'Food' }

function difficultyBadge(difficulty) {
    const d = (difficulty || 'easy').toLowerCase()
    return `${DIFFICULTY_EMOJI[d] || '⚪'} *${DIFFICULTY_LABEL[d] || d.toUpperCase()}*`
}

function themeBadge(activeTheme) {
    if (!activeTheme || activeTheme === 'none') return null
    const t = activeTheme.toLowerCase()
    const emoji = THEME_EMOJI[t] || '🎨'
    const label = THEME_LABEL[t] || (t.charAt(0).toUpperCase() + t.slice(1))
    return `${emoji} *Theme: ${label}*`
}

// ─── Identity band (BOT_STYLE_GUIDE.md §1) ─────────────────────────
// Card messages only — lobby open/close, help dashboards, match
// reports. Never use this for a quick transactional confirm/error.
function cardHeader(title) {
    return `${config.DIVIDER}\n${config.BOT_EMOJI} *${title}*\n${config.DIVIDER}\n`
}

function cardFooter() {
    return `\n${config.DIVIDER}\n_${config.GAME_ACRONYM} Bot · Sky Graphics_ 🎨`
}

// Convenience wrapper: header + body + footer, exactly as the style
// guide's template shows. `body` should NOT include its own dividers.
function card(title, body) {
    return `${cardHeader(title)}\n${body}${cardFooter()}`
}

module.exports = { difficultyBadge, themeBadge, cardHeader, cardFooter, card }
