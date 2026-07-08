// ============================================================
//  WordChainGame/dictionary.js
//  Offline English word validation via the "word-list" npm package
//  (~370k words, bundled locally — zero network calls, zero API
//  keys, fully offline once installed).
//
//  Theme banks (Gen Z slang, gaming terms, etc.) are UNIONED with
//  this dictionary, never used as a replacement — see README.md
//  "Themed Rounds" section for why a theme-only pool would dead-end
//  chains and reject exactly the words it's supposed to celebrate.
// ============================================================

const fs = require('fs')
const wordListRaw = require('word-list')
// Some Node/npm combinations resolve this CJS package through an ESM
// interop wrapper, returning { default: '<path>' } instead of the plain
// path string. Handle both shapes defensively.
const wordListPath = (typeof wordListRaw === 'string') ? wordListRaw : wordListRaw.default

let wordSet = null

function loadDictionary() {
    if (wordSet) return wordSet
    const raw = fs.readFileSync(wordListPath, 'utf8')
    wordSet = new Set(
        raw.split('\n').map(w => w.trim().toLowerCase()).filter(Boolean)
    )
    console.log(`📖 Word Chain dictionary loaded: ${wordSet.size} words`)
    return wordSet
}

function isRealWord(word) {
    if (!word || !/^[a-zA-Z]+$/.test(word)) return false
    const set = loadDictionary()
    return set.has(word.toLowerCase())
}

function dictionarySize() {
    return loadDictionary().size
}

// ─── Hint support ───────────────────────────────────────────────
// Lazily built once, on first hint request — an index of words by
// first letter so !wcg hint doesn't scan the full ~370k-word set
// every time it's asked.
let byFirstLetter = null

function buildFirstLetterIndex() {
    if (byFirstLetter) return byFirstLetter
    byFirstLetter = {}
    for (const w of loadDictionary()) {
        const c = w[0]
        if (!byFirstLetter[c]) byFirstLetter[c] = []
        byFirstLetter[c].push(w)
    }
    return byFirstLetter
}

/**
 * Returns just the first two letters of ONE valid candidate word — never
 * the full word — so a hint nudges without solving the turn outright.
 * @returns {string|null} e.g. "ap" for "apple", or null if nothing fits
 */
function getHintFragment(letter, minLength, usedWords, themeWords) {
    const index = buildFirstLetterIndex()
    const pool = (index[letter] || []).filter(w =>
        w.length >= minLength && !usedWords.includes(w)
    )
    const combined = pool.concat((themeWords || []).filter(w =>
        w[0] === letter && w.length >= minLength && !usedWords.includes(w)
    ))
    if (combined.length === 0) return null
    const pick = combined[Math.floor(Math.random() * combined.length)]
    return pick.slice(0, 2)
}

/**
 * Accepts a word if it's either in the offline dictionary OR in the
 * currently active theme bank. The dictionary is always the fallback —
 * theme lists only ever ADD accepted words, they never remove the
 * baseline pool a chain needs to avoid dead-ending.
 *
 * @param {string} word
 * @param {string[]} themeWords — lowercase words from the active theme, or []
 */
function isAcceptedWord(word, themeWords) {
    if (!word || !/^[a-zA-Z]+$/.test(word)) return false
    const lower = word.toLowerCase()
    if (isRealWord(lower)) return true
    if (themeWords && themeWords.includes(lower)) return true
    return false
}

module.exports = { loadDictionary, isRealWord, dictionarySize, isAcceptedWord, getHintFragment }
