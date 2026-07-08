// ============================================================
//  games-registry.js — HMG Bot · Sky Graphics
//  Central registry of pluggable games. Each game lives in its own
//  folder (e.g. /HangmanGame, /WordLadderGame) and exports:
//    config.js          — GAME_KEY, GAME_NAME, PREFIX, ADMIN_PREFIX, ...
//    gameEngine.js       — pure game logic
//    adminCommands.js    — "/" command handler for that game
//
//  Adding a new game = drop its folder in the project root with those
//  three files and it is auto-discovered below. Nothing else in the
//  project needs to change. See README.md for the exact contract.
// ============================================================

const fs   = require('fs')
const path = require('path')

function tryLoadGame(folderName) {
    const dir        = path.join(__dirname, folderName)
    const configPath = path.join(dir, 'config.js')
    if (!fs.existsSync(configPath)) return null

    try {
        const config        = require(path.join(dir, 'config.js'))
        const gameEngine    = require(path.join(dir, 'gameEngine.js'))
        const adminCommands = require(path.join(dir, 'adminCommands.js'))

        if (!config.GAME_KEY || !config.PREFIX || !config.ADMIN_PREFIX) {
            console.log(`[registry] ${folderName}/config.js is missing GAME_KEY/PREFIX/ADMIN_PREFIX — skipped.`)
            return null
        }

        return { folderName, config, gameEngine, adminCommands }
    } catch (err) {
        console.log(`[registry] Could not load game from ${folderName}:`, err.message)
        return null
    }
}

const REGISTRY = {}

for (const folder of ['HangmanGame', 'WordLadderGame']) {
    const game = tryLoadGame(folder)
    if (game) REGISTRY[game.config.GAME_KEY] = game
}

function listGameKeys() {
    return Object.keys(REGISTRY)
}

function getGame(key) {
    return REGISTRY[(key || '').toLowerCase()] || null
}

/**
 * Returns the currently active game module, falling back to hangman
 * (or whatever loaded first) if the configured key isn't available.
 */
function getActiveGame(settings) {
    const key = (settings && settings.activeGame) || 'hangman'
    return REGISTRY[key] || REGISTRY['hangman'] || Object.values(REGISTRY)[0] || null
}

module.exports = { REGISTRY, listGameKeys, getGame, getActiveGame }
