// WordLadderGame/publicCommands.js
// Handles all public-facing messages: !wlg commands + live word guesses.
// Exported: handlePublicMessage(msgCtx)

'use strict';

const cfg = require('./config');
const engine = require('./gameEngine');

// ── Emoji helpers ─────────────────────────────────────────────────────────────
const THEME_EMOJI = {
    general: '🔤',
    animals: '🐾',
    food:    '🍕',
    nature:  '🌿',
    tech:    '💻',
};

// ── Main handler ─────────────────────────────────────────────────────────────
async function handlePublicMessage(msgCtx) {
    const {
        sock, games, settings, activeGameChatRef, persistGames, nameCache,
        sendSafeMessage: _sendSafeMessage, from, body, rawBody, senderNumber, senderName, isAdmin,
    } = msgCtx;

    // The shared contract is sendSafeMessage(sock, jid, payload). This file
    // was written against a local (jid, text) convention throughout — shim
    // it here once instead of touching every call site, so every existing
    // `sendSafeMessage(from, someString)` call below keeps working.
    const sendSafeMessage = (jid, text) =>
        _sendSafeMessage(sock, jid, typeof text === 'string' ? { text } : text);

    const state = engine.getGameState(from, games);
    const text  = (body || '').trim().toLowerCase();

    // ── !wlg help ──────────────────────────────────────────────────────────
    if (text === `${cfg.PREFIX} help` || text === `${cfg.PREFIX}`) {
        await sendSafeMessage(from, buildHelp());
        return;
    }

    // ── !wlg start [theme] ─────────────────────────────────────────────────
    if (text.startsWith(`${cfg.PREFIX} start`)) {
        if (state.active) {
            await sendSafeMessage(from,
                `⏳ A round is already running!\n\n${engine.buildBoard(state)}\n\n🎯 Reach: *${state.endWord.toUpperCase()}*`);
            return;
        }
        const parts = text.split(' ');
        const requestedTheme = parts[2] || cfg.DEFAULT_THEME;
        const theme = cfg.THEMES.includes(requestedTheme) ? requestedTheme : cfg.DEFAULT_THEME;
        state.theme = theme;

        const puzzle = engine.startRound(state);
        persistGames();

        // Start turn timer
        scheduleTurnTimer(sock, from, state, games, persistGames, sendSafeMessage, nameCache, senderNumber);

        await sendSafeMessage(from,
            `${THEME_EMOJI[theme]} *Word Ladder Game* — Theme: *${theme.toUpperCase()}*\n\n` +
            `Transform the word one letter at a time to reach the target!\n\n` +
            `${engine.buildBoard(state)}\n\n` +
            `💬 Just type your next word in the chat!\n` +
            `📌 Rules: change exactly *one letter* per step. Each word must be real.\n` +
            `💡 Tip: type *!wlg hint* if you're stuck (costs ${Math.abs(cfg.POINTS_HINT_PENALTY)} pts)`
        );
        return;
    }

    // ── !wlg hint ──────────────────────────────────────────────────────────
    if (text === `${cfg.PREFIX} hint`) {
        if (!state.active) {
            await sendSafeMessage(from, `❌ No round running. Type *!wlg start* to begin!`);
            return;
        }
        if (state.hintsUsed >= cfg.MAX_HINTS_PER_ROUND) {
            await sendSafeMessage(from, `🚫 No hints left for this round! (max ${cfg.MAX_HINTS_PER_ROUND})`);
            return;
        }
        const hint = engine.getHint(state);
        if (!hint) {
            await sendSafeMessage(from, `🤔 Couldn't generate a hint right now. Try thinking about what letters could change!`);
            return;
        }
        engine.penaliseHint(state, senderNumber);
        persistGames();
        await sendSafeMessage(from,
            `💡 *Hint* (${cfg.POINTS_HINT_PENALTY} pts for ${senderName})\n\n` +
            `The next word looks like: *${hint}*\n` +
            `(bold letter = what changes)`
        );
        return;
    }

    // ── !wlg skip ──────────────────────────────────────────────────────────
    if (text === `${cfg.PREFIX} skip`) {
        if (!state.active || !isAdmin) return;
        await skipCurrentStep(sock, from, state, games, persistGames, sendSafeMessage, nameCache, senderNumber);
        return;
    }

    // ── !wlg scores ───────────────────────────────────────────────────────
    if (text === `${cfg.PREFIX} scores` || text === `${cfg.PREFIX} score`) {
        const board = engine.getScoreboard(state, nameCache);
        await sendSafeMessage(from,
            board
                ? `🏆 *Word Ladder Scores*\n\n${board}`
                : `📭 No scores yet. Type *!wlg start* to play!`
        );
        return;
    }

    // ── !wlg themes ───────────────────────────────────────────────────────
    if (text === `${cfg.PREFIX} themes`) {
        const list = cfg.THEMES.map(t => `${THEME_EMOJI[t]} *${t}* — type \`!wlg start ${t}\``).join('\n');
        await sendSafeMessage(from, `🎨 *Available Themes*\n\n${list}`);
        return;
    }

    // ── !wlg stop (admin only) ─────────────────────────────────────────────
    if (text === `${cfg.PREFIX} stop`) {
        if (!isAdmin) {
            await sendSafeMessage(from, `🔒 Only admins can stop the game.`);
            return;
        }
        if (!state.active) {
            await sendSafeMessage(from, `❌ No round is currently running.`);
            return;
        }
        clearTimers(state);
        state.active = false;
        persistGames();
        await sendSafeMessage(from,
            `🛑 Round stopped by admin.\n\n` +
            `✅ The solution was:\n*${state.solution.join(' → ').toUpperCase()}*`
        );
        scheduleNextRound(sock, from, state, games, persistGames, sendSafeMessage, nameCache);
        return;
    }

    // ── !wlg reset (admin only — wipes scores) ───────────────────────────
    if (text === `${cfg.PREFIX} reset`) {
        if (!isAdmin) {
            await sendSafeMessage(from, `🔒 Only admins can reset scores.`);
            return;
        }
        clearTimers(state);
        const fresh = engine.createFreshState();
        fresh.theme      = state.theme;
        fresh.wordLength = state.wordLength;
        games[engine.stateKey(from)] = fresh;
        persistGames();
        await sendSafeMessage(from, `♻️ Game reset! All scores cleared. Type *!wlg start* to play.`);
        return;
    }

    // ── Live guess — any plain message during an active round ──────────────
    if (state.active) {
        // Only intercept single-word messages that look like game guesses
        // (not commands, not long sentences)
        const guess = text.replace(/[^a-z]/g, '');
        if (!guess || text.includes(' ') || text.startsWith('!') || text.startsWith('/')) return;
        if (guess.length < cfg.MIN_WORD_LENGTH || guess.length > cfg.MAX_WORD_LENGTH) return;

        const result = engine.validateGuess(state, guess);

        if (!result.valid) {
            const msg = buildInvalidMsg(result.reason, state, guess);
            if (msg) await sendSafeMessage(from, msg);
            return;
        }

        // Valid step
        engine.awardStep(state, senderNumber);
        clearTimers(state);

        if (result.isWin) {
            engine.awardSolve(state, senderNumber);
            persistGames();
            engine.adjustDifficulty(state);

            const stepsTaken = state.stepsTaken;
            const optimal    = state.solution.length - 1;
            const efficiency = stepsTaken === optimal ? '🎯 PERFECT!' : stepsTaken <= optimal + 1 ? '⭐ Great!' : '✅ Done!';

            await sendSafeMessage(from,
                `🏆 *${senderName} completed the ladder!* ${efficiency}\n\n` +
                engine.buildBoard(state) + '\n\n' +
                `📊 Steps taken: *${stepsTaken}* (optimal: ${optimal})\n` +
                `💰 ${senderName} earns *+${cfg.POINTS_FIRST_SOLVE + cfg.POINTS_CORRECT_STEP} pts*\n\n` +
                `✅ Full solution: *${state.solution.join(' → ').toUpperCase()}*\n\n` +
                `🏅 *Scoreboard:*\n${engine.getScoreboard(state, nameCache)}`
            );

            state.active = false;
            scheduleNextRound(sock, from, state, games, persistGames, sendSafeMessage, nameCache);
        } else {
            persistGames();
            // Reset turn timer
            scheduleTurnTimer(sock, from, state, games, persistGames, sendSafeMessage, nameCache, senderNumber);

            await sendSafeMessage(from,
                `✅ *${senderName}* +${cfg.POINTS_CORRECT_STEP}pts\n\n` +
                engine.buildBoard(state) + '\n\n' +
                `🎯 Target: *${state.endWord.toUpperCase()}* | ` +
                `💡 Hints left: ${cfg.MAX_HINTS_PER_ROUND - state.hintsUsed}`
            );
        }
        return;
    }
}

