// ============================================================
//  WordClimbGame/wordBank.js — WCL Bot · Sky Graphics
//  Curated offline dictionary, grouped by length (3-8) then by
//  starting letter, so the engine can cheaply:
//    1. pick a starting letter that actually HAS words at the
//       current target length (never serve an impossible prompt)
//    2. validate a player's guess (real word + right length +
//       right starting letter + not already used this match)
//
//  This mirrors the "flat pool, filtered on demand" approach used
//  by HangmanGame/gameEngine.js's DEFAULT_WORDS, just pre-bucketed
//  by letter since WCL has to hand out a specific letter, not just
//  a word. Swapping this for the offline `word-list` npm package
//  (already used by WordChainGame/dictionary.js) is a drop-in
//  upgrade later — isValidWord() is the only function that would
//  need to change internally.
// ============================================================

const DICTIONARY = {
    3: {
        a: ['ant', 'arc', 'art', 'axe'],
        b: ['bat', 'bed', 'bug', 'box'],
        c: ['cat', 'cup', 'cow', 'car'],
        d: ['dog', 'dot', 'dew', 'dry'],
        e: ['egg', 'ear', 'end', 'eye'],
        f: ['fan', 'fig', 'fox', 'fly'],
        g: ['gum', 'gap', 'gym', 'gun'],
        h: ['hat', 'hen', 'hop', 'hut'],
        i: ['ice', 'ink', 'ivy', 'irk'],
        j: ['jar', 'jaw', 'jet', 'jog'],
        k: ['key', 'kit', 'keg', 'kid'],
        l: ['log', 'lip', 'law', 'lid'],
        m: ['map', 'mud', 'mix', 'mob'],
        n: ['net', 'nut', 'nap', 'nod'],
        o: ['owl', 'oak', 'orb', 'oil'],
        p: ['pen', 'pig', 'pot', 'pod'],
        r: ['rat', 'rug', 'rib', 'row'],
        s: ['sun', 'sea', 'sky', 'sad'],
        t: ['top', 'toy', 'tab', 'tan'],
        w: ['web', 'wig', 'win', 'wax']
    },
    4: {
        a: ['acid', 'atom', 'aunt', 'axle'],
        b: ['blue', 'bell', 'bird', 'boat'],
        c: ['cake', 'cave', 'cost', 'crab'],
        d: ['desk', 'dice', 'door', 'draw'],
        e: ['echo', 'edge', 'exit', 'east'],
        f: ['fire', 'fish', 'frog', 'fuel'],
        g: ['gold', 'gift', 'glow', 'grip'],
        h: ['hero', 'hive', 'hunt', 'harp'],
        i: ['iron', 'idle', 'itch', 'isle'],
        j: ['joke', 'jump', 'jury', 'jazz'],
        k: ['king', 'kite', 'knot', 'kiwi'],
        l: ['lamp', 'leaf', 'lion', 'lock'],
        m: ['moon', 'mask', 'mint', 'mile'],
        n: ['nest', 'note', 'navy', 'nail'],
        o: ['oven', 'onyx', 'oval', 'oath'],
        p: ['plum', 'pond', 'push', 'pack'],
        r: ['rain', 'ring', 'rock', 'ruby'],
        s: ['star', 'ship', 'silk', 'snow'],
        t: ['tent', 'tide', 'tree', 'twin'],
        w: ['wolf', 'wave', 'wind', 'wire']
    },
    5: {
        a: ['apple', 'arrow', 'ashen', 'audit'],
        b: ['bread', 'brave', 'brick', 'brush'],
        c: ['cloud', 'crown', 'chair', 'charm'],
        d: ['dance', 'dream', 'draft', 'drift'],
        e: ['earth', 'eagle', 'elbow', 'elite'],
        f: ['flame', 'fruit', 'frost', 'fable'],
        g: ['grape', 'grain', 'giant', 'globe'],
        h: ['house', 'horse', 'honey', 'humor'],
        i: ['ivory', 'input', 'inbox', 'ideal'],
        j: ['juice', 'joint', 'jolly', 'jumbo'],
        k: ['knife', 'knock', 'kneel', 'khaki'],
        l: ['light', 'lemon', 'lucky', 'ledge'],
        m: ['music', 'mount', 'metal', 'mango'],
        n: ['night', 'novel', 'nurse', 'nudge'],
        o: ['ocean', 'olive', 'organ', 'onset'],
        p: ['pearl', 'plant', 'pride', 'prize'],
        r: ['river', 'robot', 'rider', 'rusty'],
        s: ['stone', 'sword', 'smile', 'storm'],
        t: ['tiger', 'trust', 'trail', 'torch'],
        w: ['water', 'witch', 'wagon', 'wheat']
    },
    6: {
        a: ['animal', 'anchor', 'artist', 'autumn'],
        b: ['basket', 'bright', 'bottle', 'bridge'],
        c: ['castle', 'candle', 'carpet', 'copper'],
        d: ['dragon', 'desert', 'dinner', 'double'],
        e: ['engine', 'empire', 'exceed', 'escape'],
        f: ['forest', 'friend', 'flower', 'fabric'],
        g: ['guitar', 'garden', 'golden', 'gravel'],
        h: ['harbor', 'hunter', 'helmet', 'hollow'],
        i: ['island', 'insect', 'income', 'invite'],
        j: ['jungle', 'jacket', 'jigsaw', 'jester'],
        k: ['kitten', 'kernel', 'kettle', 'karate'],
        l: ['ladder', 'legend', 'lizard', 'lumber'],
        m: ['mirror', 'monkey', 'museum', 'mantle'],
        n: ['needle', 'noodle', 'nickel', 'nature'],
        o: ['orange', 'orchid', 'oxygen', 'oyster'],
        p: ['planet', 'pencil', 'puzzle', 'purple'],
        r: ['rocket', 'ribbon', 'random', 'rustle'],
        s: ['silver', 'summer', 'system', 'symbol'],
        t: ['turtle', 'temple', 'thread', 'toasty'],
        w: ['window', 'wonder', 'wizard', 'winter']
    },
    7: {
        a: ['analyze', 'antenna', 'arrange', 'assault'],
        b: ['blanket', 'bicycle', 'balance', 'blossom'],
        c: ['captain', 'caution', 'chamber', 'crystal'],
        d: ['dolphin', 'dungeon', 'destiny', 'dressed'],
        e: ['elegant', 'evening', 'element', 'endless'],
        f: ['freedom', 'fortune', 'falcons', 'fantasy'],
        g: ['giraffe', 'gravity', 'granite', 'gallery'],
        h: ['harmony', 'horizon', 'hostage', 'hangout'],
        i: ['imagine', 'isolate', 'italics', 'inflate'],
        j: ['journey', 'jubilee', 'justice', 'january'],
        k: ['kingdom', 'kettles', 'kitchen', 'karaoke'],
        l: ['leopard', 'lantern', 'liberty', 'lobster'],
        m: ['machine', 'mystery', 'monster', 'musical'],
        n: ['network', 'nowhere', 'nursery', 'notable'],
        o: ['organic', 'octopus', 'offense', 'orbital'],
        p: ['penguin', 'picture', 'pyramid', 'perfect'],
        r: ['rainbow', 'reptile', 'railway', 'rustler'],
        s: ['sandbox', 'seventh', 'skyline', 'sparkle'],
        t: ['thunder', 'traffic', 'triumph', 'twisted'],
        w: ['warrior', 'weekend', 'whisper', 'workout']
    },
    8: {
        a: ['abstract', 'accident', 'airplane', 'aquarium'],
        b: ['backpack', 'baseball', 'birthday', 'boundary'],
        c: ['calendar', 'campfire', 'creature', 'crossbow'],
        d: ['daylight', 'dinosaur', 'doorstep', 'dramatic'],
        e: ['elephant', 'envelope', 'engineer', 'evidence'],
        f: ['festival', 'firework', 'flagship', 'football'],
        g: ['gigantic', 'graphics', 'grateful', 'gasoline'],
        h: ['handbook', 'hardware', 'hospital', 'handsome'],
        i: ['identity', 'infinite', 'internet', 'imperial'],
        j: ['joystick', 'judgment', 'junction', 'jealousy'],
        k: ['keyboard', 'kilogram', 'knapsack', 'kangaroo'],
        l: ['landmark', 'language', 'lifetime', 'longhorn'],
        m: ['mountain', 'medicine', 'multiply', 'material'],
        n: ['nickname', 'notebook', 'narrator', 'nutshell'],
        o: ['obstacle', 'operator', 'organism', 'overcome'],
        p: ['painting', 'password', 'pipeline', 'platform'],
        r: ['rational', 'reaction', 'republic', 'resource'],
        s: ['sandwich', 'sapphire', 'scissors', 'sunshine'],
        t: ['teamwork', 'terminal', 'triangle', 'treasure'],
        w: ['wardrobe', 'weakness', 'westward', 'workshop']
    }
}

