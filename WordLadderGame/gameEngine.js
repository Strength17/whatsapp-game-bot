// WordLadderGame/gameEngine.js
// Pure game-state logic. No WhatsApp I/O here.

'use strict';

const cfg  = require('./config');
const { DICTIONARY, THEMED_PAIRS } = require('./wordBank');

// ── BFS: find shortest path between two words ────────────────────────────────
function bfsSolve(start, end) {
    if (start === end) return [start];
    const queue   = [[start, [start]]];
    const visited = new Set([start]);
    while (queue.length) {
        const [current, path] = queue.shift();
        const neighbours = getNeighbours(current);
        for (const nb of neighbours) {
            if (nb === end) return [...path, nb];
            if (!visited.has(nb)) {
                visited.add(nb);
                queue.push([nb, [...path, nb]]);
            }
        }
    }
    return null; // no path
}

// ── BFS: get all valid one-letter-change neighbours ──────────────────────────
function getNeighbours(word) {
    const result = [];
    const alpha  = 'abcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < word.length; i++) {
        for (const c of alpha) {
            if (c === word[i]) continue;
            const candidate = word.slice(0, i) + c + word.slice(i + 1);
            if (DICTIONARY.has(candidate)) result.push(candidate);
        }
    }
    return result;
}

// ── Pick a random puzzle pair for a given theme ──────────────────────────────
function pickPuzzle(theme = cfg.DEFAULT_THEME, targetLength = cfg.START_WORD_LENGTH) {
    const pool = (THEMED_PAIRS[theme] || THEMED_PAIRS.general)
        .filter(([s]) => s.length === targetLength || targetLength === 0);

    // fall back to any length if none at target length
    const eligible = pool.length ? pool : THEMED_PAIRS[theme] || THEMED_PAIRS.general;
    const chosen   = eligible[Math.floor(Math.random() * eligible.length)];
    const [start, end, , hint] = chosen;

    // BFS-verify and get full solution path
    const solution = bfsSolve(start, end);
    return { start, end, solution, steps: solution ? solution.length - 1 : 0, hint };
}

// ── Lazy state creator (mirrors Hangman's getGameState pattern) ──────────────
// State is stored under a GAME_KEY-prefixed key (not the bare chatId) —
// the `games` object is shared across every game module. See the same
// note in HangmanGame/gameEngine.js.
function stateKey(chatId) {
    return `${cfg.GAME_KEY}:${chatId}`;
}

function getGameState(chatId, games) {
    const key = stateKey(chatId);
    if (!games[key]) {
        games[key] = createFreshState();
    }
    return games[key];
}

function createFreshState() {
    return {
        active:          false,
        theme:           cfg.DEFAULT_THEME,
        wordLength:      cfg.START_WORD_LENGTH,
        startWord:       null,
        endWord:         null,
        solution:        [],          // BFS optimal path
        chain:           [],          // what players have built so far [startWord, ...]
        currentWord:     null,        // the word they need to transform next
        hintsUsed:       0,
        scores:          {},          // { senderNumber: totalPoints }
        roundHistory:    [],          // track wins/timeouts for adaptive difficulty
        turnTimer:       null,
        hintTimer:       null,
        consecutiveTimeouts: 0,
        lastSolveSteps:  null,
        roundCount:      0,
    };
}

// ── Start a new round ────────────────────────────────────────────────────────
function startRound(state) {
    const puzzle = pickPuzzle(state.theme, state.wordLength);
    state.active      = true;
    state.startWord   = puzzle.start;
    state.endWord     = puzzle.end;
    state.solution    = puzzle.solution;
    state.chain       = [puzzle.start];
    state.currentWord = puzzle.start;
    state.hintsUsed   = 0;
    state.roundCount  = (state.roundCount || 0) + 1;
    state.puzzleHint  = puzzle.hint;
    state.stepsTaken  = 0;
    return puzzle;
}

// ── Validate a player's guess ────────────────────────────────────────────────
// Returns: { valid, reason, isWin }
function validateGuess(state, guess) {
    guess = guess.toLowerCase().trim();

    if (!state.active) return { valid: false, reason: 'no_game' };
    if (guess.length !== state.currentWord.length)
        return { valid: false, reason: 'wrong_length' };
    if (!DICTIONARY.has(guess))
        return { valid: false, reason: 'not_a_word' };
    if (state.chain.includes(guess))
        return { valid: false, reason: 'already_used' };

    // Must differ by exactly one letter from currentWord
    let diffs = 0;
    for (let i = 0; i < guess.length; i++) {
        if (guess[i] !== state.currentWord[i]) diffs++;
    }
    if (diffs !== 1) return { valid: false, reason: 'not_one_letter_change' };

    // Valid step
    state.chain.push(guess);
    state.currentWord = guess;
    state.stepsTaken++;

    const isWin = guess === state.endWord;
    if (isWin) {
        state.lastSolveSteps = state.stepsTaken;
        state.consecutiveTimeouts = 0;
    }
    return { valid: true, reason: 'ok', isWin };
}

