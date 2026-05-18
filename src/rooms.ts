import { PerudoRoom, ConfiguredPlayer } from './types';
import { createPlayer, DEFAULT_INITIAL_DICE, MIN_INITIAL_DICE, MAX_INITIAL_DICE } from './game';
import { TURN_DURATION } from './timer';

export const rooms: Record<string, PerudoRoom> = {};

export function createRoom(code: string, players: ConfiguredPlayer[], initialDice?: number): PerudoRoom {
    const dice = clampDice(initialDice ?? DEFAULT_INITIAL_DICE);
    rooms[code] = {
        code,
        players: players.map(p => createPlayer(p, dice)),
        currentPlayerIndex: Math.floor(Math.random() * players.length),
        round: 1,
        phase: 'bidding',
        initialDice: dice,
        lastBid: null,
        pacosWild: true,
        lastReveal: null,
        eliminated: [],
        afkStrikes: {},
        socketIds: new Map(),
        disconnectTimers: new Map(),
        turnStartedAt: null,
        turnDuration: TURN_DURATION,
    };
    return rooms[code];
}

function clampDice(v: number): number {
    if (v < MIN_INITIAL_DICE) return MIN_INITIAL_DICE;
    if (v > MAX_INITIAL_DICE) return MAX_INITIAL_DICE;
    return Math.floor(v);
}
