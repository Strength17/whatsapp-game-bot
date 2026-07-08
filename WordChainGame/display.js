// ============================================================
//  WordChainGame/display.js
//  Small display helpers kept LOCAL to this game folder rather
//  than assumed to exist on the shared root permissions.js —
//  the plugin contract only guarantees tier/name-tag helpers
//  there, not game-specific badges.
// ============================================================

const DIFFICULTY_EMOJI = { easy: '🟢', normal: '🟡', difficult: '🔴' }
const DIFFICULTY_LABEL = { easy: 'Easy', normal: 'Normal', difficult: 'Difficult' }

function difficultyBadge(difficulty) {
    const d = (difficulty || 'easy').toLowerCase()
    return `${DIFFICULTY_EMOJI[d] || '⚪'} *${DIFFICULTY_LABEL[d] || d.toUpperCase()}*`
}

function themeBadge(activeTheme) {
    if (!activeTheme || activeTheme === 'none') return null
    return `🎨 *Theme: ${activeTheme.toUpperCase()}*`
}

module.exports = { difficultyBadge, themeBadge }
