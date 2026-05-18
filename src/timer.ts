import type { Server } from 'socket.io';
import { rooms } from './rooms';

export const TURN_DURATION = 60;

export interface TimerSlot {
    remaining: number;
    interval?: ReturnType<typeof setInterval>;
}

export const timers: Record<string, TimerSlot> = {};

/** Callback set by index.ts to be notified when the turn timer expires or changes. */
export const timerCallbacks: {
    onTimeout?: (code: string) => void;
    onTurnChange?: (code: string) => void;
} = {};

export function clearTimer(code: string): void {
    if (timers[code]?.interval) clearInterval(timers[code].interval);
    delete timers[code];
}

export function startTimer(io: Server, code: string): void {
    clearTimer(code);
    timers[code] = { remaining: TURN_DURATION };
    const room = rooms[code];
    if (room) room.turnStartedAt = Date.now();

    timers[code].interval = setInterval(() => {
        const slot = timers[code];
        if (!slot) return;
        slot.remaining--;
        io.to(code).emit('perudo:timer', { remaining: slot.remaining });

        const room = rooms[code];
        if (!room) { clearTimer(code); return; }

        const p = room.players[room.currentPlayerIndex];

        // AFK warning at 30s if player already has a strike.
        if (slot.remaining === 30 && (room.afkStrikes[p.userId] ?? 0) >= 1) {
            io.to(code).emit('perudo:afkWarning', {
                userId: p.userId,
                username: p.username,
                secondsLeft: 30,
            });
        }

        if (slot.remaining > 0) return;

        clearTimer(code);
        timerCallbacks.onTimeout?.(code);
    }, 1000);
}
