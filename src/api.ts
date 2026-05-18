import { saveAttempts, ScoreEntry } from '@kwizar/shared';
import { EliminatedPlayer, PerudoRoom } from './types';

export interface PerudoResultEntry {
    userId: string;
    username: string;
    placement: number | null;
    abandon: boolean;
    afk: boolean;
}

export function savePerudoResults(
    room: PerudoRoom,
    winner: { userId: string; username: string } | null,
    gameId: string,
): void {
    const vsBot = room.players.some(p => p.userId.startsWith('bot-')) ||
        room.eliminated.some(p => p.userId.startsWith('bot-'));

    // Reconstruct full participant list: winner + eliminated.
    const entries: PerudoResultEntry[] = [];
    if (winner) {
        entries.push({
            userId: winner.userId,
            username: winner.username,
            placement: 1,
            abandon: false,
            afk: false,
        });
    }
    // Eliminated already have placement assigned at elimination time (highest = first kicked).
    for (const e of room.eliminated) {
        entries.push({
            userId: e.userId,
            username: e.username,
            placement: e.afk || e.abandon ? null : e.placement,
            abandon: e.abandon ?? false,
            afk: e.afk ?? false,
        });
    }

    // Score = 1 for the winner, 0 for everyone else (consistent with elimination-style games).
    const scores: ScoreEntry[] = entries.map(e => ({
        userId: e.userId,
        username: e.username,
        score: e.placement === 1 ? 1 : 0,
        placement: e.placement,
        abandon: e.abandon,
        afk: e.afk,
    }));

    saveAttempts('PERUDO', gameId, scores, vsBot);
}

export function pushEliminated(
    list: EliminatedPlayer[],
    entry: Omit<EliminatedPlayer, 'placement'> & { placement?: number },
    aliveAfter: number,
): void {
    // placement = 1 + aliveAfter (1 = winner, the higher the worse the rank)
    list.push({ ...entry, placement: entry.placement ?? aliveAfter + 1 });
}
