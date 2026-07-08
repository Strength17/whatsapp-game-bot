// ============================================================
//  index.js — HMG Bot · Sky Graphics
//  Thin orchestrator: connection, sender resolution, message
//  routing. All game logic lives in each game's own folder
//  (see games-registry.js). Nothing here is game-specific.
// ============================================================

require('dotenv').config()
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const qrcode = require('qrcode-terminal')
const fs = require('fs')
const path = require('path')

const registry = require('./games-registry')
const { getTier, TIERS, resolveSetting } = require('./permissions')
const { handleGameSwitchCommands } = require('./game-switch-commands')

// Fixed, game-independent prefix. Always works no matter which game is
// currently active, so the creator never needs to know/guess the active
// game's own acronym just to switch away from it.
const GAME_SWITCH_PREFIX = '/game '

// ─── Safe DM sender ───────────────────────────────────────
async function sendSafeMessage(sock, jidOrNumber, payload) {
    const targetJid = jidOrNumber.includes('@') ? jidOrNumber : `${jidOrNumber}@s.whatsapp.net`
    try {
        const result = await sock.sendMessage(targetJid, payload)
        console.log(`[sendSafe] Sent to ${targetJid}:`, JSON.stringify(result?.key))
    } catch (err) {
        console.log(`[sendSafe] Send error to ${targetJid}:`, err.message)
    }
}

// ─── Persistent Settings ───────────────────────────────────
const SETTINGS_FILE = 'settings.json'
const WORDS_FILE     = 'words.json'
const GAMES_FILE     = 'games.json'

let settings = {
    adminNumber:      '',
    adminJid:         '',
    maxTries:         'auto',
    publicVisible:    true,
    publicCanStart:   false,
    activeGame:       'hangman',   // which game module is currently live
    adminGameAccess:  'all'        // which game(s) the confirmed admin may operate
}

let pendingAdminChangeRef = { value: null }

if (fs.existsSync(SETTINGS_FILE)) {
    settings = JSON.parse(fs.readFileSync(SETTINGS_FILE))
    if (typeof settings.adminJid        === 'undefined') settings.adminJid        = ''
    if (typeof settings.publicVisible   === 'undefined') settings.publicVisible   = true
    if (typeof settings.publicCanStart  === 'undefined') settings.publicCanStart  = false
    if (typeof settings.activeGame      === 'undefined') settings.activeGame      = 'hangman'
    if (typeof settings.adminGameAccess === 'undefined') settings.adminGameAccess = 'all'
}

function saveSettings() {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
}

// ─── Name Cache ────────────────────────────────────────────
const NAMES_FILE = 'names.json'
let nameCache = {}
if (fs.existsSync(NAMES_FILE)) {
    nameCache = JSON.parse(fs.readFileSync(NAMES_FILE))
}

function rememberName(number, pushName) {
    if (!number || !pushName) return
    if (nameCache[number] !== pushName) {
        nameCache[number] = pushName
        fs.writeFileSync(NAMES_FILE, JSON.stringify(nameCache, null, 2))
    }
}

// ─── LID → PN cache ───────────────────────────────────────
// WhatsApp routes many messages via internal LIDs (e.g. 187733758767332@lid)
// instead of real phone-number JIDs. This cache maps each LID to its real PN.
// Persisted to lidcache.json so resolutions survive bot restarts.
const LID_CACHE_FILE = 'lidcache.json'
let lidCache = {}
if (fs.existsSync(LID_CACHE_FILE)) {
    try { lidCache = JSON.parse(fs.readFileSync(LID_CACHE_FILE)) } catch (_) {}
}

function saveLidCache() {
    fs.writeFileSync(LID_CACHE_FILE, JSON.stringify(lidCache, null, 2))
}

