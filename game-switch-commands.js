// ============================================================
//  game-switch-commands.js — HMG Bot · Sky Graphics
//  Shared, game-agnostic CREATOR-ONLY commands, called ONLY from
//  index.js under the fixed "/game" prefix — never from inside any
//  individual game's adminCommands.js. This is deliberate: the whole
//  point is that switching games never requires knowing that game's
//  own acronym/prefix. "/game" always works, no matter what's active.
//
//    /game setgame [key]         — switch which game is currently active
//    /game setadminaccess [key|all] — scope which game(s) the admin may operate
//    /game status                 — show what's active + what's available
//    /game roletags on|off        — bot-wide (Creator)/(Admin) name tag toggle
//
//  "setgame" also attempts a clean hand-off (ARCHITECTURE.md §10): if the
//  previous game has a live session in the shared activeGameChatRef chat
//  and exports gameEngine.forceStopActiveSession(chatId, ctx), it's
//  called and cleanly stopped before the switch. If a game doesn't
//  export that function, the switch still happens — the confirmation
//  message just says so honestly instead of leaving orphaned timers
//  running silently.
//
//  index.js calls handleGameSwitchCommands(ctx) directly when a message
//  starts with "/game". Returns true if handled (and replied to).
// ============================================================

const registry = require('./games-registry')

async function handleGameSwitchCommands(ctx) {
    const {
        cmd, senderIsCreator, sock, sendSafeMessage, replyTo,
        settings, saveSettings, activeGameChatRef, games, persistGames
    } = ctx
    // ctx.senderIsAdmin is read directly (not destructured above) only by
    // the status branch below — kept optional so existing callers that
    // don't pass it still work fine for setgame/setadminaccess.

    // ── setgame [key] ───────────────────────────────────────
    if (cmd[0] === 'setgame') {
        if (!senderIsCreator) return false // not creator-only business here; let it fall through (will just be ignored)

        const target = (cmd[1] || '').toLowerCase()
        const game   = registry.getGame(target)

        if (!game) {
            const available = registry.listGameKeys().join(', ') || 'none loaded'
            await sendSafeMessage(sock, replyTo, {
                text:
                    `⚠️ Unknown game \`${target || '(none given)'}\`.\n` +
                    `Available: *${available}*\n` +
                    `Usage: \`setgame [key]\``
            })
            return true
        }

        // ── Clean hand-off — ARCHITECTURE.md §10 (optional contract) ──
        // If a previous game has a live session in the one shared
        // activeGameChatRef chat, try to stop it cleanly before flipping
        // settings.activeGame. Nothing here is mandatory on any game's
        // part: if forceStopActiveSession isn't exported, we say so
        // honestly instead of silently leaving orphaned timers running.
        const previousGame = registry.getActiveGame(settings)
        let stoppedNote = ''

        if (previousGame && activeGameChatRef && activeGameChatRef.value &&
            previousGame.config.GAME_KEY !== game.config.GAME_KEY) {

            if (typeof previousGame.gameEngine.forceStopActiveSession === 'function') {
                const stopped = await previousGame.gameEngine.forceStopActiveSession(
                    activeGameChatRef.value, { games, persistGames, sock, settings }
                )
                if (stopped) {
                    stoppedNote = `\n🛑 Stopped: *${previousGame.config.GAME_NAME}* was active in this chat — ended cleanly.\n`
                    activeGameChatRef.value = null
                    if (typeof persistGames === 'function') persistGames()
                }
            } else {
                stoppedNote =
                    `\n⚠️ *${previousGame.config.GAME_NAME}* may still have an active session in this chat — ` +
                    `it doesn't support clean hand-off yet. Consider \`${previousGame.config.ADMIN_PREFIX}stop\` first.\n`
            }
        }

        settings.activeGame = game.config.GAME_KEY
        saveSettings()

        await sendSafeMessage(sock, replyTo, {
            text:
                `✅ *Active game switched.*${stoppedNote}\n` +
                `🎮 Now running: *${game.config.GAME_NAME} (${game.config.GAME_ACRONYM})*\n` +
                `Public prefix: \`${game.config.PREFIX}\`\n` +
                `Admin prefix: \`${game.config.ADMIN_PREFIX.trim()}\`\n\n` +
                `_Only you, the creator, can switch the active game._`
        })
        return true
    }

    // ── setadminaccess [key|all] ────────────────────────────
    if (cmd[0] === 'setadminaccess') {
        if (!senderIsCreator) return false

        const target = (cmd[1] || '').toLowerCase()

        if (target === 'all') {
            settings.adminGameAccess = 'all'
            saveSettings()
            await sendSafeMessage(sock, replyTo, {
                text: `✅ Admin access scope: *ALL games*. The admin may operate whichever game is active.`
            })
            return true
        }

        const game = registry.getGame(target)
        if (!game) {
            const available = registry.listGameKeys().join(', ') || 'none loaded'
            await sendSafeMessage(sock, replyTo, {
                text:
                    `⚠️ Unknown game \`${target || '(none given)'}\`.\n` +
                    `Available: *${available}*, or \`all\`.\n` +
                    `Usage: \`setadminaccess [key|all]\``
            })
            return true
        }

        settings.adminGameAccess = game.config.GAME_KEY
        saveSettings()
        await sendSafeMessage(sock, replyTo, {
            text:
                `✅ Admin access scoped to *${game.config.GAME_NAME}* only.\n` +
                `The admin's commands will be silently ignored while any other game is active, until you change this again.`
        })
        return true
    }

    // ── status — show active game + admin scope + available games ──
    // Visible to admin tier and above (not senderIsCreator-only — the
    // admin should be able to see what's active even if scoped to it).
    if (cmd[0] === 'status') {
        if (!senderIsCreator && !ctx.senderIsAdmin) return false
        const active = registry.getActiveGame(settings)
        await sendSafeMessage(sock, replyTo, {
            text:
                `🎮 *Game Status*\n\n` +
                `Active: *${active ? `${active.config.GAME_NAME} (${active.config.GAME_ACRONYM})` : 'none loaded'}*\n` +
                `Admin scope: *${settings.adminGameAccess === 'all' ? 'ALL games' : settings.adminGameAccess}*\n` +
                `Available: *${registry.listGameKeys().join(', ') || 'none loaded'}*`
        })
        return true
    }

    // ── roletags on|off — bot-wide (Creator)/(Admin) name tag toggle ──
    // Creator-only. Read by permissions.nameTag() so it applies
    // identically across every game — one flag, one place, no per-game
    // duplication or drift.
    if (cmd[0] === 'roletags') {
        if (!senderIsCreator) return false

        const arg = (cmd[1] || '').toLowerCase()
        if (arg !== 'on' && arg !== 'off') {
            await sendSafeMessage(sock, replyTo, {
                text: `Usage: \`/game roletags on\` or \`/game roletags off\`\nCurrently: *${settings.showRoleTags === false ? 'OFF' : 'ON'}*`
            })
            return true
        }

        settings.showRoleTags = (arg === 'on')
        saveSettings()
        await sendSafeMessage(sock, replyTo, {
            text: `✅ Role tags (Creator)/(Admin) are now *${arg === 'on' ? 'ON' : 'OFF'}* — applies bot-wide, across every game.`
        })
        return true
    }

    return false
}

module.exports = { handleGameSwitchCommands }