// ── Award points ─────────────────────────────────────────────────────────────
function awardStep(state, senderNumber) {
    state.scores[senderNumber] = (state.scores[senderNumber] || 0) + cfg.POINTS_CORRECT_STEP;
}

function awardSolve(state, senderNumber) {
    state.scores[senderNumber] = (state.scores[senderNumber] || 0) + cfg.POINTS_FIRST_SOLVE;
}

function penaliseHint(state, senderNumber) {
    state.scores[senderNumber] = (state.scores[senderNumber] || 0) + cfg.POINTS_HINT_PENALTY;
}

function penaliseSkip(state, senderNumber) {
    if (senderNumber) {
        state.scores[senderNumber] = (state.scores[senderNumber] || 0) + cfg.POINTS_SKIP_PENALTY;
    }
}

// ── Adaptive difficulty ──────────────────────────────────────────────────────
// Called after a round ends. Mirrors Hangman's adjustNextWordLength pattern.
function adjustDifficulty(state) {
    const solvedEasily = state.lastSolveSteps !== null
        && state.lastSolveSteps <= cfg.MIN_STEPS_FOR_UPGRADE;

    if (solvedEasily) {
        state.wordLength = Math.min(state.wordLength + 1, cfg.MAX_WORD_LENGTH);
    } else if (state.consecutiveTimeouts >= cfg.MAX_TIMEOUTS_FOR_DOWNGRADE) {
        state.wordLength = Math.max(state.wordLength - 1, cfg.MIN_WORD_LENGTH);
        state.consecutiveTimeouts = 0;
    }
}

// ── Build the ladder display board ──────────────────────────────────────────
// Returns a multiline string like:
//   🔤 CAT  (start)
//      COT  ✅
//      COG  ✅
//   🎯 DOG  (end)
function buildBoard(state) {
    const lines = [];
    const maxIdx = state.chain.length - 1;
    for (let i = 0; i <= maxIdx; i++) {
        const word = state.chain[i].toUpperCase();
        if (i === 0)                         lines.push(`🔤 *${word}*  _(start)_`);
        else if (state.chain[i] === state.endWord) lines.push(`🏆 *${word}*  ✅ _YOU WIN!_`);
        else                                  lines.push(`   *${word}*  ✅`);
    }
    // Show remaining blanks
    const stepsLeft = (state.solution.length - 1) - state.stepsTaken;
    for (let i = 0; i < stepsLeft - 1; i++) lines.push(`   ${'_ '.repeat(state.currentWord.length).trim()}`);
    lines.push(`🎯 *${state.endWord.toUpperCase()}*  _(end)_`);
    return lines.join('\n');
}

// ── Get next hint (reveals one optimal next step) ───────────────────────────
function getHint(state) {
    if (state.hintsUsed >= cfg.MAX_HINTS_PER_ROUND) return null;
    // Find where we are in the BFS solution
    const solIdx = state.solution.indexOf(state.currentWord);
    if (solIdx === -1 || solIdx + 1 >= state.solution.length) return null;
    const nextOptimal = state.solution[solIdx + 1];
    state.hintsUsed++;
    // Reveal only the changed letter position as a clue, not the full word
    let hint = '';
    for (let i = 0; i < nextOptimal.length; i++) {
        hint += nextOptimal[i] !== state.currentWord[i] ? `*${nextOptimal[i].toUpperCase()}*` : state.currentWord[i].toUpperCase();
    }
    return hint;
}

// ── Scoreboard ───────────────────────────────────────────────────────────────
function getScoreboard(state, nameCache = {}) {
    return Object.entries(state.scores)
        .sort(([, a], [, b]) => b - a)
        .slice(0, cfg.MAX_PLAYERS_SCOREBOARD)
        .map(([num, pts], i) => {
            const name = nameCache[num] || num;
            const medal = ['🥇','🥈','🥉'][i] || `${i + 1}.`;
            return `${medal} ${name} — *${pts} pts*`;
        })
        .join('\n');
}

module.exports = {
    getGameState,
    stateKey,
    createFreshState,
    startRound,
    validateGuess,
    awardStep,
    awardSolve,
    penaliseHint,
    penaliseSkip,
    adjustDifficulty,
    buildBoard,
    getHint,
    getScoreboard,
    bfsSolve,
    getNeighbours,
};
