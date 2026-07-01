import { PerudoRoom, Bid } from './types';
import { isBidValid, totalAliveDice } from './game';

const BOT_PREFIX = 'bot-';

export function isBot(userId: string): boolean {
    return userId.startsWith(BOT_PREFIX);
}

/**
 * Estimate the probability that at least `count` dice of `face` exist across all unseen dice,
 * given what's in the bot's hand. Used to decide whether to call dudo.
 */
function probabilityAtLeast(targetCount: number, unseenDice: number, p: number): number {
    if (targetCount <= 0) return 1;
    if (unseenDice <= 0) return 0;
    // Binomial tail P(X >= targetCount) where X ~ Bin(unseenDice, p)
    // Sum from k=targetCount to unseenDice
    let total = 0;
    for (let k = targetCount; k <= unseenDice; k++) {
        total += binomial(unseenDice, k) * Math.pow(p, k) * Math.pow(1 - p, unseenDice - k);
    }
    return total;
}

function binomial(n: number, k: number): number {
    if (k < 0 || k > n) return 0;
    if (k === 0 || k === n) return 1;
    k = Math.min(k, n - k);
    let result = 1;
    for (let i = 0; i < k; i++) {
        result = (result * (n - i)) / (i + 1);
    }
    return result;
}

/**
 * Decide bot action given current state.
 * Returns either { type: 'dudo' } or { type: 'bid', bid: { count, face } }.
 */
export interface BotDecision {
    type: 'dudo' | 'bid';
    bid?: Bid;
}

export function decideBotAction(room: PerudoRoom, botUserId: string): BotDecision {
    const bot = room.players.find(p => p.userId === botUserId);
    if (!bot) return makeOpeningBid(room, botUserId);

    const total = totalAliveDice(room);
    const myDice = bot.dice;

    if (!room.lastBid) {
        return makeOpeningBid(room, botUserId);
    }

    const { count, face } = room.lastBid;
    // Count what we already have for the bid face (1s count if pacosWild and face !== 1).
    const ownMatching = myDice.filter(d => d === face || (room.pacosWild && face !== 1 && d === 1)).length;
    const needFromOthers = Math.max(0, count - ownMatching);
    const othersDice = total - myDice.length;
    // Probability of one foreign die matching: 1/6 (specific face) + 1/6 (wild 1) if pacosWild and face !== 1
    const p = room.pacosWild && face !== 1 ? 2 / 6 : 1 / 6;
    const probTrue = probabilityAtLeast(needFromOthers, othersDice, p);

    // Thresholds (tunable):
    const DUDO_THRESHOLD = 0.35; // if P(bid is true) < 35%, call dudo

    if (probTrue < DUDO_THRESHOLD) {
        return { type: 'dudo' };
    }

    // Otherwise make the minimal valid raise.
    const next = computeMinimalRaise(room, ownMatching);
    if (!next) return { type: 'dudo' };
    return { type: 'bid', bid: next };
}

function makeOpeningBid(room: PerudoRoom, botUserId: string): BotDecision {
    const bot = room.players.find(p => p.userId === botUserId);
    if (!bot) return { type: 'bid', bid: { userId: botUserId, count: 1, face: 2 } };
    // Pick the most frequent face in own dice (excluding 1s if not wild for that face).
    const counts = [0, 0, 0, 0, 0, 0];
    for (const d of bot.dice) counts[d - 1]++;
    let bestFace = 2;
    let bestCount = 0;
    for (let f = 2; f <= 6; f++) {
        const c = counts[f - 1] + (room.pacosWild ? counts[0] : 0);
        if (c > bestCount) { bestCount = c; bestFace = f; }
    }
    // Open with a bid slightly below total expected count.
    const total = totalAliveDice(room);
    const openCount = Math.max(1, Math.ceil(total * (room.pacosWild ? 2 / 6 : 1 / 6)));
    return { type: 'bid', bid: { userId: botUserId, count: openCount, face: bestFace } };
}

function computeMinimalRaise(room: PerudoRoom, ownMatching: number): Bid | null {
    if (!room.lastBid) return null;
    const prev = room.lastBid;
    const total = totalAliveDice(room);
    // Try minimal increments in a sensible order.
    const candidates: Bid[] = [];
    // Same face, +1
    candidates.push({ userId: '', count: prev.count + 1, face: prev.face });
    // Higher face, same or +1 count
    for (let f = prev.face + 1; f <= 6; f++) {
        candidates.push({ userId: '', count: prev.count, face: f });
        candidates.push({ userId: '', count: prev.count + 1, face: f });
    }
    if (room.pacosWild && prev.face !== 1) {
        // Switch to 1s
        candidates.push({ userId: '', count: Math.ceil(prev.count / 2), face: 1 });
    }
    if (room.pacosWild && prev.face === 1) {
        // Switch from 1s back to non-1
        for (let f = 2; f <= 6; f++) {
            candidates.push({ userId: '', count: 2 * prev.count + 1, face: f });
        }
    }
    // Filter to valid bids that are believable (count <= total).
    const valid = candidates.filter(b => b.count <= total && isBidValid(prev, b, room.palifico));
    if (valid.length === 0) return null;
    // Sort by "credibility" — prefer faces close to our own dice.
    valid.sort((a, b) => {
        const matchA = (a.face === 1 ? 1 : 0) + (ownMatching > 0 ? (a.face) : 0);
        const matchB = (b.face === 1 ? 1 : 0) + (ownMatching > 0 ? (b.face) : 0);
        return matchB - matchA;
    });
    return valid[0];
}
