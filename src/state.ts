import type { Server } from 'socket.io';
import { PerudoRoom } from './types';
import { aliveCount } from './game';

interface PublicPlayer {
    userId: string;
    username: string;
    diceCount: number;
    alive: boolean;
    /** Dice are only included in this player's own view (or in reveal phase). */
    dice?: number[];
}

export function buildStateFor(room: PerudoRoom, viewerId: string | null) {
    const isReveal = room.phase === 'reveal' || room.phase === 'ended';
    const current = room.players[room.currentPlayerIndex];

    // Spectateur : vue Dieu (Perudo n'est pas un jeu de déduction) → voit tous les dés.
    const isSpectator = viewerId ? !room.players.some(p => p.userId === viewerId) : true;
    const players: PublicPlayer[] = room.players.map(p => {
        const showDice = isReveal || p.userId === viewerId || isSpectator;
        return {
            userId: p.userId,
            username: p.username,
            diceCount: p.dice.length,
            alive: p.alive,
            ...(showDice ? { dice: [...p.dice] } : {}),
        };
    });

    return {
        code: room.code,
        round: room.round,
        phase: room.phase,
        currentPlayerIndex: room.currentPlayerIndex,
        currentUserId: current?.userId ?? null,
        initialDice: room.initialDice,
        lastBid: room.lastBid,
        pacosWild: room.pacosWild,
        palifico: room.palifico,
        calzaEnabled: room.calzaEnabled,
        totalDice: room.players.reduce((s, p) => s + p.dice.length, 0),
        aliveCount: aliveCount(room),
        lastReveal: isReveal ? room.lastReveal : null,
        turnStartedAt: room.turnStartedAt,
        turnDuration: room.turnDuration,
        players,
        spectator: isSpectator,
        log: (room.log ?? []).slice(-100),
    };
}

export function emitState(io: Server, room: PerudoRoom): void {
    const sockets = io.sockets.adapter.rooms.get(room.code);
    if (!sockets) return;
    for (const sid of sockets) {
        const s = io.sockets.sockets.get(sid);
        if (!s) continue;
        const viewerId = (s.data?.userId as string | undefined) ?? null;
        s.emit('perudo:state', buildStateFor(room, viewerId));
    }
}
