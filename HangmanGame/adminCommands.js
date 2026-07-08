// ============================================================
//  HangmanGame/adminCommands.js — HMG Bot · Sky Graphics
//  Handles ALL "/hmg" commands with full security hardening.
//
//  Access tiers:
//    CREATOR  — CREATOR_JID in .env. Unrestricted. Always works.
//    ADMIN    — set via key onboarding. Full command access.
//    EVERYONE ELSE — total silence on all "/" commands.
//
//  /hmg admin  — onboarding gate (key request → creator approves → key sent)
//  /hmg help   — admin/creator dashboard, DM only, silent to all others
//  /hmg approve [number] — creator only: sends approved key to requester
//  /hmg deny   [number] — creator only: immediately voids the key
//  Game switching (/game setgame, /game setadminaccess) is NOT handled
//  in this file — it's a fixed, game-independent prefix in index.js.
// ============================================================

const crypto = require('crypto')

const { TIERS, writeSetting, resolveSetting, nameTag } = require('../permissions')
const { startActualGame } = require('./gameEngine')
const config = require('./config')

// ─── Pending key sessions ────────────────────────────────────
const pendingKeys = {}
const approvalQueue = {}
const voidedSessions = {}
const VOIDED_LOCKOUT_MS = 30 * 60 * 1000

const adminRateLimit = {}

let adminLastActive = 0
let adminInactivityTimer = null

function generateKey() {
    return crypto.randomUUID()
}

function cleanExpiredKeys() {
    const now = Date.now()
    for (const jid in pendingKeys) {
        if (pendingKeys[jid].expiresAt < now) {
            const num = pendingKeys[jid].senderNumber
            delete pendingKeys[jid]
            delete approvalQueue[num]
        }
    }
    for (const num in voidedSessions) {
        if (voidedSessions[num].voidedAt + VOIDED_LOCKOUT_MS < now) {
            delete voidedSessions[num]
        }
    }
}

function checkAdminRateLimit(senderNumber) {
    const now = Date.now()
    const entry = adminRateLimit[senderNumber] || { count: 0, lockedUntil: 0 }

    if (now < entry.lockedUntil) return true
    if (entry.lockedUntil && now >= entry.lockedUntil) {
        entry.count = 0
        entry.lockedUntil = 0
    }
    entry.count++
    if (entry.count >= 5) {
        entry.lockedUntil = now + 10 * 60 * 1000
        entry.count = 0
    }
    adminRateLimit[senderNumber] = entry
    return false
}

function startAdminInactivityTimer(settings, saveSettings, sock, sendSafeMessage) {
    if (adminInactivityTimer) clearInterval(adminInactivityTimer)
    adminLastActive = Date.now()

    adminInactivityTimer = setInterval(async () => {
        if (!settings.adminNumber) {
            clearInterval(adminInactivityTimer)
            adminInactivityTimer = null
            return
        }
        const thirtyDays = 30 * 24 * 60 * 60 * 1000
        if (Date.now() - adminLastActive >= thirtyDays) {
            clearInterval(adminInactivityTimer)
            adminInactivityTimer = null

            const cleared = settings.adminNumber
            settings.adminNumber = ''
            settings.adminJid    = ''
            saveSettings()

            const creatorJid = process.env.CREATOR_JID || ''
            if (creatorJid) {
                try {
                    await sendSafeMessage(sock, creatorJid, {
                        text:
                            `⚠️ *Admin Slot Auto-Cleared*\n\n` +
                            `${cleared} has been inactive for *30 days* — the admin slot has been reset.\n\n` +
                            `The bot is now unconfigured. The next */hmg admin* request will begin fresh onboarding. 🚀`
                    })
                } catch (_) {}
            }
            console.log(`[inactivity] Admin slot cleared — ${cleared} inactive for 30 days.`)
        }
    }, 60 * 60 * 1000)
}

function formatMaxTries(value) {
    if (value === 'auto' || value === undefined || value === null) return 'AUTO 🤖'
    return String(value)
}