// ─── Integrity guard ────────────────────────────────────────────
// Every word above was hand-picked to be a real word of the right
// length starting with the right letter, but this check runs once
// at module load and silently drops anything that slipped through
// wrong (wrong length, wrong first letter, or a duplicate) rather
// than letting a bad entry corrupt a live round later.
function cleanDictionary(raw) {
    const clean = {}
    for (const lenStr of Object.keys(raw)) {
        const len = parseInt(lenStr, 10)
        clean[len] = {}
        for (const letter of Object.keys(raw[lenStr])) {
            const seen = new Set()
            const words = raw[lenStr][letter].filter(w => {
                const lw = (w || '').toLowerCase()
                if (lw.length !== len) return false
                if (lw[0] !== letter) return false
                if (seen.has(lw)) return false
                seen.add(lw)
                return true
            })
            if (words.length > 0) clean[len][letter] = words
        }
    }
    return clean
}

const CLEAN_DICTIONARY = cleanDictionary(DICTIONARY)

function lettersWithWordsAt(length) {
    const byLen = CLEAN_DICTIONARY[length]
    if (!byLen) return []
    return Object.keys(byLen)
}

// Picks a starting letter that has at least one word at `length`,
// preferring one not in `excludeLetters` (used to avoid repeating
// the same letter twice in a row within a round). Falls back to
// the full pool if every letter is excluded.
function randomLetterAt(length, excludeLetters = []) {
    const fullPool = lettersWithWordsAt(length)
    if (fullPool.length === 0) return null
    const preferred = fullPool.filter(l => !excludeLetters.includes(l))
    const pool = preferred.length > 0 ? preferred : fullPool
    return pool[Math.floor(Math.random() * pool.length)]
}

function isValidWord(word, length, letter, usedWords = []) {
    const lw = (word || '').trim().toLowerCase()
    if (lw.length !== length) return false
    if (lw[0] !== letter) return false
    if (usedWords.includes(lw)) return false
    const byLen = CLEAN_DICTIONARY[length]
    if (!byLen || !byLen[letter]) return false
    return byLen[letter].includes(lw)
}

function maxKnownLength() {
    return Math.max(...Object.keys(CLEAN_DICTIONARY).map(n => parseInt(n, 10)))
}

function minKnownLength() {
    return Math.min(...Object.keys(CLEAN_DICTIONARY).map(n => parseInt(n, 10)))
}

module.exports = {
    DICTIONARY: CLEAN_DICTIONARY,
    lettersWithWordsAt,
    randomLetterAt,
    isValidWord,
    maxKnownLength,
    minKnownLength
}