// ── Auto-skip a step on turn timeout ────────────────────────────────────────
async function skipCurrentStep(sock, from, state, games, persistGames, sendSafeMessage, nameCache, timedOutPlayer) {
    if (!state.active) return;
    clearTimers(state);

    if (timedOutPlayer) engine.penaliseSkip(state, timedOutPlayer);
    state.consecutiveTimeouts = (state.consecutiveTimeouts || 0) + 1;

    // Reveal the optimal next step from BFS solution
    const solIdx  = state.solution.indexOf(state.currentWord);
    const nextOptimal = solIdx !== -1 && solIdx + 1 < state.solution.length
        ? state.solution[solIdx + 1]
        : null;

    if (nextOptimal) {
        const skipResult = engine.validateGuess(state, nextOptimal);
        if (skipResult.isWin) {
            persistGames();
            await sendSafeMessage(from,
                `⏱️ Time's up! The answer was *${nextOptimal.toUpperCase()}* — and that completes the ladder!\n\n` +
                engine.buildBoard(state) + '\n\n' +
                `✅ Solution: *${state.solution.join(' → ').toUpperCase()}*`
            );
            state.active = false;
            engine.adjustDifficulty(state);
            scheduleNextRound(sock, from, state, games, persistGames, sendSafeMessage, nameCache);
            return;
        }
    }

    persistGames();
    await sendSafeMessage(from,
        `⏱️ Time's up! Skipping this step...\n\n` +
        (nextOptimal ? `✨ One valid move was: *${nextOptimal.toUpperCase()}*\n\n` : '') +
        engine.buildBoard(state) + '\n\n' +
        `🎯 Keep going! Target: *${state.endWord.toUpperCase()}*`
    );

    // Restart turn timer for next step
    scheduleTurnTimer(sock, from, state, games, persistGames, sendSafeMessage, nameCache, null);
}

