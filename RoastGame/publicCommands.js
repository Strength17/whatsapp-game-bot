// ============================================================
//  RoastGame/publicCommands.js — Sky Graphics
//  Handles all PUBLIC (non-admin) message flow for this game:
//    !roast              — explainer card (never stateful — see
//                           ARCHITECTURE.md §9, bare-acronym rule)
//    !roast help         — same as bare
//    !roast me           — nice-tier roast, variation A     (DM)
//    !roast me again     — nice-tier roast, variation B     (DM)
//    !roast savage       — savage-tier roast, variation A   (DM)
//    !roast savage again — savage-tier roast, variation B   (DM)
//
//  There is no live round, no lobby, no turn — every roast
//  request is a single stateless lookup into roastData.js.
//  Admin "/roast list" lives in adminCommands.js.
// ============================================================

const config = require('./config')
const engine = require('./gameEngine')

const HELP_TEXT =
    `${config.DIVIDER}\n` +
    `${config.BOT_EMOJI}  *${config.GAME_NAME} (${config.GAME_ACRONYM})*\n` +
    `${config.DIVIDER}\n\n` +
    `Your roast is 100% private — nobody in this group sees it unless ` +
    `you choose to screenshot and post it yourself.\n\n` +
    `*🎮 How to get yours:*\n` +
    `DM me directly (not in this group) with:\n` +
    `1️⃣ *${config.PREFIX} me* — a nice roast\n` +
    `2️⃣ *${config.PREFIX} me again* — a second nice one\n` +
    `3️⃣ *${config.PREFIX} savage* — the dirty version\n` +
    `4️⃣ *${config.PREFIX} savage again* — a second dirty one\n\n` +
    `${config.DIVIDER}\n` +
    `_Sky Graphics — ${config.GAME_NAME}_ 😁`

const NO_PROFILE_TEXT =
    `😅 *No roast on file for you yet.*\n\n` +
    `Roast profiles are hand-built from the group's chat history — ` +
    `if you're not in the current batch, there isn't one to pull yet.`

function buildRoastCard(profile, tierLabel, variationText) {
    return (
        `${config.DIVIDER}\n` +
        `${config.BOT_EMOJI}  *Your Roast — ${tierLabel}*\n` +
        `${config.DIVIDER}\n\n` +
        `${profile.floor}\n\n` +
        `${variationText}\n\n` +
        `${config.DIVIDER}\n` +
        `_Screenshot this and drop it in the group if you dare_ 😁\n` +
        `_Sky Graphics — ${config.GAME_NAME}_`
    )
}

async function deliverRoast(sock, from, profile, tier, wantsAgain) {
    const variations = tier === 'savage' ? profile.savage : profile.nice
    const tierLabel   = tier === 'savage' ? 'Savage 🔥' : 'Nice 😊'

    let index = wantsAgain ? 1 : 0
    let note  = ''
    if (index >= variations.length) {
        index = variations.length - 1
        if (wantsAgain) note = `\n\n_(That's the only ${tier} one I've got for you right now 😅)_`
    }

    const card = buildRoastCard(profile, tierLabel, variations[index] + note)
    await sock.sendMessage(from, { text: card })
}

async function handlePublicMessage(msgCtx) {
    const {
        sock, nameCache, from, body, senderNumber, senderName
    } = msgCtx

    if (!body.startsWith(config.PREFIX)) return false

    // ── Bare "!roast" (or "!roast help") = explainer only, NEVER
    // stateful (ARCHITECTURE.md §9) — true even inside a DM. ──────
    const rest = body.slice(config.PREFIX.length).trim()
    const parts = rest.length ? rest.split(/\s+/) : []
    const subCmd = parts[0]

    if (!subCmd || subCmd === 'help') {
        await sock.sendMessage(from, { text: HELP_TEXT })
        return true
    }

    if (subCmd !== 'me' && subCmd !== 'savage') {
        await sock.sendMessage(from, { text: HELP_TEXT })
        return true
    }

    const wantsAgain = parts[1] === 'again'
    const tier = subCmd === 'me' ? 'nice' : 'savage'

    const profile = engine.resolveProfileForSender(senderNumber, senderName, nameCache)
    if (!profile) {
        await sock.sendMessage(from, { text: NO_PROFILE_TEXT })
        return true
    }

    await deliverRoast(sock, from, profile, tier, wantsAgain)
    return true
}

module.exports = { handlePublicMessage }