// ─── Help dashboard ───────────────────────────────────────────
function buildHelpText(settings, forCreator = false, section = null) {
    const tier = forCreator
        ? `👑 *CREATOR — Unrestricted Access*`
        : `🛡️ *Administrator*`

    const header =
        `╔══════════════════════════╗\n` +
        `   🎮  ${config.GAME_ACRONYM} Admin Dashboard\n` +
        `╚══════════════════════════╝\n` +
        `${tier}\n` +
        `_Sky Graphics — ${config.GAME_NAME}_\n\n`

    const footer =
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `_${config.GAME_ACRONYM} Bot · Sky Graphics_ 🎨`

    const liveConfig =
        `*📊 Live Config:*\n` +
        `› Word Length: *adaptive (currently drifting per chat)*\n` +
        `› Max Tries: *${formatMaxTries(resolveSetting('maxTries', settings, 'auto'))}*\n` +
        `› Public Visible: *${resolveSetting('publicVisible', settings, true) ? '🟢 ON' : '🔴 OFF'}*\n` +
        `› Public Can Start: *${resolveSetting('publicCanStart', settings, false) ? '🟢 ON' : '🔴 OFF'}*\n` +
        `› Auto-Join Lobby: *${resolveSetting('autoJoin', settings, true) ? '🟢 ON' : '🔴 OFF'}*\n` +
        `› Admin Set: *${settings.adminNumber ? '✅ ' + settings.adminNumber : '❌ None'}*\n\n`

    if (section === null || section === undefined) {
        return (
            header +
            `All commands work from *any chat*.\n` +
            `Every reply comes to *your DM only*.\n\n` +
            `Type */hmg help [number]* to expand a category:\n\n` +
            `*1️⃣  Settings* — visibility, admin slot, max tries\n` +
            `*2️⃣  Word Pool* — add, remove, list, replace, clear words\n` +
            `*3️⃣  Game Controls* — status, pause, resume, end, force start\n` +
            (forCreator ? `*🔐  Creator-Only* — approve/deny access keys, switch games\n` : ``) +
            `\n` +
            liveConfig +
            footer
        )
    }

    if (section === 1) {
        return (
            header +
            `*1️⃣  Settings Commands*\n\n` +
            `› \`/hmg set admin [number]\`\n` +
            `  then → \`/hmg confirm\` or \`/hmg cancel\`\n` +
            `› \`/hmg set public [on/off]\` — non-admin visibility\n` +
            `› \`/hmg set start [on/off]\` — public lobby start\n` +
            `› \`/hmg set autojoin [on/off]\` — auto-join lobbies\n` +
            `› \`/hmg set maxtries [n / auto]\` — attempt budget\n` +
            `› \`/hmg clearadmin\` — clear admin slot, keep pools\n` +
            (forCreator ? `› \`/hmg reset\` — ⚠️ wipe ALL data\n` : ``) +
            `\n` +
            `_Note: there's no manual difficulty setting anymore — word length adapts automatically based on how the group performs each round._\n\n` +
            liveConfig +
            footer
        )
    }

    if (section === 2) {
        return (
            header +
            `*2️⃣  Word Pool Commands*\n\n` +
            `› \`/hmg addword [word]\`\n` +
            `› \`/hmg removeword [word]\`\n` +
            `› \`/hmg listwords\`\n` +
            `› \`/hmg setwords w1 w2 ...\` — replace the whole pool\n` +
            `› \`/hmg clearwords\` — cannot empty the pool entirely\n\n` +
            `_One flat pool now, spanning ${config.MIN_WORD_LENGTH}–${config.MAX_WORD_LENGTH} letters — the game itself picks the right length each round._\n\n` +
            footer
        )
    }

    if (section === 3) {
        return (
            header +
            `*3️⃣  Game Control Commands*\n\n` +
            `› \`/hmg status\` — live game state in your DM\n` +
            `› \`/hmg start\` — force lobby to start immediately\n` +
            `› \`/hmg pause\` — freeze the turn timer\n` +
            `› \`/hmg resume\` — unfreeze the turn timer\n` +
            `› \`/hmg end\` · \`/hmg stop\` — terminate active game\n` +
            (forCreator
                ? `\n*🔐  Creator-Only:*\n` +
                  `› \`/hmg approve [number]\` — send access key to requester\n` +
                  `› \`/hmg deny [number]\` — void their key immediately\n` +
                  `› \`/game setgame [key]\` — switch the active game (fixed prefix, works from any game)\n` +
                  `› \`/game setadminaccess [key|all]\` — scope the admin to one game\n`
                : ``) +
            `\n` +
            footer
        )
    }

    return (
        `⚠️ *Invalid option.*\n\n` +
        `Use */hmg help [number]* to expand a section:\n\n` +
        `*1️⃣  Settings*\n` +
        `*2️⃣  Word Pool*\n` +
        `*3️⃣  Game Controls*\n\n` +
        `Example: \`/hmg help 2\``
    )
}