// ── Turn timer ────────────────────────────────────────────────────────────────
function scheduleTurnTimer(sock, from, state, games, persistGames, sendSafeMessage, nameCache, currentPlayer) {
    clearTimers(state);

    // Hint timer fires at halfway point
    state.hintTimer = setTimeout(async () => {
        if (!state.active) return;
        await sendSafeMessage(from,
            `⏰ *30 seconds left!* Still on *${state.currentWord.toUpperCase()}* → reach *${state.endWord.toUpperCase()}*\n` +
            `💡 Type *!wlg hint* if you need a nudge!`
        );
    }, cfg.HINT_DELAY_MS);

    // Turn timer — auto-skip
    state.turnTimer = setTimeout(async () => {
        if (!state.active) return;
        await skipCurrentStep(sock, from, state, games, persistGames, sendSafeMessage, nameCache, currentPlayer);
    }, cfg.TURN_TIMEOUT_MS);
}

// ── Round cooldown timer ──────────────────────────────────────────────────────
function scheduleNextRound(sock, from, state, games, persistGames, sendSafeMessage, nameCache) {
    const warningDelay = cfg.ROUND_COOLDOWN_MS - cfg.COOLDOWN_WARNING_MS;

    setTimeout(async () => {
        if (state.active) return;
        await sendSafeMessage(from,
            `🕐 *Next round starts in 30 seconds!*\n` +
            `Next word length: *${state.wordLength} letters* | Theme: *${state.theme}*\n\n` +
            `Type *!wlg themes* to suggest a theme!`
        );
    }, warningDelay);

    setTimeout(async () => {
        if (state.active) return;
        const puzzle = engine.startRound(state);
        persistGames();
        scheduleTurnTimer(sock, from, state, games, persistGames, sendSafeMessage, nameCache, null);
        await sendSafeMessage(from,
            `${THEME_EMOJI[state.theme]} *New Round ${state.roundCount}!* Theme: *${state.theme.toUpperCase()}*\n\n` +
            engine.buildBoard(state) + '\n\n' +
            `🎯 Target: *${state.endWord.toUpperCase()}* | 💬 Type your next word!`
        );
    }, cfg.ROUND_COOLDOWN_MS);
}

