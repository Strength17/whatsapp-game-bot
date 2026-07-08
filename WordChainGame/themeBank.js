// ============================================================
//  WordChainGame/themeBank.js
//  Curated, admin-editable theme word banks. Small and
//  moderated on purpose — see README.md "Themed Rounds" for
//  why these are unioned with the dictionary instead of
//  replacing it, and why they need periodic upkeep (slang ages
//  out in months; this is just a JSON-shaped object, edit
//  anytime, no code change needed).
// ============================================================

const DEFAULT_WORDS = {
    activeTheme: 'none',   // 'none' | 'genz' | 'gaming' | any custom key an admin adds
    themes: {
        genz: [
            'rizz', 'sigma', 'delulu', 'sus', 'cap', 'bussin', 'slay', 'goat',
            'vibe', 'lit', 'ghost', 'salty', 'extra', 'flex', 'glow', 'mood',
            'simp', 'yeet', 'drip', 'based'
        ],
        gaming: [
            'clutch', 'noob', 'buff', 'nerf', 'spawn', 'grind', 'combo', 'boss',
            'raid', 'loot', 'meta', 'tank', 'heal', 'gank', 'camp', 'kite',
            'proc', 'ping', 'lag', 'op'
        ]
    }
}

module.exports = { DEFAULT_WORDS }
