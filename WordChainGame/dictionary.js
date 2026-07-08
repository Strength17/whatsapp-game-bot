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
let byFirstLetter = null // { [letter]: string[] } — built once, used by findHintCandidate

function loadDictionary() {
    if (wordSet) return wordSet
    const raw = fs.readFileSync(wordListPath, 'utf8')
    const words = raw.split('\n').map(w => w.trim().toLowerCase()).filter(Boolean)
    wordSet = new Set(words)

    byFirstLetter = {}
    for (const w of words) {
        const letter = w[0]
        if (!byFirstLetter[letter]) byFirstLetter[letter] = []
        byFirstLetter[letter].push(w)
    }

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

/**
 * Finds one valid, not-yet-used candidate word for a hint — starting
 * with `requiredLetter`, at least `minLength` letters, real dictionary
 * word or theme word. Returns a random pick among matches (capped scan)
 * so hints aren't always the same word, or null if nothing qualifies.
 * The CALLER only ever reveals a short prefix of this, never the whole
 * thing — see gameEngine.js getHint().
 */
function findHintCandidate(requiredLetter, minLength, usedWords, themeWords) {
    loadDictionary()
    const usedSet = new Set(usedWords || [])
    const pool = []

    if (requiredLetter) {
        const bucket = byFirstLetter[requiredLetter] || []
        for (const w of bucket) {
            if (w.length >= minLength && !usedSet.has(w)) {
                pool.push(w)
                if (pool.length >= 25) break // cap the scan, we only need variety, not completeness
            }
        }
        if (themeWords) {
            for (const w of themeWords) {
                if (w[0] === requiredLetter && w.length >= minLength && !usedSet.has(w)) pool.push(w)
            }
        }
    } else {
        // First word of the chain — no required letter yet, just anything valid.
        for (const letter of Object.keys(byFirstLetter)) {
            for (const w of byFirstLetter[letter]) {
                if (w.length >= minLength && !usedSet.has(w)) {
                    pool.push(w)
                    break
                }
            }
            if (pool.length >= 25) break
        }
    }

    if (pool.length === 0) return null
    return pool[Math.floor(Math.random() * pool.length)]
}

module.exports = { loadDictionary, isRealWord, dictionarySize, isAcceptedWord, findHintCandidate }