// ── Clear all timers ──────────────────────────────────────────────────────────
function clearTimers(state) {
    if (state.turnTimer) { clearTimeout(state.turnTimer); state.turnTimer = null; }
    if (state.hintTimer) { clearTimeout(state.hintTimer); state.hintTimer = null; }
}

// ── Invalid guess messages ───────────────────────────────────────────────────
function buildInvalidMsg(reason, state, guess) {
    switch (reason) {
        case 'wrong_length':
            return `❌ *${guess.toUpperCase()}* is ${guess.length} letters. Words must be *${state.currentWord.length} letters* this round!`;
        case 'not_a_word':
            return `❓ *${guess.toUpperCase()}* isn't in the dictionary. Try a real word!`;
        case 'already_used':
            return `🔁 *${guess.toUpperCase()}* was already used in this chain! Can't go back.`;
        case 'not_one_letter_change':
            return `↕️ *${guess.toUpperCase()}* differs by more than one letter from *${state.currentWord.toUpperCase()}*. Change exactly ONE letter!`;
        default:
            return null;
    }
}

// ── Help text ────────────────────────────────────────────────────────────────
function buildHelp() {
    return (
        `🔤 *Word Ladder Game — Commands*\n\n` +
        `*!wlg start* — Start a round (general theme)\n` +
        `*!wlg start [theme]* — Start with a theme\n` +
        `*!wlg themes* — See all 5 available themes\n` +
        `*!wlg hint* — Get a letter hint (${cfg.POINTS_HINT_PENALTY} pts)\n` +
        `*!wlg scores* — See the scoreboard\n` +
        `*!wlg stop* — Stop current round _(admin)_\n` +
        `*!wlg reset* — Wipe all scores _(admin)_\n` +
        `*!wlg help* — Show this message\n\n` +
        `🎯 *How to play:*\n` +
        `Transform the START word to the END word — changing exactly *one letter* per step. Every step must be a real word!\n\n` +
        `_Example: CAT → COT → COG → DOG_\n\n` +
        `⭐ *Scoring:*\n` +
        `• Each correct step: *+${cfg.POINTS_CORRECT_STEP} pts*\n` +
        `• Completing the ladder: *+${cfg.POINTS_FIRST_SOLVE} bonus pts*\n` +
        `• Using a hint: *${cfg.POINTS_HINT_PENALTY} pts*\n` +
        `• Turn timeout: *${cfg.POINTS_SKIP_PENALTY} pts*`
    );
}

module.exports = { handlePublicMessage };
