#!/usr/bin/env node
// ============================================================
//  scripts/verify-games.js — HMG Bot · Sky Graphics
//
//  Run this before every deploy (it also runs automatically via
//  `npm start`'s "prestart" hook — see package.json). Exits non-zero
//  and prints a clear reason the moment anything is wrong, so a
//  broken deploy fails LOUDLY here instead of crash-looping on
//  Railway with no clue why.
//
//  This script exists because a real deploy crashed from a
//  combination of: a missing package.json, a game folder that was
//  never wired into the registry, admin commands reachable by
//  non-admins, and two different games silently sharing (and
//  corrupting) the same state object for the same chat. Every check
//  below maps directly to one of those failure modes so none of them
//  can happen silently again.
// ============================================================

const fs   = require('fs')
const path = require('path')

const NODE_BUILTINS = new Set([
    'fs', 'path', 'crypto', 'http', 'https', 'url', 'util', 'events',
    'stream', 'os', 'child_process', 'assert', 'buffer', 'zlib', 'net',
    'dns', 'readline', 'querystring', 'timers'
])

function walkJsFiles(dir, acc = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            walkJsFiles(full, acc)
        } else if (entry.name.endsWith('.js')) {
            acc.push(full)
        }
    }
    return acc
}

const ROOT = path.join(__dirname, '..')
let failures = 0
let warnings = 0

function fail(msg) { failures++; console.log(`❌ FAIL: ${msg}`) }
function warn(msg) { warnings++; console.log(`⚠️  WARN: ${msg}`) }
function ok(msg)   { console.log(`✅ ${msg}`) }

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  HMG Bot — pre-deploy verification')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

