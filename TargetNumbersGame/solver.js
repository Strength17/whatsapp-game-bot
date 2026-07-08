// ============================================================
//  solver.js — Target Numbers (TGT) · Sky Graphics
//  Two jobs sharing one arithmetic core, same split as M4T's solver:
//
//   1. validateSolution() — safely parses a PLAYER's typed expression
//      (hand-written recursive-descent parser, no eval()) enforcing the
//      real numbers-round rules: every intermediate result must be a
//      positive integer (no fractions, no negatives, ever), the player
//      doesn't have to use all 6 numbers, and no number may be used more
//      times than it actually appears in the round's pool.
//
//   2. bestSolution() — brute-force (memoized, pairwise-reduction) search
//      used only by the puzzle GENERATOR to confirm a freshly rolled
//      pool/target pair has at least a "within 10" solution before it's
//      ever served, and to reveal one example when nobody scores.
// ============================================================

// ─── Tokenizer + recursive-descent parser (safe: no eval) ─────
function tokenize(str) {
    const tokens = []
    let i = 0
    while (i < str.length) {
        const ch = str[i]
        if (/\s/.test(ch)) { i++; continue }
        if (/[0-9]/.test(ch)) {
            let j = i
            while (j < str.length && /[0-9]/.test(str[j])) j++
            tokens.push({ type: 'NUM', value: parseInt(str.slice(i, j), 10) })
            i = j
            continue
        }
        if (ch === '×') { tokens.push({ type: '*' }); i++; continue }
        if (ch === '÷') { tokens.push({ type: '/' }); i++; continue }
        if ('+-*/()'.includes(ch)) { tokens.push({ type: ch }); i++; continue }
        throw new Error(`Unexpected character "${ch}"`)
    }
    return tokens
}

class RuleViolation extends Error {}

function parse(tokens) {
    let pos = 0
    const usedNumbers = []

    const peek = () => tokens[pos]
    const consume = (type) => {
        const t = tokens[pos]
        if (!t || t.type !== type) throw new Error(`Expected "${type}"`)
        pos++
        return t
    }

    function checkStep(v) {
        if (!Number.isInteger(v) || v <= 0) {
            throw new RuleViolation('Every step must stay a positive whole number — no fractions or negatives.')
        }
        return v
    }

    function parseExpr() {
        let value = parseTerm()
        while (peek() && (peek().type === '+' || peek().type === '-')) {
            const op = consume(peek().type).type
            const rhs = parseTerm()
            value = op === '+' ? checkStep(value + rhs) : checkStep(value - rhs)
        }
        return value
    }

    function parseTerm() {
        let value = parseFactor()
        while (peek() && (peek().type === '*' || peek().type === '/')) {
            const op = consume(peek().type).type
            const rhs = parseFactor()
            if (op === '/') {
                if (rhs === 0 || value % rhs !== 0) throw new RuleViolation('Division must come out even — no fractions.')
                value = checkStep(value / rhs)
            } else {
                value = checkStep(value * rhs)
            }
        }
        return value
    }

    function parseFactor() {
        const t = peek()
        if (t && t.type === '(') {
            consume('(')
            const value = parseExpr()
            consume(')')
            return value
        }
        if (t && t.type === 'NUM') {
            consume('NUM')
            usedNumbers.push(t.value)
            return t.value
        }
        throw new Error('Expected a number or "("')
    }

    const result = parseExpr()
    if (pos !== tokens.length) throw new Error('Unexpected trailing input')
    return { result, usedNumbers }
}

function evaluateExpression(str) {
    const tokens = tokenize(str)
    if (tokens.length === 0) throw new Error('Empty expression')
    return parse(tokens)
}

function looksLikeExpression(str) {
    return /^[\s0-9+\-*/()]+$/.test(str) && /[0-9]/.test(str)
}

// Checks that `used` (with repeats) is a sub-multiset of `pool` (with repeats).
function isSubMultiset(used, pool) {
    const remaining = [...pool]
    for (const n of used) {
        const idx = remaining.indexOf(n)
        if (idx === -1) return false
        remaining.splice(idx, 1)
    }
    return true
}

/**
 * Validates a player's raw typed expression against the round's number
 * pool. Not all numbers need to be used, but nothing may be used more
 * times than it appears in the pool, and every intermediate step must be
 * a positive integer (division must be exact, subtraction can't go ≤ 0).
 */
function validateSolution(expressionStr, pool, target) {
    let parsed
    try {
        parsed = evaluateExpression(expressionStr)
    } catch (err) {
        if (err instanceof RuleViolation) return { valid: false, reason: 'rule_violation', message: err.message }
        return { valid: false, reason: 'unparseable' }
    }
    if (!isSubMultiset(parsed.usedNumbers, pool)) {
        return { valid: false, reason: 'wrong_numbers', usedNumbers: parsed.usedNumbers }
    }
    const diff = Math.abs(parsed.result - target)
    return { valid: true, result: parsed.result, diff }
}

// ─── Best-reachable-value search (generator + reveal-a-solution only) ──
const OPS = ['+', '-', '*', '/']

function applyOp(a, op, b) {
    switch (op) {
        case '+': return a + b
        case '-': { const v = a - b; return v > 0 ? v : null }
        case '*': return a * b
        case '/': return (b !== 0 && a % b === 0) ? a / b : null
        default:  return null
    }
}

/**
 * Recursively combines pairs in the pool (Countdown's canonical solving
 * approach), tracking the closest value to `target` seen at any point —
 * you don't have to use every number, so every intermediate value is
 * itself a valid candidate answer.
 */
function bestSolution(numbers, target) {
    let best = null
    const seen = new Set()

    function consider(value, expr) {
        const diff = Math.abs(value - target)
        if (!best || diff < best.diff) best = { value, diff, expr }
    }

    function recurse(pool) {
        const key = [...pool.map(p => p.value)].sort((a, b) => a - b).join(',')
        if (seen.has(key)) return
        seen.add(key)

        for (const p of pool) consider(p.value, p.expr)
        if (best && best.diff === 0) return // exact hit found, no need to keep searching
        if (pool.length < 2) return

        for (let i = 0; i < pool.length; i++) {
            for (let j = i + 1; j < pool.length; j++) {
                const a = pool[i], b = pool[j]
                const rest = pool.filter((_, k) => k !== i && k !== j)

                const attempts = [
                    ['+', a, b], ['*', a, b],
                    ['-', a, b], ['-', b, a],
                    ['/', a, b], ['/', b, a]
                ]
                for (const [op, x, y] of attempts) {
                    const v = applyOp(x.value, op, y.value)
                    if (v === null) continue
                    const expr = `(${x.expr} ${op} ${y.expr})`
                    consider(v, expr)
                    recurse([...rest, { value: v, expr }])
                    if (best && best.diff === 0) return
                }
            }
        }
    }

    recurse(numbers.map(n => ({ value: n, expr: String(n) })))
    return best
}

module.exports = {
    evaluateExpression,
    validateSolution,
    looksLikeExpression,
    bestSolution
}