// ─── Main handler ─────────────────────────────────────────────
async function handleAdminCommand(ctx) {
    cleanExpiredKeys()

    const {
        sock, settings, words, games, activeGameChatRef,
        pendingAdminChangeRef, saveSettings, saveWords, persistGames,
        sendSafeMessage, getGameState, startTurnCountdown,
        fs, nameCache,
        senderNumber, senderJid, senderName, body, senderTier,
        sender
    } = ctx

    const requesterJid = senderNumber ? `${senderNumber}@s.whatsapp.net` : senderJid

    const creatorJid    = process.env.CREATOR_JID || ''
    const creatorNumber = creatorJid.split('@')[0].split(':')[0]

    const senderIsCreator = senderTier === TIERS.CREATOR
    const isAdmin          = senderTier === TIERS.CREATOR || senderTier === TIERS.ADMIN
    const tier              = senderTier || TIERS.PUBLIC

    // Strip "/" and shift past "hmg" so cmd[0] = command, cmd[1]+ = args
    const raw   = body.slice(1).trim()
    const parts = raw.split(' ')
    const cmd   = parts.slice(1)

    if (senderIsCreator || isAdmin) {
        adminLastActive = Date.now()
        if (settings.adminNumber && !adminInactivityTimer) {
            startAdminInactivityTimer(settings, saveSettings, sock, sendSafeMessage)
        }
    }

    // Note: switching games / scoping admin access is NOT handled here.
    // It lives entirely under the fixed "/game" prefix in index.js, so
    // it works no matter which game is currently active — see
    // game-switch-commands.js.

    // ══════════════════════════════════════════════
    //  /hmg admin
    // ══════════════════════════════════════════════
    if (cmd[0] === 'admin') {

        if (senderIsCreator) {
            await sendSafeMessage(sock, senderJid, {
                text:
                    `╔══════════════════════════╗\n` +
                    `   🔐  Sky Graphics Creator\n` +
                    `╚══════════════════════════╝\n\n` +
                    `Welcome back, *Founder*. 👋\n\n` +
                    `You have *unrestricted access* to every function of this bot — ` +
                    `no keys, no approvals, no gates.\n\n` +
                    `Type */hmg help* to open the full dashboard.\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `_${config.GAME_ACRONYM} Bot · Sky Graphics_ 🎨`
            })
            return
        }

        if (isAdmin && settings.adminNumber !== '') {
            await sendSafeMessage(sock, senderJid, {
                text:
                    `╔══════════════════════════╗\n` +
                    `   👑  ${config.GAME_ACRONYM} Administrator\n` +
                    `╚══════════════════════════╝\n\n` +
                    `Welcome back, *Administrator*. 👋\n\n` +
                    `You have full control of the *${config.GAME_ACRONYM} Bot* for your community.\n\n` +
                    `Type */hmg help* to open your full dashboard.\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `_${config.GAME_ACRONYM} Bot · Sky Graphics_ 🎨`
            })
            return
        }

        if (settings.adminNumber !== '' && !isAdmin) {
            if (checkAdminRateLimit(senderNumber)) return
            await sendSafeMessage(sock, requesterJid, {
                text: `ℹ️ This bot is already configured. Contact the group admin for assistance.`
            })
            return
        }

        const voided = voidedSessions[senderNumber]
        if (voided && Date.now() - voided.voidedAt < VOIDED_LOCKOUT_MS) {
            if (checkAdminRateLimit(senderNumber)) return
            await sendSafeMessage(sock, requesterJid, {
                text:
                    `🚫 *Session Voided*\n\n` +
                    `Too many incorrect attempts. Your access session has been cancelled.\n\n` +
                    `Contact the *Sky Graphics* team to request a new key. 📩`
            })
            return
        }

        const input = cmd.slice(1).join(' ').trim()

        if (input) {
            if (checkAdminRateLimit(senderNumber)) return

            const session = pendingKeys[senderJid]

            if (!session) {
                await sendSafeMessage(sock, requesterJid, {
                    text:
                        `🔒 *Access Denied*\n\n` +
                        `No active configuration session was found for your account.\n\n` +
                        `If you believe this is an error, contact the *Sky Graphics* team. 📩`
                })
                return
            }

            if (Date.now() > session.expiresAt) {
                delete pendingKeys[senderJid]
                delete approvalQueue[senderNumber]
                await sendSafeMessage(sock, requesterJid, {
                    text:
                        `⏰ *Session Expired*\n\n` +
                        `Your configuration window has closed.\n\n` +
                        `Contact the *Sky Graphics* team to request access again. 📩`
                })
                return
            }

            if (input.toLowerCase() !== session.key.toLowerCase()) {
                session.attempts = (session.attempts || 0) + 1
                console.warn(`[SECURITY] Wrong key attempt ${session.attempts}/3 from ${senderNumber} (JID: ${senderJid})`)

                if (session.attempts >= 3) {
                    delete pendingKeys[senderJid]
                    delete approvalQueue[senderNumber]
                    voidedSessions[senderNumber] = { voidedAt: Date.now() }
                    await sendSafeMessage(sock, requesterJid, {
                        text:
                            `🚫 *Session Voided*\n\n` +
                            `Too many incorrect attempts. Your access session has been cancelled.\n\n` +
                            `Contact the *Sky Graphics* team to request a new key. 📩`
                    })
                    if (creatorJid) {
                        try {
                            await sendSafeMessage(sock, creatorJid, {
                                text:
                                    `⚠️ *Key Session Voided*\n\n` +
                                    `\`${senderNumber}\` made 3 incorrect key attempts — their session has been cancelled automatically. 🔒`
                            })
                        } catch (_) {}
                    }
                } else {
                    await sendSafeMessage(sock, requesterJid, {
                        text:
                            `❌ *Invalid Key*\n\n` +
                            `The key you entered is incorrect. (Attempt ${session.attempts}/3)\n\n` +
                            `Double-check the key and try again: \`/hmg admin YOURKEY\` 🔑`
                    })
                }
                return
            }

            const approvedSession = { ...session }
            delete pendingKeys[senderJid]
            delete approvalQueue[senderNumber]

            const confirmedPN  = requesterJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '')
            const confirmedJid = requesterJid

            settings.adminNumber = confirmedPN || senderNumber
            settings.adminJid    = confirmedJid || senderJid
            saveSettings()

            console.log(`👑 Admin registered — PN: ${settings.adminNumber} | JID: ${settings.adminJid}`)

            startAdminInactivityTimer(settings, saveSettings, sock, sendSafeMessage)

            await sendSafeMessage(sock, confirmedJid, {
                text:
                    `╔══════════════════════════╗\n` +
                    `   👑  Access Granted\n` +
                    `╚══════════════════════════╝\n\n` +
                    `Welcome, *Administrator!* 🎉\n\n` +
                    `You now have full control of the *${config.GAME_ACRONYM} Bot* for your community.\n\n` +
                    `Type */hmg help* to open your full dashboard.\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `_${config.GAME_ACRONYM} Bot · Sky Graphics_ 🎨`
            })

            if (creatorJid) {
                try {
                    await sendSafeMessage(sock, creatorJid, {
                        text:
                            `✅ *Admin Registration Complete*\n\n` +
                            `👤 Name: *${approvedSession.senderName || 'Unknown'}*\n` +
                            `📱 Number: \`${settings.adminNumber}\`\n\n` +
                            `_Bot is now live under new admin._ 🚀`
                    })
                } catch (_) {}
            }
            return
        }

        if (checkAdminRateLimit(senderNumber)) return

        const newKey  = generateKey()
        const reqName = senderName || senderNumber

        pendingKeys[senderJid] = {
            key: newKey,
            expiresAt: Date.now() + 10 * 60 * 1000,
            senderNumber,
            senderName: reqName
        }
        approvalQueue[senderNumber] = senderJid

        await sendSafeMessage(sock, requesterJid, {
            text:
                `╔══════════════════════════╗\n` +
                `   🔐  Admin Configuration\n` +
                `╚══════════════════════════╝\n` +
                `_${config.GAME_ACRONYM} Bot · by Sky Graphics_ 🎨\n\n` +
                `Hello! 👋\n\n` +
                `You're attempting to access the *Bot Administration Panel*.\n\n` +
                `To proceed, enter the access key provided to you by the *Sky Graphics team*:\n\n` +
                `\`/hmg admin YOURKEY\`\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `📩 Don't have a key? Contact Sky Graphics to request access.`
        })

        if (creatorJid) {
            try {
                await sendSafeMessage(sock, creatorJid, {
                    text:
                        `╔══════════════════════════╗\n` +
                        `   🔔  Admin Access Request\n` +
                        `╚══════════════════════════╝\n\n` +
                        `Someone is requesting admin access to your bot.\n\n` +
                        `👤 *Name:* ${reqName}\n` +
                        `📱 *Number:* \`${senderNumber}\`\n` +
                        `🗝️ *Key:* \`${newKey}\`\n\n` +
                        `*What do you want to do?*\n\n` +
                        `✅ To *approve* and send them the key:\n` +
                        `\`/hmg approve ${senderNumber}\`\n\n` +
                        `❌ To *deny* and void the key immediately:\n` +
                        `\`/hmg deny ${senderNumber}\`\n\n` +
                        `_If you do nothing, the key auto-expires in 10 minutes._\n\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `_${config.GAME_ACRONYM} Bot · Sky Graphics_ 🎨`
                })
            } catch (err) {
                console.log('⚠️ Could not DM creator with key request:', err.message)
                console.log(`[FALLBACK] Admin key for ${senderNumber}: ${newKey}`)
            }
        } else {
            console.log(`[NO CREATOR_JID SET] Admin key for ${senderNumber}: ${newKey}`)
        }
        return
    }

    // ══════════════════════════════════════════════
    //  /hmg approve [number] — CREATOR ONLY
    // ══════════════════════════════════════════════
    if (cmd[0] === 'approve') {
        if (!senderIsCreator) return

        const targetNumber = (cmd[1] || '').replace(/[^0-9]/g, '')
        if (!targetNumber) {
            await sendSafeMessage(sock, creatorJid, { text: `⚠️ Usage: \`/hmg approve [number]\`` })
            return
        }

        const targetJid = approvalQueue[targetNumber]
        if (!targetJid || !pendingKeys[targetJid]) {
            await sendSafeMessage(sock, creatorJid, {
                text: `⚠️ *No active request found for* \`${targetNumber}\`\n\nThe session may have already expired or been denied.`
            })
            return
        }

        const session = pendingKeys[targetJid]

        if (Date.now() > session.expiresAt) {
            delete pendingKeys[targetJid]
            delete approvalQueue[targetNumber]
            await sendSafeMessage(sock, creatorJid, {
                text: `⏰ *Too late* — the session for \`${targetNumber}\` already expired.`
            })
            return
        }

        try {
            await sendSafeMessage(sock, targetJid, {
                text:
                    `╔══════════════════════════╗\n` +
                    `   🗝️  Your Access Key\n` +
                    `╚══════════════════════════╝\n` +
                    `_From the Sky Graphics Team_ 🎨\n\n` +
                    `Your request has been *approved*. ✅\n\n` +
                    `Here is your access key:\n\n` +
                    `*\`${session.key}\`*\n\n` +
                    `To activate your admin account, type:\n` +
                    `\`/hmg admin ${session.key}\`\n\n` +
                    `⏰ *This key expires in 10 minutes.*\n` +
                    `Do not share it with anyone.\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `_${config.GAME_ACRONYM} Bot · Sky Graphics_ 🎨`
            })

            await sendSafeMessage(sock, creatorJid, {
                text: `✅ *Key delivered to* \`${targetNumber}\`\n\nThey now have until the 10-minute window closes to activate. ⏱️`
            })
        } catch (err) {
            await sendSafeMessage(sock, creatorJid, {
                text: `⚠️ *Could not deliver key to* \`${targetNumber}\`: ${err.message}`
            })
        }
        return
    }

    // ══════════════════════════════════════════════
    //  /hmg deny [number] — CREATOR ONLY
    // ══════════════════════════════════════════════
    if (cmd[0] === 'deny') {
        if (!senderIsCreator) return

        const targetNumber = (cmd[1] || '').replace(/[^0-9]/g, '')
        if (!targetNumber) {
            await sendSafeMessage(sock, creatorJid, { text: `⚠️ Usage: \`/hmg deny [number]\`` })
            return
        }

        const targetJid = approvalQueue[targetNumber]
        if (!targetJid || !pendingKeys[targetJid]) {
            await sendSafeMessage(sock, creatorJid, {
                text: `⚠️ *No active request found for* \`${targetNumber}\`\n\nAlready expired, approved, or never requested.`
            })
            return
        }

        delete pendingKeys[targetJid]
        delete approvalQueue[targetNumber]

        try {
            await sendSafeMessage(sock, targetJid, {
                text:
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `_Sky Graphics · ${config.GAME_ACRONYM} Bot_ 🎨\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `Your access request could not be processed at this time.\n\n` +
                    `For further assistance, contact the *Sky Graphics* team directly. 📩`
            })
        } catch (_) {}

        await sendSafeMessage(sock, creatorJid, {
            text: `🚫 *Request denied and key voided.*\n\n\`${targetNumber}\` has been notified without details. 🔒`
        })
        return
    }

    // ══════════════════════════════════════════════
    //  /hmg help — admin + creator only, DM only
    // ══════════════════════════════════════════════
    if (cmd[0] === 'help') {
        const rawSection = cmd[1]
        const section = rawSection === undefined ? null : parseInt(rawSection, 10)
        if (senderIsCreator) {
            await sendSafeMessage(sock, senderJid, { text: buildHelpText(settings, true, section) })
            return
        }
        if (isAdmin) {
            await sendSafeMessage(sock, senderJid, { text: buildHelpText(settings, false, section) })
            return
        }
        return
    }

    // ══════════════════════════════════════════════
    //  Everything below: creator OR confirmed admin only
    // ══════════════════════════════════════════════
    if (!senderIsCreator && !isAdmin) return

    // ── Admin access scoping: a non-creator admin who has been scoped
    // to a different game via /game setadminaccess is silently ignored
    // on Hangman commands. The creator always bypasses this.
    if (!senderIsCreator) {
        const scope = settings.adminGameAccess || 'all'
        if (scope !== 'all' && scope !== config.GAME_KEY) return
    }

    const replyTo = senderJid

    // ─── /hmg set admin ──────────────────────────
    if (cmd[0] === 'set' && cmd[1] === 'admin') {
        const newAdmin = (cmd[2] || '').replace(/[^0-9]/g, '')
        if (newAdmin) {
            pendingAdminChangeRef.value = { number: newAdmin }
            await sendSafeMessage(sock, replyTo, {
                text:
                    `⚠️ *Confirm Admin Change?*\n\n` +
                    `New number: *${newAdmin}*\n\n` +
                    `Type */hmg confirm* to apply, or */hmg cancel* to discard.`
            })
        } else {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Usage: \`/hmg set admin [full number with country code]\`` })
        }
        return
    }

    if (cmd[0] === 'confirm') {
        if (pendingAdminChangeRef.value) {
            const confirmed = pendingAdminChangeRef.value
            pendingAdminChangeRef.value = null
            settings.adminNumber = confirmed.number
            settings.adminJid    = ''
            saveSettings()
            startAdminInactivityTimer(settings, saveSettings, sock, sendSafeMessage)
            await sendSafeMessage(sock, replyTo, {
                text: `✅ *Admin updated to* \`${settings.adminNumber}\`\n\nNew admin must send any message to the bot so their JID is captured. 📡`
            })
            try {
                await sendSafeMessage(sock, settings.adminNumber, {
                    text:
                        `╔══════════════════════════╗\n` +
                        `   👑  You're the Admin\n` +
                        `╚══════════════════════════╝\n\n` +
                        `Welcome! 🎉 You have been assigned as the *${config.GAME_ACRONYM} Bot* administrator.\n\n` +
                        `Type */hmg help* to see all your commands.\n\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `_${config.GAME_ACRONYM} Bot · Sky Graphics_ 🎨`
                })
            } catch (err) {
                console.log('⚠️ Could not DM new admin:', err.message)
            }
        } else {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Nothing to confirm. Use \`/hmg set admin [number]\` first.` })
        }
        return
    }

    if (cmd[0] === 'cancel') {
        if (pendingAdminChangeRef.value) {
            const cancelled = pendingAdminChangeRef.value.number
            pendingAdminChangeRef.value = null
            await sendSafeMessage(sock, replyTo, { text: `❌ Admin change to \`${cancelled}\` cancelled.` })
        } else {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Nothing to cancel.` })
        }
        return
    }

    // ─── /hmg set maxtries ───────────────────────
    if (cmd[0] === 'set' && cmd[1] === 'maxtries') {
        const arg = (cmd[2] || '').toLowerCase()
        if (arg === 'auto') {
            writeSetting(tier, 'maxTries', 'auto', settings)
            saveSettings()
            await sendSafeMessage(sock, replyTo, {
                text: `⚙️ Max attempts: *AUTO* 🤖\nAttempts now scale with word length each round.`
            })
        } else {
            const n = parseInt(arg, 10)
            if (Number.isInteger(n) && n > 0) {
                writeSetting(tier, 'maxTries', n, settings)
                saveSettings()
                await sendSafeMessage(sock, replyTo, { text: `⚙️ Max attempts per round: *${n}* 💥 (manual override)` })
            } else {
                await sendSafeMessage(sock, replyTo, { text: `⚠️ Usage: \`/hmg set maxtries [positive number]\` or \`/hmg set maxtries auto\`` })
            }
        }
        return
    }

    // ─── /hmg set public ─────────────────────────
    if (cmd[0] === 'set' && cmd[1] === 'public') {
        const mode = cmd[2]
        if (mode === 'on' || mode === 'off') {
            const newValue = (mode === 'on')
            writeSetting(tier, 'publicVisible', newValue, settings)
            saveSettings()
            await sendSafeMessage(sock, replyTo, {
                text: newValue
                    ? `🔓 *Public Visibility: ON*\nNon-admins can interact with the bot. 👥`
                    : `🔒 *Public Visibility: OFF*\nNon-admins are completely silenced. 🤐`
            })
        } else {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Usage: \`/hmg set public [on/off]\`` })
        }
        return
    }

    // ─── /hmg set start ──────────────────────────
    if (cmd[0] === 'set' && cmd[1] === 'start') {
        const mode = cmd[2]
        if (mode === 'on' || mode === 'off') {
            const newValue = (mode === 'on')
            writeSetting(tier, 'publicCanStart', newValue, settings)
            saveSettings()
            await sendSafeMessage(sock, replyTo, {
                text: newValue
                    ? `🔓 *Public Game Starts: ON*\nAnyone can type *${config.PREFIX} start* to open a lobby. 🎮`
                    : `🔒 *Public Game Starts: OFF*\nOnly admin can open a lobby. 👑`
            })
        } else {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Usage: \`/hmg set start [on/off]\`` })
        }
        return
    }

    // ─── /hmg set autojoin ────────────────────────
    if (cmd[0] === 'set' && cmd[1] === 'autojoin') {
        const mode = cmd[2]
        if (mode === 'on' || mode === 'off') {
            const newValue = (mode === 'on')
            writeSetting(tier, 'autoJoin', newValue, settings)
            saveSettings()
            const roleLabel = senderIsCreator ? 'Creator' : 'Admin'
            await sendSafeMessage(sock, replyTo, {
                text: newValue
                    ? `🟢 *Auto-Join: ON*\nYou (${roleLabel}) will automatically join every lobby when it opens. 🎮`
                    : `🔴 *Auto-Join: OFF*\nYou (${roleLabel}) must type *${config.PREFIX} join* to enter lobbies manually. 👋`
            })
        } else {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Usage: \`/hmg set autojoin [on/off]\`` })
        }
        return
    }

    // ─── Word pool commands (flat pool, no levels) ────────
    if (cmd[0] === 'addword') {
        const word = cmd[1]
        if (word) {
            const tw = word.trim().toLowerCase()
            if (words.includes(tw)) {
                await sendSafeMessage(sock, replyTo, { text: `⚠️ *${tw.toUpperCase()}* is already in the pool.` })
            } else if (!/^[a-z]{2,}$/.test(tw)) {
                await sendSafeMessage(sock, replyTo, { text: `⚠️ Words must be letters only, at least 2 characters.` })
            } else {
                words.push(tw)
                saveWords()
                await sendSafeMessage(sock, replyTo, { text: `✅ *${tw.toUpperCase()}* added to the pool (${tw.length} letters). 📚` })
            }
        } else {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Usage: \`/hmg addword [word]\`` })
        }
        return
    }

    if (cmd[0] === 'removeword') {
        const word = cmd[1]
        if (word) {
            const tw    = word.trim().toLowerCase()
            const index = words.indexOf(tw)
            if (index !== -1) {
                if (words.length <= 1) {
                    await sendSafeMessage(sock, replyTo, { text: `⚠️ Cannot remove the last word — the pool would be empty.` })
                    return
                }
                words.splice(index, 1)
                saveWords()
                await sendSafeMessage(sock, replyTo, { text: `🗑️ *${tw.toUpperCase()}* removed from the pool.` })
            } else {
                await sendSafeMessage(sock, replyTo, { text: `⚠️ *${tw.toUpperCase()}* not found in the pool.` })
            }
        } else {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Usage: \`/hmg removeword [word]\`` })
        }
        return
    }

    if (cmd[0] === 'listwords') {
        const list = words.slice().sort((a, b) => a.length - b.length).join(', ')
        await sendSafeMessage(sock, replyTo, {
            text: `📖 *Word Pool (${words.length}):*\n\n${list || '[Empty — use /hmg addword to add words]'}`
        })
        return
    }

    if (cmd[0] === 'setwords') {
        const newWords = cmd.slice(1).map(w => w.trim().toLowerCase()).filter(Boolean)
        if (newWords.length > 0) {
            if (newWords.length > 60) {
                await sendSafeMessage(sock, replyTo, { text: `⚠️ Maximum 60 words in the pool. You provided ${newWords.length}.` })
            } else {
                const unique = [...new Set(newWords)]
                words.length = 0
                words.push(...unique)
                saveWords()
                await sendSafeMessage(sock, replyTo, { text: `✅ Pool replaced with ${words.length} word(s). 📚` })
            }
        } else {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ Usage: \`/hmg setwords word1 word2 ...\`` })
        }
        return
    }

    if (cmd[0] === 'clearwords') {
        await sendSafeMessage(sock, replyTo, {
            text: `⚠️ Word pool can't be fully cleared — it would crash the game. Use \`/hmg setwords\` to replace it instead.`
        })
        return
    }

    // ─── /hmg clearadmin ─────────────────────────
    if (cmd[0] === 'clearadmin') {
        const cleared = settings.adminNumber
        settings.adminNumber    = ''
        settings.adminJid       = ''
        settings.maxTries       = 'auto'
        settings.publicVisible  = true
        settings.publicCanStart = false
        settings.autoJoin       = true
        pendingAdminChangeRef.value = null
        saveSettings()
        if (adminInactivityTimer) {
            clearInterval(adminInactivityTimer)
            adminInactivityTimer = null
        }
        await sendSafeMessage(sock, replyTo, {
            text:
                `✅ *Admin slot cleared.*\n\n` +
                `${cleared || 'No admin'} has been removed and the admin-layer settings (max tries, public access) were reset to defaults.\n\n` +
                `Word pool and any creator overrides are untouched.\n\n` +
                `The next */hmg admin* request will begin a fresh onboarding. 🔑`
        })
        return
    }

    // ─── /hmg reset ──────────────────────────────
    if (cmd[0] === 'reset') {
        const keepAdminNumber = settings.adminNumber
        const keepAdminJid    = settings.adminJid
        Object.assign(settings, {
            maxTries: 'auto',
            publicVisible: true, publicCanStart: false
        })
        delete settings.creatorOverrides
        settings.adminNumber = keepAdminNumber
        settings.adminJid    = keepAdminJid
        saveSettings()
        pendingAdminChangeRef.value = null

        const { DEFAULT_WORDS } = require('./gameEngine')
        words.length = 0
        words.push(...DEFAULT_WORDS)
        saveWords()

        for (const key in games) {
            const g = games[key]
            if (g.lobbyTimer)    clearInterval(g.lobbyTimer)
            if (g.turnTimer)     clearInterval(g.turnTimer)
            if (g.cooldownTimer) clearInterval(g.cooldownTimer)
            delete games[key]
        }
        const GAMES_FILE = 'games.json'
        if (fs.existsSync(GAMES_FILE)) fs.unlinkSync(GAMES_FILE)
        activeGameChatRef.value = null
        await sendSafeMessage(sock, replyTo, {
            text:
                `🔄 *Reset Complete* ✅\n\n` +
                `Settings, creator overrides, and the word pool were restored to defaults. Any active game was ended.\n\n` +
                (keepAdminNumber
                    ? `👑 Admin (\`${keepAdminNumber}\`) keeps their access — use */hmg clearadmin* if you want to remove them too.`
                    : `The bot has no admin set — the next */hmg admin* request will begin onboarding.`)
        })
        return
    }

    // ─── /hmg status ─────────────────────────────
    if (cmd[0] === 'status') {
        const activeGameChat = activeGameChatRef.value
        if (!activeGameChat) {
            await sendSafeMessage(sock, replyTo, {
                text:
                    `📊 *${config.GAME_ACRONYM} Bot Status*\n\n` +
                    `🎮 No game or lobby is currently active.\n\n` +
                    `*Config:*\n` +
                    `› Max Tries: *${formatMaxTries(resolveSetting('maxTries', settings, 'auto'))}*\n` +
                    `› Public Visible: *${resolveSetting('publicVisible', settings, true) ? '🟢 ON' : '🔴 OFF'}*\n` +
                    `› Public Can Start: *${resolveSetting('publicCanStart', settings, false) ? '🟢 ON' : '🔴 OFF'}*\n` +
                    `› Auto-Join Lobby: *${resolveSetting('autoJoin', settings, true) ? '🟢 ON' : '🔴 OFF'}*\n` +
                    `› Admin: *${settings.adminNumber || 'None'}*`
            })
        } else {
            const gs = getGameState(activeGameChat, games)
            let statusText = `📊 *${config.GAME_ACRONYM} Bot Status*\n\n`

            if (gs.cooldownActive) {
                statusText += `☕ *COOLDOWN* — ${activeGameChat}\n`
                statusText += `⏱️ Next lobby opens in: *${gs.cooldownSecondsLeft}s*\n`
                statusText += `📏 Next word length: *~${gs.wordLengthTarget} letters*\n`
            } else if (gs.lobbyActive) {
                statusText += `🏠 *LOBBY OPEN* — ${activeGameChat}\n`
                statusText += `👥 Players joined: *${gs.players.length}*\n`
                statusText += `⏱️ Time left: *${gs.lobbySecondsLeft}s*\n`
                if (gs.players.length > 0) {
                    statusText += `\n*Players:*\n`
                    gs.players.forEach((num, i) => { statusText += `${i + 1}. ${gs.playerNames[num] || num}\n` })
                }
            } else if (gs.active) {
                const currentPlayer = gs.players[gs.currentTurnIndex]
                statusText += `🎮 *GAME IN PROGRESS* — ${activeGameChat}\n`
                statusText += gs.paused ? `⏸️ Status: *PAUSED*\n` : `▶️ Status: *LIVE*\n`
                statusText += `📝 Word: \`${gs.hiddenWord.join(' ')}\` (${gs.targetWord.length} letters)\n`
                const attemptsUsed = Object.values(gs.attempts || {}).reduce((a, b) => a + b, 0)
                const roundMaxTries = gs.roundMaxTries || resolveSetting('maxTries', settings, 'auto')
                statusText += `💥 Wrong guesses so far: *${attemptsUsed}* total (max ${formatMaxTries(roundMaxTries)}/player)\n`
                statusText += `🎯 Current turn: *${gs.playerNames[currentPlayer] || currentPlayer}*\n`
                statusText += `👥 Players: *${gs.players.length}*\n`
                if (!gs.paused) statusText += `⏱️ Turn timer: *${gs.turnSecondsLeft}s*\n`
            }

            statusText += `\n*Config:*\n`
            statusText += `› Max Tries: *${formatMaxTries(resolveSetting('maxTries', settings, 'auto'))}*`

            await sendSafeMessage(sock, replyTo, { text: statusText })
        }
        return
    }

    // ─── Game control commands ────────────────────
    const activeGameChat = activeGameChatRef.value

    if (cmd[0] === 'start') {
        if (!activeGameChat) {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ No active lobby to force-start. Open one with *${config.PREFIX} start* in the group first.` })
        } else {
            const gs = getGameState(activeGameChat, games)
            if (gs.lobbyActive) {
                if (gs.lobbyTimer) clearInterval(gs.lobbyTimer)
                await sock.sendMessage(activeGameChat, {
                    text: `⚡ *Game starting early!*\n\nThe admin has force-started the game. Lobby is now closed — let's go! 🎮`
                })
                await sendSafeMessage(sock, replyTo, { text: `▶️ *Force-start sent.* Game is launching now in the group. ⚡` })
                await startActualGame(activeGameChat, {
                    sock, games, settings, words, activeGameChatRef, persistGames, nameCache
                })
            } else if (gs.active) {
                await sendSafeMessage(sock, replyTo, { text: `⚠️ The game is already in progress — use */hmg end* to stop it first.` })
            } else {
                await sendSafeMessage(sock, replyTo, { text: `⚠️ No active lobby found. Open one with *${config.PREFIX} start* in the group.` })
            }
        }
        return
    }

    if (cmd[0] === 'pause') {
        if (!activeGameChat) {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ No active game to pause right now.` })
        } else {
            const gs = getGameState(activeGameChat, games)
            if (gs.active && !gs.paused) {
                gs.paused = true
                persistGames()
                await sendSafeMessage(sock, replyTo, { text: `⏸️ *Game paused.* ✅` })
                await sock.sendMessage(activeGameChat, { text: `⏸️ *Game paused by the admin.* Sit tight — we'll be right back! ☕` })
            } else {
                await sendSafeMessage(sock, replyTo, { text: `⚠️ Game is already paused or no round is in progress.` })
            }
        }
        return
    }

    if (cmd[0] === 'resume') {
        if (!activeGameChat) {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ No active game to resume right now.` })
        } else {
            const gs = getGameState(activeGameChat, games)
            if (gs.active && gs.paused) {
                gs.paused = false
                persistGames()
                await sendSafeMessage(sock, replyTo, { text: `▶️ *Game resumed!* ✅` })
                await sock.sendMessage(activeGameChat, { text: `▶️ *Game resumed by the admin!* Back in action — keep guessing! 🔥` })
                startTurnCountdown(activeGameChat, { sock, games, settings, activeGameChatRef, persistGames, nameCache: ctx.nameCache })
            } else {
                await sendSafeMessage(sock, replyTo, { text: `⚠️ Game is not currently paused.` })
            }
        }
        return
    }

    if (cmd[0] === 'end' || cmd[0] === 'stop') {
        if (!activeGameChat) {
            await sendSafeMessage(sock, replyTo, { text: `⚠️ No active game or lobby to end right now.` })
        } else {
            const gs        = getGameState(activeGameChat, games)
            const endedChat = activeGameChat
            gs.active = false
            gs.lobbyActive = false
            gs.cooldownActive = false
            if (gs.lobbyTimer)    clearInterval(gs.lobbyTimer)
            if (gs.turnTimer)     clearInterval(gs.turnTimer)
            if (gs.cooldownTimer) clearInterval(gs.cooldownTimer)
            gs.players = []
            gs.playerNames = {}
            gs.playerJids = {}
            gs.skipStreaks = {}
            gs.attempts = {}
            gs.disqualified = []
            activeGameChatRef.value = null
            persistGames()
            await sendSafeMessage(sock, replyTo, { text: `🛑 *Game terminated.* ✅` })
            await sock.sendMessage(endedChat, { text: `🛑 *Game terminated by the admin.* Thanks for playing, everyone! 👋` })
        }
        return
    }

    // Unknown command — absolute silence
}

module.exports = { handleAdminCommand }
