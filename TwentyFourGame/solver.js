// ============================================================
//  solver.js — The 24 Game · Sky Graphics
//  Two independent jobs, kept in one file because they share the
//  same arithmetic core:
//
//   1. validateSolution()  — safely parses a PLAYER's typed expression
//      (hand-written recursive-descent parser, never eval()) and checks
//      it (a) is valid arithmetic, (b) uses exactly the round's 4 numbers,
//      each once, and (c) evaluates to the target (24 by default).
//
//   2. findSolution() / isSolvable() — brute-force search used only by
//      the PUZZLE GENERATOR (numberBank.js) to confirm a freshly rolled
//      quadruple is actually solvable before it's ever shown to players,
//      and to reveal one example solution when nobody solves a round.
//      This is never used to grade a player's own expression — their
//      answer stands or falls on its own arithmetic merit.
// ============================================================

const EPSILON = 1e-6

// ─── Tokenizer + recursive-descent parser (safe: no eval) ─────
function tokenize(str) {
    const tokens = []
    let i = 0
    while (i < str.length) {
        const ch = str[i]
        if (/\s/.test(ch)) { i++; continue }
        if (/[0-9.]/.test(ch)) {
            let j = i
            while (j < str.length && /[0-9.]/.test(str[j])) j++
            const raw = str.slice(i, j)
            if ((raw.match(/\./g) || []).length > 1) throw new Error('Malformed number')
            tokens.push({ type: 'NUM', value: parseFloat(raw) })
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

    function parseExpr() {
        let value = parseTerm()
        while (peek() && (peek().type === '+' || peek().type === '-')) {
            const op = consume(peek().type).type
            const rhs = parseTerm()
            value = op === '+' ? value + rhs : value - rhs
        }
        return value
    }

    function parseTerm() {
        let value = parseFactor()
        while (peek() && (peek().type === '*' || peek().type === '/')) {
            const op = consume(peek().type).type
            const rhs = parseFactor()
            if (op === '/') {
                if (Math.abs(rhs) < EPSILON) throw new Error('Division by zero')
                value = value / rhs
            } else {
                value = value * rhs
            }
        }
        return value
    }

    function parseFactor() {
        const t = peek()
        if (t && t.type === '-') { consume('-'); return -parseFactor() }
        if (t && t.type === '+') { consume('+'); return parseFactor() }
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
        throw new Error('Expected number or "("')
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

function multisetsEqual(a, b) {
    if (a.length !== b.length) return false
    const sa = [...a].sort((x, y) => x - y)
    const sb = [...b].sort((x, y) => x - y)
    return sa.every((v, i) => Math.abs(v - sb[i]) < EPSILON)
}

/**
 * Validates a player's raw typed expression against the round's required
 * numbers. This is the ONLY function that should ever be used to decide
 * whether a player's guess counts as a win.
 */
function validateSolution(expressionStr, requiredNumbers, target = 24) {
    let parsed
    try {
        parsed = evaluateExpression(expressionStr)
    } catch (err) {
        return { valid: false, reason: 'unparseable' }
    }
    if (!multisetsEqual(parsed.usedNumbers, requiredNumbers)) {
        return { valid: false, reason: 'wrong_numbers', usedNumbers: parsed.usedNumbers, result: parsed.result }
    }
    if (Math.abs(parsed.result - target) > EPSILON) {
        return { valid: false, reason: 'wrong_result', result: parsed.result }
    }
    return { valid: true, result: parsed.result }
}

// Quick pre-filter so ordinary chat text never even reaches the parser —
// a "guess" must look like pure arithmetic before we bother trying.
function looksLikeExpression(str) {
    return /^[\s0-9+\-*/().]+$/.test(str) && /[0-9]/.test(str)
}

// ─── Brute-force solvability (puzzle generation + reveal-a-solution
// only — never used to judge a player's own submitted expression) ──
const OPS = ['+', '-', '*', '/']

function applyOp(a, op, b) {
    switch (op) {
        case '+': return a + b
        case '-': return a - b
        case '*': return a * b
        case '/': return Math.abs(b) < EPSILON ? null : a / b
        default:  return null
    }
}

function isNearInt(v) { return Math.abs(v - Math.round(v)) < EPSILON }

// All 5 binary-tree shapes for combining 4 ordered operands (Catalan(3) = 5).
// requireIntegerPath, when true, rejects any combination whose intermediate
// result isn't (near) an integer — used to grade "does this puzzle have an
// easy, integer-only path" vs "fractions required" for difficulty tiering.
function combine4(nums, ops, requireIntegerPath) {
    const [a, b, c, d] = nums
    const [o1, o2, o3] = ops
    const A = { v: a, e: String(a) }, B = { v: b, e: String(b) }
    const C = { v: c, e: String(c) }, D = { v: d, e: String(d) }

    const t = (op, x, y) => {
        const v = applyOp(x.v, op, y.v)
        if (v === null) return null
        if (requireIntegerPath && !isNearInt(v)) return null
        return { v, e: `(${x.e} ${op} ${y.e})` }
    }

    const results = []
    let s

    s = t(o1, A, B); if (s) { s = t(o2, s, C); if (s) { s = t(o3, s, D); if (s) results.push(s) } }          // ((a o1 b) o2 c) o3 d
    s = t(o2, B, C); if (s) { let l = t(o1, A, s); if (l) { l = t(o3, l, D); if (l) results.push(l) } }        // (a o1 (b o2 c)) o3 d
    const left = t(o1, A, B), right = t(o3, C, D)
    if (left && right) { const m = t(o2, left, right); if (m) results.push(m) }                                // (a o1 b) o2 (c o3 d)
    s = t(o2, B, C); if (s) { let r = t(o3, s, D); if (r) { r = t(o1, A, r); if (r) results.push(r) } }        // a o1 ((b o2 c) o3 d)
    s = t(o3, C, D); if (s) { let r = t(o2, B, s); if (r) { r = t(o1, A, r); if (r) results.push(r) } }        // a o1 (b o2 (c o3 d))

    return results
}

function permutations(arr) {
    if (arr.length <= 1) return [arr]
    const out = []
    for (let i = 0; i < arr.length; i++) {
        const rest = [...arr.slice(0, i), ...arr.slice(i + 1)]
        for (const p of permutations(rest)) out.push([arr[i], ...p])
    }
    return out
}

/**
 * Searches every permutation × operator triple × tree shape for a way to
 * reach `target`. Returns the first hit (not exhaustive collection — we
 * only need existence + one example for hints).
 */
function findSolution(numbers, target = 24, integerPathOnly = false) {
    for (const perm of permutations(numbers)) {
        for (const o1 of OPS) for (const o2 of OPS) for (const o3 of OPS) {
            const combos = combine4(perm, [o1, o2, o3], integerPathOnly)
            for (const c of combos) {
                if (Math.abs(c.v - target) < EPSILON) {
                    return { solvable: true, expression: c.e }
                }
            }
        }
    }
    return { solvable: false }
}

function isSolvable(numbers, target = 24) {
    return findSolution(numbers, target, false).solvable
}

module.exports = {
    EPSILON,
    evaluateExpression,
    validateSolution,
    looksLikeExpression,
    findSolution,
    isSolvable
}
