import { PerudoPlayer, PerudoRoom, Bid, ConfiguredPlayer } from './types';

export const MIN_INITIAL_DICE = 3;
export const MAX_INITIAL_DICE = 6;
export const DEFAULT_INITIAL_DICE = 5;

export function createPlayer(raw: ConfiguredPlayer, initialDice: number): PerudoPlayer {
    return {
        userId: raw.userId ?? raw.id ?? '',
        username: raw.username ?? raw.name ?? 'Joueur',
        dice: rollNewDice(initialDice),
        alive: true,
    };
}

export function rollNewDice(count: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(1 + Math.floor(Math.random() * 6));
    return out;
}

/** Re-roll all dice for alive players. */
export function rerollAll(room: PerudoRoom): void {
    for (const p of room.players) {
        if (p.alive) p.dice = rollNewDice(p.dice.length);
    }
}

/**
 * Validate a bid against the previous one.
 *  - Normal round: 1s (Paco) are wild ALL round. You can't OPEN on Paco. Raises:
 *      * same face → count strictly higher ;
 *      * higher face → count >= prev ;
 *      * switch TO Paco (1) → count >= ceil(C/2) ;
 *      * switch FROM Paco to a face → count >= 2C + 1.
 *  - Palifico round: Paco are NOT wild and the face is LOCKED — only the count may rise
 *    (the palifico player opens on the face of their choice).
 */
export function isBidValid(prev: Bid | null, next: Bid, palifico = false): boolean {
    if (next.count < 1) return false;
    if (next.face < 1 || next.face > 6) return false;

    if (palifico) {
        if (!prev) return true;                                      // ouverture libre du joueur palifico
        return next.face === prev.face && next.count > prev.count;   // valeur verrouillée, on ne monte que le nombre
    }

    if (!prev) return next.face !== 1;                               // interdit d'ouvrir une manche sur les Paco (1)

    if (prev.face !== 1 && next.face !== 1) {
        if (next.face === prev.face) return next.count > prev.count;
        if (next.face > prev.face) return next.count >= prev.count;
        return false;
    }
    if (prev.face !== 1 && next.face === 1) {
        return next.count >= Math.ceil(prev.count / 2);
    }
    if (prev.face === 1 && next.face === 1) {
        return next.count > prev.count;
    }
    // prev.face === 1 && next.face !== 1
    return next.count >= 2 * prev.count + 1;
}

/** Count dice matching `face` across all alive players. 1s count if pacosWild and face !== 1. */
export function countDice(room: PerudoRoom, face: number, pacosWild: boolean): number {
    let total = 0;
    for (const p of room.players) {
        if (!p.alive) continue;
        for (const d of p.dice) {
            if (d === face) total++;
            else if (pacosWild && face !== 1 && d === 1) total++;
        }
    }
    return total;
}

/** Total dice across all alive players. */
export function totalAliveDice(room: PerudoRoom): number {
    return room.players.reduce((sum, p) => sum + (p.alive ? p.dice.length : 0), 0);
}

export function aliveCount(room: PerudoRoom): number {
    return room.players.reduce((n, p) => n + (p.alive ? 1 : 0), 0);
}

export function hasHumanAlive(room: PerudoRoom): boolean {
    return room.players.some(p => p.alive && !p.userId.startsWith('bot-'));
}

export function nextAliveIndex(room: PerudoRoom, fromIndex: number): number {
    const len = room.players.length;
    for (let i = 1; i <= len; i++) {
        const idx = (fromIndex + i) % len;
        if (room.players[idx].alive) return idx;
    }
    return fromIndex;
}

export function findPlayer(room: PerudoRoom, userId: string): PerudoPlayer | undefined {
    return room.players.find(p => p.userId === userId);
}

export function findPlayerIndex(room: PerudoRoom, userId: string): number {
    return room.players.findIndex(p => p.userId === userId);
}

/** Give a player one die back (Calza réussi), capped at the initial dice count. Returns true if gained. */
export function gainDie(room: PerudoRoom, userId: string, cap: number): boolean {
    const p = findPlayer(room, userId);
    if (!p || !p.alive) return false;
    if (p.dice.length >= cap) return false;
    p.dice = [...p.dice, 1 + Math.floor(Math.random() * 6)];
    return true;
}

/** Reduce a player's dice by 1. Marks them dead if they reach 0. Returns true if eliminated. */
export function loseDie(room: PerudoRoom, userId: string): boolean {
    const p = findPlayer(room, userId);
    if (!p) return false;
    if (p.dice.length > 0) p.dice = p.dice.slice(0, -1);
    if (p.dice.length === 0) {
        p.alive = false;
        return true;
    }
    return false;
}