// Resolves a LID to a real phone number string.
// Order: local cache → sock.signalRepository.lidMapping.getPNForLID() → sock.onWhatsApp() last resort.
async function resolvelidToPN(sock, lid) {
    if (!lid || !lid.includes('@lid')) return ''

    if (lidCache[lid]) {
        console.log(`[lid] Cache hit: ${lid} → ${lidCache[lid]}`)
        return lidCache[lid]
    }

    try {
        const pnJid = await sock.signalRepository?.lidMapping?.getPNForLID(lid)
        if (pnJid) {
            const realPN = pnJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '')
            if (realPN && /^[0-9]{7,15}$/.test(realPN)) {
                lidCache[lid] = realPN
                saveLidCache()
                console.log(`[lid] Resolved via signalRepository: ${lid} → ${realPN}`)
                return realPN
            }
        }
    } catch (err) {
        console.log(`[lid] signalRepository lookup failed for ${lid}:`, err.message)
    }

    try {
        const results = await sock.onWhatsApp(lid)
        if (results && results.length > 0) {
            const realJid = results[0].jid || ''
            const realPN  = realJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '')
            if (realPN && /^[0-9]{7,15}$/.test(realPN)) {
                lidCache[lid] = realPN
                saveLidCache()
                console.log(`[lid] Resolved via onWhatsApp: ${lid} → ${realPN}`)
                return realPN
            }
        }
    } catch (err) {
        console.log(`[lid] Could not resolve ${lid}:`, err.message)
    }
    return ''
}

// ─── Idempotency guard ─────────────────────────────────────
const recentlySeenIds = new Map()
const DEDUP_WINDOW_MS = 2 * 60 * 1000

function isDuplicateMessage(msgId) {
    if (!msgId) return false
    const now = Date.now()
    for (const [id, ts] of recentlySeenIds) {
        if (now - ts > DEDUP_WINDOW_MS) recentlySeenIds.delete(id)
    }
    if (recentlySeenIds.has(msgId)) return true
    recentlySeenIds.set(msgId, now)
    return false
}

// ─── Word Pool (belongs to whichever game is active) ───────
// words.json is a flat array. Only one game is active at a time, and
// today's only game (Hangman) uses a flat word list; a future game
// that needs a different shape should manage its own file instead.
function loadWordsForGame(game) {
    if (fs.existsSync(WORDS_FILE)) {
        try {
            const saved = JSON.parse(fs.readFileSync(WORDS_FILE))
            if (Array.isArray(saved) && saved.length > 0) return saved
        } catch (_) {}
    }
    return JSON.parse(JSON.stringify((game && game.gameEngine.DEFAULT_WORDS) || []))
}

let activeGameChatRef = { value: null }
const games = {}

function persistGames() {
    const serializable = {}
    for (const chatId in games) {
        const g = games[chatId]
        if (!g.active && !g.lobbyActive && !g.cooldownActive) continue
        const { lobbyTimer, turnTimer, cooldownTimer, ...rest } = g
        serializable[chatId] = rest
    }
    fs.writeFileSync(GAMES_FILE, JSON.stringify({ activeGameChat: activeGameChatRef.value, games: serializable }, null, 2))
}

function loadPersistedGames() {
    if (!fs.existsSync(GAMES_FILE)) return
    try {
        const data = JSON.parse(fs.readFileSync(GAMES_FILE))
        activeGameChatRef.value = data.activeGameChat || null
        for (const chatId in (data.games || {})) {
            games[chatId] = { ...data.games[chatId], lobbyTimer: null, turnTimer: null, cooldownTimer: null }
        }
    } catch (err) {
        console.log('⚠️ Could not load persisted game state (games.json may be corrupt). Starting fresh.', err.message)
    }
}

loadPersistedGames()

let words = loadWordsForGame(registry.getActiveGame(settings))

function saveWords() {
    fs.writeFileSync(WORDS_FILE, JSON.stringify(words, null, 2))
}

let hasSentBootAdminConfirmation = false

// ─── Shared engine context builder ─────────────────────────
function buildCtx(sock) {
    return { sock, games, settings, words, activeGameChatRef, persistGames, nameCache }
}

// ─── Public-message dispatch helper ─────────────────────────
// Hangman keeps its public "!hmg ..." + live-guess handling in its own
// publicCommands.js (separate from gameEngine.js, which is pure state
// mechanics). Any future game can do the same, or expose
// gameEngine.handlePublicMessage directly — both shapes are supported.
function getPublicMessageHandler(activeGame) {
    if (typeof activeGame.gameEngine.handlePublicMessage === 'function') {
        return activeGame.gameEngine.handlePublicMessage
    }
    const publicHandlerPath = path.join(__dirname, activeGame.folderName, 'publicCommands.js')
    if (fs.existsSync(publicHandlerPath)) {
        return require(publicHandlerPath).handlePublicMessage
    }
    return null
}

