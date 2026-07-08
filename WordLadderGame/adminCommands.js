// WordLadderGame/adminCommands.js
// Handles all /wlg admin commands.
// Exported: handleAdminCommand(ctx)

'use strict';

const cfg    = require('./config');
const engine = require('./gameEngine');

const THEME_EMOJI = {
    general: '🔤', animals: '🐾', food: '🍕', nature: '🌿', tech: '💻',
};

async function handleAdminCommand(ctx) {
    const {
        sock, games, settings, persistGames, saveSettings, sendSafeMessage: _sendSafeMessage,
        senderNumber, senderDisplayId, senderName, senderJid, sender: from, body,
        isAdmin, senderTier, nameCache,
    } = ctx;

    // Shared contract is sendSafeMessage(sock, jid, payload) — shim to the
    // local (jid, text) convention used throughout this file. See the same
    // note in publicCommands.js.
    const sendSafeMessage = (jid, text) =>
        _sendSafeMessage(sock, jid, typeof text === 'string' ? { text } : text);

    // ── Admin scope guard (mirrors README contract) ───────────────────────
    const permissions = require('../permissions');
    const senderIsCreator = senderTier === permissions.TIERS.CREATOR;
    if (!senderIsCreator) {
        const scope = settings.adminGameAccess || 'all';
        if (scope !== 'all' && scope !== cfg.GAME_KEY) return;
    }
    if (!isAdmin && !senderIsCreator) return;

    const state   = engine.getGameState(from, games);
    const command = body.replace(cfg.ADMIN_PREFIX, '').trim().toLowerCase();

    // ── /wlg status ───────────────────────────────────────────────────────
    if (command === 'status') {
        const status = state.active
            ? `🟢 *Round ${state.roundCount} ACTIVE*\n` +
              `Theme: ${state.theme} | Word length: ${state.wordLength}\n` +
              `${state.startWord.toUpperCase()} → ${state.endWord.toUpperCase()}\n` +
              `Steps taken: ${state.stepsTaken} / ${state.solution.length - 1} optimal\n` +
              `Hints used: ${state.hintsUsed}/${cfg.MAX_HINTS_PER_ROUND}`
            : `🔴 *No round running*\nWord length: ${state.wordLength} | Theme: ${state.theme}`;

        await sendSafeMessage(from,
            `⚙️ *WLG Admin Status*\n\n${status}\n\n` +
            `Players with scores: ${Object.keys(state.scores).length}\n` +
            `Rounds played: ${state.roundCount}`
        );
        return;
    }

    // ── /wlg settheme [theme] ─────────────────────────────────────────────
    if (command.startsWith('settheme ')) {
        const requested = command.replace('settheme ', '').trim();
        if (!cfg.THEMES.includes(requested)) {
            await sendSafeMessage(from,
                `❌ Unknown theme: *${requested}*\n\nAvailable: ${cfg.THEMES.map(t => `*${t}*`).join(', ')}`
            );
            return;
        }
        state.theme = requested;
        persistGames();
        await sendSafeMessage(from, `${THEME_EMOJI[requested]} Theme set to *${requested}*. Takes effect on next round.`);
        return;
    }

    // ── /wlg setlength [3-6] ─────────────────────────────────────────────
    if (command.startsWith('setlength ')) {
        const len = parseInt(command.replace('setlength ', '').trim(), 10);
        if (isNaN(len) || len < cfg.MIN_WORD_LENGTH || len > cfg.MAX_WORD_LENGTH) {
            await sendSafeMessage(from,
                `❌ Word length must be ${cfg.MIN_WORD_LENGTH}–${cfg.MAX_WORD_LENGTH}.`
            );
            return;
        }
        state.wordLength = len;
        persistGames();
        await sendSafeMessage(from, `📏 Word length set to *${len}*. Takes effect on next round.`);
        return;
    }

    // ── /wlg skip ─────────────────────────────────────────────────────────
    if (command === 'skip') {
        if (!state.active) {
            await sendSafeMessage(from, `❌ No round running.`);
            return;
        }
        // Import inline to avoid circular dependency
        const { handlePublicMessage } = require('./publicCommands');
        // Manually trigger the skip by calling the same internal function
        // We replicate the skip logic here so we don't depend on publicCommands internals
        const solIdx = state.solution.indexOf(state.currentWord);
        const nextOptimal = solIdx !== -1 && solIdx + 1 < state.solution.length
            ? state.solution[solIdx + 1]
            : null;

        if (nextOptimal) {
            engine.validateGuess(state, nextOptimal);
            if (state.currentWord === state.endWord) {
                state.active = false;
                engine.adjustDifficulty(state);
                persistGames();
                await sendSafeMessage(from,
                    `⏭️ Skipped to end.\n✅ Solution: *${state.solution.join(' → ').toUpperCase()}*`
                );
                return;
            }
        }
        persistGames();
        await sendSafeMessage(from,
            `⏭️ Step skipped.\n` +
            (nextOptimal ? `✨ Optimal step was: *${nextOptimal.toUpperCase()}*\n` : '') +
            engine.buildBoard(state)
        );
        return;
    }

    // ── /wlg solution ─────────────────────────────────────────────────────
    if (command === 'solution') {
        if (!state.active) {
            await sendSafeMessage(from, `❌ No round running.`);
            return;
        }
        await sendSafeMessage(from,
            `🔐 *Admin — Full BFS Solution*\n\n` +
            `*${state.solution.join(' → ').toUpperCase()}*\n\n` +
            `_Keep this secret! 🤫_`
        );
        return;
    }

    // ── /wlg addpoints [number] [points] ─────────────────────────────────
    if (command.startsWith('addpoints ')) {
        const parts = command.replace('addpoints ', '').split(' ');
        if (parts.length < 2) {
            await sendSafeMessage(from, `Usage: /wlg addpoints [number] [points]`);
            return;
        }
        const targetNum = parts[0].replace(/[^0-9]/g, '');
        const pts       = parseInt(parts[1], 10);
        if (!targetNum || isNaN(pts)) {
            await sendSafeMessage(from, `❌ Invalid number or points value.`);
            return;
        }
        state.scores[targetNum] = (state.scores[targetNum] || 0) + pts;
        persistGames();
        const name = nameCache[targetNum] || targetNum;
        await sendSafeMessage(from, `✅ Added *${pts} pts* to *${name}*. New total: *${state.scores[targetNum]}*`);
        return;
    }

    // ── /wlg clearscores ─────────────────────────────────────────────────
    if (command === 'clearscores') {
        if (!senderIsCreator) {
            await sendSafeMessage(from, `🔒 Only the creator can clear scores.`);
            return;
        }
        state.scores = {};
        persistGames();
        await sendSafeMessage(from, `🗑️ All WLG scores cleared.`);
        return;
    }

    // ── /wlg help ─────────────────────────────────────────────────────────
    if (command === 'help') {
        await sendSafeMessage(from,
            `⚙️ *WLG Admin Commands*\n\n` +
            `*/wlg status* — Game state overview\n` +
            `*/wlg settheme [theme]* — Set theme for next round\n` +
            `*/wlg setlength [3-6]* — Set word length for next round\n` +
            `*/wlg skip* — Skip the current step (reveals optimal word)\n` +
            `*/wlg solution* — See the full BFS solution privately\n` +
            `*/wlg addpoints [number] [pts]* — Manually adjust a player's score\n` +
            `*/wlg clearscores* — Wipe all scores _(creator only)_\n` +
            `*/wlg help* — Show this message`
        );
        return;
    }
}

module.exports = { handleAdminCommand };
