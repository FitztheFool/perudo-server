import type { GameLogEntry } from './gameLog';

export interface PerudoPlayer {
    userId: string;
    username: string;
    dice: number[];
    alive: boolean;
}

export type Phase = 'rolling' | 'bidding' | 'reveal' | 'ended';

export interface Bid {
    userId: string;
    count: number;
    face: number; // 1..6
}

export interface PerudoRoom {
    code: string;
    players: PerudoPlayer[];
    currentPlayerIndex: number;
    round: number;
    phase: Phase;
    initialDice: number;
    lastBid: Bid | null;
    /** True for normal rounds (1s wild). False only during a palifico round. */
    pacosWild: boolean;
    /** Palifico round: 1s not wild + face locked. Set when a player drops to exactly 1 die. */
    palifico: boolean;
    /** Calza variant enabled for this room (lobby option). */
    calzaEnabled: boolean;
    /** Reveal payload for the round just resolved (cleared at next round). */
    lastReveal: RevealResult | null;
    /** Players eliminated this game (for final result). */
    eliminated: EliminatedPlayer[];
    afkStrikes: Record<string, number>;
    socketIds: Map<string, string>;
    disconnectTimers: Map<string, ReturnType<typeof setTimeout>>;
    turnStartedAt: number | null;
    turnDuration: number;
    log: GameLogEntry[];
    logSeq?: number;
}

export interface EliminatedPlayer {
    userId: string;
    username: string;
    placement: number;
    afk?: boolean;
    abandon?: boolean;
}

export interface RevealResult {
    /** How the round ended. */
    kind: 'dudo' | 'calza';
    bid: Bid;
    actualCount: number;
    /** Userid of the player who lost a die. Empty string if nobody lost (calza exact). */
    loserUserId: string;
    /** Userid of the player who triggered the reveal (called dudo or calza). */
    challengerUserId: string;
    /** Calza only: whether the bid count was exactly right (challenger gains a die). */
    calzaExact?: boolean;
    /** Dice of every alive player at reveal time. */
    revealedDice: { userId: string; username: string; dice: number[] }[];
    /** Whether 1s counted as wild this round. */
    pacosWild: boolean;
}

export interface ConfiguredPlayer {
    userId?: string;
    id?: string;
    username?: string;
    name?: string;
}

export interface PerudoOptions {
    initialDice: number; // 3..6
    calza?: boolean;     // variante Calza (défaut: désactivée)
}