// ─── Main Bot ──────────────────────────────────────────────
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info')

    const sock = makeWASocket({
        auth:              state,
        printQRInTerminal: false,
        getMessage:        async () => ({ conversation: '' })
    })

    sock.ev.on('creds.update', saveCreds)

    // ─── Connection Handler ─────────────────────────────────
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            console.log('📱 Scan this QR code with WhatsApp:')
            qrcode.generate(qr, { small: true })
            console.log('\n🔗 OR click this link to scan in your browser:')
            console.log(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}\n`)
        }

        if (connection === 'close') {
            const statusCode      = new Boom(lastDisconnect?.error)?.output?.statusCode
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut
            if (shouldReconnect) {
                console.log('🔁 Connection closed. Restarting and generating a fresh QR...')
                startBot()
            } else {
                console.log('🚪 Logged out. Delete the auth_info folder and restart to link a new device.')
            }
        }

        if (connection === 'open') {
            const activeGame = registry.getActiveGame(settings)
            console.log(`✅ HMG Bot is connected! Active game: ${activeGame ? activeGame.config.GAME_NAME : 'NONE LOADED'} 🎮`)

            // Seed LID↔PN mappings from every available source on boot.
            ;(async () => {
                const creatorJidEnv = process.env.CREATOR_JID || ''
                const creatorNum    = creatorJidEnv.split('@')[0].split(':')[0].replace(/[^0-9]/g, '')

                if (creatorNum && sock.signalRepository?.lidMapping?.getLIDForPN) {
                    try {
                        const creatorPnJid = `${creatorNum}@s.whatsapp.net`
                        const creatorLid   = await sock.signalRepository.lidMapping.getLIDForPN(creatorPnJid)
                        if (creatorLid) {
                            const lidBase = creatorLid.split(':')[0]
                            const fullLid = lidBase.includes('@') ? lidBase : `${lidBase}@lid`
                            if (!lidCache[fullLid]) {
                                lidCache[fullLid] = creatorNum
                                saveLidCache()
                                console.log(`[boot] Creator LID seeded from signalRepository: ${fullLid} → ${creatorNum}`)
                            }
                        }
                    } catch (err) {
                        console.log(`[boot] Could not seed creator LID from signalRepository:`, err.message)
                    }
                }

                try {
                    const authDir = 'auth_info'
                    if (fs.existsSync(authDir)) {
                        const lidFiles = fs.readdirSync(authDir).filter(f => f.startsWith('lid-mapping') && f.endsWith('.json'))
                        let seeded = 0
                        for (const fname of lidFiles) {
                            try {
                                const raw  = fs.readFileSync(`${authDir}/${fname}`, 'utf8')
                                const data = JSON.parse(raw)
                                const entries = Array.isArray(data) ? data : Object.entries(data).map(([lid, pn]) => ({ lid, pn }))
                                for (const entry of entries) {
                                    const lid = entry.lid || entry[0] || ''
                                    const pn  = entry.pn  || entry[1] || ''
                                    if (!lid || !pn) continue
                                    const lidKey = lid.includes('@') ? lid.split(':')[0] + '@lid' : `${lid}@lid`
                                    const pnNum  = pn.split('@')[0].split(':')[0].replace(/[^0-9]/g, '')
                                    if (pnNum && /^[0-9]{7,15}$/.test(pnNum) && !lidCache[lidKey]) {
                                        lidCache[lidKey] = pnNum
                                        seeded++
                                    }
                                }
                            } catch (_) {}
                        }
                        if (seeded > 0) {
                            saveLidCache()
                            console.log(`[boot] Seeded ${seeded} LID→PN mapping(s) from auth_info files`)
                        }
                    }
                } catch (err) {
                    console.log(`[boot] Could not read auth_info LID mapping files:`, err.message)
                }
            })()

            if (!hasSentBootAdminConfirmation) {
                hasSentBootAdminConfirmation = true
                const creatorJid = process.env.CREATOR_JID || ''
                const gameLabel  = activeGame ? `${activeGame.config.GAME_NAME} (${activeGame.config.GAME_ACRONYM})` : 'no game loaded'
                const helpPrefix = activeGame ? activeGame.config.ADMIN_PREFIX.trim() : '/hmg'

                if (creatorJid) {
                    try {
                        await sendSafeMessage(sock, creatorJid, {
                            text:
                                `🔁 *Bot is back online!* ✅\n\n` +
                                `🎮 Active game: *${gameLabel}*\n` +
                                `👑 You're the *Creator* (unrestricted access).\n\n` +
                                `Type *${helpPrefix} help* to open your full dashboard.\n\n` +
                                `_Sky Graphics_ 🎨`
                        })
                        console.log(`🔐 Sent boot DM to creator`)
                    } catch (err) {
                        console.log('⚠️ Could not DM creator on boot:', err.message)
                    }
                }

                const bootTarget = settings.adminJid || settings.adminNumber
                const creatorNum = creatorJid.split('@')[0].split(':')[0]
                if (bootTarget && settings.adminNumber !== creatorNum) {
                    try {
                        await sendSafeMessage(sock, bootTarget, {
                            text:
                                `🔁 *Bot is back online!* ✅\n\n` +
                                `🎮 Active game: *${gameLabel}*\n` +
                                `👑 You're registered as admin (${settings.adminNumber}).\n\n` +
                                `Type *${helpPrefix} help* at any time to see all your commands.\n\n` +
                                `_Sky Graphics_ 🎨`
                        })
                        console.log(`👑 Sent boot DM to admin ${bootTarget}`)
                    } catch (err) {
                        console.log('⚠️ Could not DM admin on boot:', err.message)
                    }
                } else if (!bootTarget && !creatorJid) {
                    console.log(`ℹ️ No admin set yet. Someone must type ${helpPrefix} admin to begin onboarding.`)
                }
            }

            // Recover active game/lobby/cooldown after restart
            if (activeGameChatRef.value && games[activeGameChatRef.value] && activeGame) {
                const gs  = games[activeGameChatRef.value]
                const ctx = buildCtx(sock)
                if (gs.lobbyActive) {
                    await sock.sendMessage(activeGameChatRef.value, {
                        text: `🔁 *Bot restarted.* Resuming the lobby countdown (${gs.lobbySecondsLeft}s left). Type *${activeGame.config.PREFIX} join* if you haven't! ⏱️`
                    })
                    activeGame.gameEngine.startLobbyCountdown(activeGameChatRef.value, ctx)
                } else if (gs.active && !gs.paused) {
                    await sock.sendMessage(activeGameChatRef.value, { text: `🔁 *Bot restarted.* Resuming the in-progress round. 🎮` })
                    await activeGame.gameEngine.sendGameBoard(activeGameChatRef.value, '🔁 *Round recovered after a restart.*', [], ctx)
                } else if (gs.active && gs.paused) {
                    await sock.sendMessage(activeGameChatRef.value, {
                        text: `🔁 *Bot restarted.* The round is still paused — an admin must type *${activeGame.config.ADMIN_PREFIX.trim()} resume* to continue. ⏸️`
                    })
                } else if (gs.cooldownActive && typeof activeGame.gameEngine.startCooldown === 'function') {
                    await sock.sendMessage(activeGameChatRef.value, { text: `🔁 *Bot restarted.* Still on the post-round break. ☕` })
                    activeGame.gameEngine.startCooldown(activeGameChatRef.value, ctx)
                }
            }
        }
    })

    // ─── Message Handler ────────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return

        for (const msg of messages) {
            if (!msg.message) continue
            if (isDuplicateMessage(msg.key?.id)) {
                console.log(`[dedup] Skipping duplicate: ${msg.key.id}`)
                continue
            }

            const from = msg.key.remoteJid
            if (from === 'status@broadcast') continue

            const text =
                msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption ||
                msg.message?.videoMessage?.caption ||
                ''
            const body    = text.trim().toLowerCase()
            const rawBody = text.trim()

            const sender = msg.key.participant || msg.key.remoteJid || ''

            // ── senderNumber resolution ──────────────────────
            let senderNumber = ''

            if (msg.key.participantPn) {
                senderNumber = msg.key.participantPn.split('@')[0].split(':')[0].replace(/[^0-9]/g, '')
            }
            if (!senderNumber && msg.key.senderPn) {
                senderNumber = msg.key.senderPn.split('@')[0].split(':')[0].replace(/[^0-9]/g, '')
            }
            if (!senderNumber && msg.key.fromMe) {
                const creatorJid = process.env.CREATOR_JID || ''
                senderNumber = creatorJid ? creatorJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '') : ''
            }
            if (!senderNumber && sender && !sender.includes('@lid')) {
                senderNumber = sender.split('@')[0].split(':')[0].replace(/[^0-9]/g, '')
            }
            if (!senderNumber && sender && sender.includes('@lid')) {
                senderNumber = await resolvelidToPN(sock, sender)
                if (!senderNumber) console.log(`[lid] Could not resolve LID: ${sender}`)
            }
            if (senderNumber && !/^[0-9]{7,15}$/.test(senderNumber)) {
                console.log(`[senderNumber] Invalid PN resolved: "${senderNumber}" — clearing`)
                senderNumber = ''
            }

            // Any "/" message is treated as a slash command for the early gate —
            // the specific active-game admin prefix is checked further below.
            const isSlashCommand = body.startsWith('/')
            if (!senderNumber && !isSlashCommand) {
                console.log(`[senderNumber] Could not resolve PN and not a slash command — skipping`)
                continue
            }

            const senderJid = msg.key.fromMe
                ? (process.env.CREATOR_JID || (senderNumber ? `${senderNumber}@s.whatsapp.net` : sender))
                : (msg.key.participant || sender)

            const senderName = msg.pushName || senderNumber
            rememberName(senderNumber, msg.pushName)

            const senderTier = getTier(senderNumber, settings, senderJid)
            const isAdmin    = senderTier === TIERS.CREATOR || senderTier === TIERS.ADMIN

            // ── "/game ..." — fixed, game-independent switch commands ──
            // Checked BEFORE active-game resolution so it works no matter
            // which game is currently running, and no matter what that
            // game's own prefix is. Creator-only; anyone else is ignored.
            if (body.startsWith(GAME_SWITCH_PREFIX) || body === '/game') {
                const parts = body.slice(1).trim().split(/\s+/) // ['game', 'setgame', 'wordladder']
                const cmd   = parts.slice(1)                    // ['setgame', 'wordladder']
                const senderIsCreator = senderTier === TIERS.CREATOR

                const handled = await handleGameSwitchCommands({
                    cmd, senderIsCreator, senderIsAdmin: isAdmin, sock, sendSafeMessage,
                    replyTo: senderJid, settings, saveSettings
                })

                if (!handled && senderIsCreator) {
                    await sendSafeMessage(sock, senderJid, {
                        text:
                            `🎮 *Game Switcher*\n\n` +
                            `› \`/game setgame [key]\` — switch the active game\n` +
                            `› \`/game setadminaccess [key|all]\` — scope the admin to one game\n` +
                            `› \`/game status\` — show what's active and what's available\n\n` +
                            `Available games: *${registry.listGameKeys().join(', ') || 'none loaded'}*`
                    })
                }
                continue
            }

            // ── Resolve active game ──────────────────────────
            const activeGame = registry.getActiveGame(settings)
            if (!activeGame) {
                console.log('[router] No game module loaded — ignoring message.')
                continue
            }
            const adminPrefix = activeGame.config.ADMIN_PREFIX
            const prefix       = activeGame.config.PREFIX

            const effectivePublicVisible = resolveSetting('publicVisible', settings, true)
            if (!isAdmin && !effectivePublicVisible && !body.startsWith(adminPrefix)) continue

            if (senderNumber === settings.adminNumber) {
                if (msg.pushName) rememberName(settings.adminNumber, msg.pushName)
                if (sender && sender !== settings.adminJid) {
                    settings.adminJid = sender
                    saveSettings()
                    console.log(`[admin] Updated adminJid to: ${settings.adminJid}`)
                }
            }

            // ── "/" admin commands → active game's handler ──
            if (body.startsWith(adminPrefix)) {
                const cmdCtx = {
                    ...buildCtx(sock),
                    pendingAdminChangeRef,
                    saveSettings,
                    saveWords,
                    sendSafeMessage,
                    getGameState: (chatId, g) => activeGame.gameEngine.getGameState(chatId, g || games),
                    startTurnCountdown: (chatId, overrideCtx) => activeGame.gameEngine.startTurnCountdown(chatId, overrideCtx || buildCtx(sock)),
                    fs,
                    senderNumber,
                    senderDisplayId: senderNumber || sender.split('@')[0].split(':')[0] || '',
                    senderName,
                    senderJid,
                    sender: from,
                    body,
                    isAdmin,
                    senderTier
                }
                await activeGame.adminCommands.handleAdminCommand(cmdCtx)
                continue
            }

            // ── Everything else → active game's public handler ──
            const handler = getPublicMessageHandler(activeGame)
            if (!handler) continue

            const msgCtx = {
                sock, games, settings, words, activeGameChatRef, persistGames, nameCache,
                sendSafeMessage,
                buildCtx: () => buildCtx(sock),
                from, body, rawBody, senderNumber, senderJid, senderName, isAdmin
            }
            await handler(msgCtx)
        }
    })
}

startBot()