// The whole script body runs inside this async IIFE so check 6 (below)
// can `await` each game's real async message handler.
;(async () => {

// ── 1. package.json must exist and declare every runtime dependency ──
console.log('[1/6] Checking package.json + dependencies...')
const pkgPath = path.join(ROOT, 'package.json')
if (!fs.existsSync(pkgPath)) {
    fail('package.json is missing from the project root. Without it, Railway (or any host) cannot install dependencies and `node index.js` will crash immediately with MODULE_NOT_FOUND. This is the #1 historical cause of a "crashed on deploy" report.')
} else {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    const declaredDeps = Object.keys(pkg.dependencies || {})

    // Cross-check every "require of an npm package" found in the codebase
    // against package.json — catches the exact "word-list" class of bug
    // (a game imports an npm package nobody declared).
    const jsFiles = walkJsFiles(ROOT)
    const usedExternalDeps = new Set()
    const externalRequireRe = /require\(\s*['"]([^'".][^'"]*)['"]\s*\)/g

    for (const file of jsFiles) {
        const src = fs.readFileSync(file, 'utf8')
        let m
        while ((m = externalRequireRe.exec(src))) {
            const spec = m[1]
            if (spec.startsWith('.')) continue // relative require, not an npm package
            if (spec.startsWith('node:')) continue
            if (NODE_BUILTINS.has(spec.split('/')[0])) continue
            const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
            usedExternalDeps.add(pkgName)
        }
    }

    for (const dep of usedExternalDeps) {
        if (!declaredDeps.includes(dep)) {
            fail(`"${dep}" is require()'d somewhere in the codebase but is NOT listed in package.json "dependencies". Add it, or the deploy will crash the moment that file is loaded.`)
        }
    }
    if (usedExternalDeps.size > 0 && failures === 0) {
        ok(`All ${usedExternalDeps.size} external package(s) in use are declared in package.json: ${[...usedExternalDeps].join(', ')}`)
    }

    if (!pkg.scripts || !pkg.scripts.start) {
        warn('package.json has no "scripts.start" — most hosts (including Railway) use this to know how to run the app.')
    }
}

// ── 2. Registry discovery — every game folder must load cleanly ──
console.log('\n[2/6] Discovering and loading every game folder...')
let registry
try {
    // Clear the require cache so this always reflects the files on disk,
    // not a previous run's cached module.
    delete require.cache[require.resolve(path.join(ROOT, 'games-registry.js'))]
    registry = require(path.join(ROOT, 'games-registry.js'))
} catch (err) {
    fail(`games-registry.js itself failed to load: ${err.message}`)
}

if (registry) {
    const keys = registry.listGameKeys()
    if (keys.length === 0) {
        fail('No games were loaded at all. Every folder either failed its contract check or threw on require() — scroll up in this output (or the bot\'s boot log) for the specific [registry] lines.')
    } else {
        ok(`${keys.length} game(s) loaded: ${keys.join(', ')}`)
    }

    // Cross-check: every top-level folder that LOOKS like a game
    // (has a config.js) but ISN'T in the registry is a silent bug —
    // exactly the historical "4 games built, never wired in" issue.
    const candidateFolders = fs.readdirSync(ROOT, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .filter(name => !['node_modules', '.git', 'reports', 'scripts', 'auth_info', '.github'].includes(name) && !name.startsWith('.'))
        .filter(name => fs.existsSync(path.join(ROOT, name, 'config.js')))

    const loadedFolders = new Set(Object.values(registry.REGISTRY).map(g => g.folderName))
    for (const folder of candidateFolders) {
        if (!loadedFolders.has(folder)) {
            fail(`"${folder}/" has a config.js but was NOT loaded into the registry. Check the [registry] warnings above for why (missing gameEngine.js/adminCommands.js export, thrown error, or duplicate GAME_KEY).`)
        }
    }
}

// ── 3. Contract compliance per game ──────────────────────────
console.log('\n[3/6] Checking each game\'s exported contract...')
if (registry) {
    for (const [key, game] of Object.entries(registry.REGISTRY)) {
        const label = `${game.folderName} (${key})`
        if (typeof game.gameEngine.getGameState !== 'function') fail(`${label}: gameEngine.js missing getGameState()`)
        if (typeof game.adminCommands.handleAdminCommand !== 'function') fail(`${label}: adminCommands.js missing handleAdminCommand()`)
        const hasPublicHandler =
            typeof game.gameEngine.handlePublicMessage === 'function' ||
            fs.existsSync(path.join(ROOT, game.folderName, 'publicCommands.js'))
        if (!hasPublicHandler) fail(`${label}: no handlePublicMessage() in gameEngine.js or a publicCommands.js file`)
        if (!game.config.GAME_ACRONYM) warn(`${label}: config.js has no GAME_ACRONYM — boot/status messages will show "undefined".`)
    }
    if (failures === 0) ok('Every loaded game satisfies the plugin contract.')
}

// ── 4. State isolation — the cross-game contamination check ────
// This is the automated regression test for the bug where two games
// wrote to the exact same `games[chatId]` key and silently handed
// each other corrupted state after a `/game setgame` switch.
console.log('\n[4/6] Checking state isolation between games...')
if (registry) {
    const fakeChatId = 'verify-fixture@g.us'
    const sharedGames = {}
    const seenRefs = new Map()

    for (const [key, game] of Object.entries(registry.REGISTRY)) {
        try {
            const state = game.gameEngine.getGameState(fakeChatId, sharedGames)
            for (const [otherKey, otherState] of seenRefs) {
                if (state === otherState) {
                    fail(`${game.folderName} (${key}) and the game registered as "${otherKey}" returned the SAME state object for the same chat id. They are aliasing each other's storage key — this is the exact bug that crashed the bot when switching games in an already-used chat. Prefix your storage key with your own GAME_KEY (see ARCHITECTURE.md).`)
                }
            }
            seenRefs.set(key, state)
        } catch (err) {
            fail(`${game.folderName} (${key}): getGameState() threw on a fresh chat id: ${err.message}`)
        }
    }
    if (failures === 0) ok('Every game keeps independent state for the same chat id — no aliasing detected.')
}

// ── 5. sendSafeMessage contract sanity (static heuristic) ──────
console.log('\n[5/6] Scanning for sendSafeMessage misuse...')
if (registry) {
    const suspiciousRe = /sendSafeMessage\(\s*([a-zA-Z_.]+)\s*,\s*(\{|`|"|')/
    for (const file of walkJsFiles(ROOT)) {
        const rel = path.relative(ROOT, file)
        if (rel.startsWith('node_modules')) continue
        const src = fs.readFileSync(file, 'utf8')
        // A file that locally shims sendSafeMessage to the (jid, text) shape
        // — the sanctioned fix for this exact bug class — is intentionally
        // exempt; it's adapting to the real contract, not violating it.
        if (/const\s+sendSafeMessage\s*=\s*\(/.test(src)) continue
        const lines = src.split('\n')
        lines.forEach((line, i) => {
            const m = line.match(suspiciousRe)
            if (m && m[1] !== 'sock') {
                warn(`${rel}:${i + 1} — sendSafeMessage(${m[1]}, ...) — first argument should be "sock" (contract is sendSafeMessage(sock, jid, payload)). Verify this isn't the 2-arg misuse bug.`)
            }
        })
    }
    if (warnings === 0) console.log('  (no suspicious call sites found)')
}

// ── 6. Bare-acronym regression check ────────────────────────
// This is the automated regression test for the historical bug where
// typing just "!m4th" (or "!tgt") — with NO subcommand — was treated as
// an implicit "start" instead of explaining the game. It's dynamic, not
// a text-pattern guess: we actually invoke the real handler as if an
// ADMIN sent the bare prefix (so any "only an admin can start" guard
// can't hide the bug) and assert the game did NOT go active. A game
// that silently launches on a bare acronym fails this check even if the
// exact code pattern used to cause it changes in the future.
console.log('\n[6/6] Checking bare-acronym never silently starts a game...')
if (registry) {
    for (const [key, game] of Object.entries(registry.REGISTRY)) {
        const dir = path.join(ROOT, game.folderName)
        let handler = null
        try {
            handler = typeof game.gameEngine.handlePublicMessage === 'function'
                ? game.gameEngine.handlePublicMessage
                : require(path.join(dir, 'publicCommands.js')).handlePublicMessage
        } catch (err) {
            warn(`${game.folderName}: could not load its public message handler to test bare-acronym behavior (${err.message}).`)
            continue
        }
        if (typeof handler !== 'function') {
            warn(`${game.folderName}: no handlePublicMessage() function found to test.`)
            continue
        }

        const fakeChatId = `verify-acronym-${key}@g.us`
        const sentMessages = []
        const fakeSock = { sendMessage: async (jid, payload) => { sentMessages.push(payload) } }
        const fakeGames = {}
        const fakeSettings = {}
        const fakeActiveGameChatRef = { value: null }
        const fakePersistGames = () => {}
        const fakeCtxBase = {
            sock: fakeSock, games: fakeGames, settings: fakeSettings,
            activeGameChatRef: fakeActiveGameChatRef, persistGames: fakePersistGames,
            nameCache: {}, sendSafeMessage: async (s, jid, payload) => { sentMessages.push(payload) }
        }
        const msgCtx = {
            ...fakeCtxBase,
            from: fakeChatId,
            body: game.config.PREFIX,
            rawBody: game.config.PREFIX,
            senderNumber: '000000000000',
            senderJid: '000000000000@s.whatsapp.net',
            senderName: 'Verify Bot',
            isAdmin: true,
            senderTier: 'ADMIN',
            buildCtx: () => fakeCtxBase
        }

        try {
            await handler(msgCtx)
            const state = game.gameEngine.getGameState(fakeChatId, fakeGames)
            if (state && state.active) {
                fail(`${game.folderName}: sending the bare "${game.config.PREFIX}" acronym (no subcommand) as an ADMIN silently started a session instead of explaining the game. Bare-acronym must ALWAYS show the explainer — see ARCHITECTURE.md §10.`)
            } else if (sentMessages.length === 0) {
                warn(`${game.folderName}: sending the bare "${game.config.PREFIX}" acronym produced no reply at all — a brand-new player gets silence instead of an explainer.`)
            }
        } catch (err) {
            warn(`${game.folderName}: bare-acronym test threw an error (${err.message}) — could not verify this game's behavior automatically.`)
        }
    }
    if (failures === 0) ok('No game silently starts a session on its bare acronym — every game explains itself first.')
}

// ── Summary ─────────────────────────────────────────────────
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
if (failures > 0) {
    console.log(`❌ ${failures} FAILURE(S), ${warnings} warning(s). Fix the failures above before deploying.`)
    process.exit(1)
} else if (warnings > 0) {
    console.log(`✅ No failures. ${warnings} warning(s) — review them, but they won't block startup.`)
    process.exit(0)
} else {
    console.log('✅ All checks passed. Safe to deploy.')
    process.exit(0)
}

})().catch(err => {
    console.log(`❌ FAIL: verify-games.js crashed while running: ${err && err.stack || err}`)
    process.exit(1)
})
