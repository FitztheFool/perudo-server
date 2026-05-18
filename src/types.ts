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
    /** Becomes false once a bid is made on face=1 during the round (Pacos no longer wild). */
    pacosWild: boolean;
    /** Reveal payload for the round just resolved (cleared at next round). */
    lastReveal: RevealResult | null;
    /** Players eliminated this game (for final result). */
    eliminated: EliminatedPlayer[];
    afkStrikes: Record<string, number>;
    socketIds: Map<string, string>;
    disconnectTimers: Map<string, ReturnType<typeof setTimeout>>;
    turnStartedAt: number | null;
    turnDuration: number;
}

export interface EliminatedPlayer {
    userId: string;
    username: string;
    placement: number;
    afk?: boolean;
    abandon?: boolean;
}

export interface RevealResult {
    bid: Bid;
    actualCount: number;
    /** Userid of the player who lost a die (challenger if bid was true, bidder otherwise). */
    loserUserId: string;
    /** Userid of the player who called dudo. */
    challengerUserId: string;
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
}
