import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { setupSocketAuth, corsConfig, connectToLobby } from '@kwizar/shared';

import {
    rerollAll, isBidValid, countDice, aliveCount, hasHumanAlive, nextAliveIndex,
    findPlayer, findPlayerIndex, loseDie, totalAliveDice, DEFAULT_INITIAL_DICE,
} from './game';
import { rooms, createRoom } from './rooms';
import { startTimer, clearTimer, timerCallbacks } from './timer';
import { decideBotAction, isBot } from './bot';
import { savePerudoResults, pushEliminated } from './api';
import { emitState } from './state';
import { Bid, RevealResult } from './types';
import { pushLog } from './gameLog';

const faceLabel = (face: number) => face === 1 ? '1 (Paco)' : String(face);

dotenv.config();

const app = express();
app.get('/health', (_req, res) => { res.set('Access-Control-Allow-Origin', '*'); res.status(200).send('ok'); });

const server = http.createServer(app);
const io = new Server(server, { cors: corsConfig, maxHttpBufferSize: 1e5 });

setupSocketAuth(io, new TextEncoder().encode((process.env.SOCKET_USER_SECRET ?? process.env.INTERNAL_API_KEY)!));

const lobbySocket = connectToLobby('perudo-server', 'perudo');

// ── Configure from lobby ──────────────────────────────────────────────────────

lobbySocket.on('perudo:configure', ({ lobbyId: code, players, options }: {
    lobbyId: string;
    players: any[];
    options?: { initialDice?: number };
}, ack?: () => void) => {
    const initialDice = options?.initialDice ?? DEFAULT_INITIAL_DICE;
    const room = createRoom(code, players, initialDice);
    console.log(`[PERUDO] Room created: ${code} (${players.length} players, ${initialDice} dice)`);
    emitState(io, room);
    startTimer(io, code);
    setTimeout(() => botTakeTurnIfNeeded(code), 1000);
    if (typeof ack === 'function') ack();
});

// ── Bot turn handling ─────────────────────────────────────────────────────────

function botTakeTurnIfNeeded(code: string): void {
    const room = rooms[code];
    if (!room || room.phase !== 'bidding') return;
    const p = room.players[room.currentPlayerIndex];
    if (!p?.alive || !isBot(p.userId)) return;
    clearTimer(code);
    setTimeout(() => doBotAction(code), 900);
}

function doBotAction(code: string): void {
    const room = rooms[code];
    if (!room || room.phase !== 'bidding') return;
    const p = room.players[room.currentPlayerIndex];
    if (!p?.alive || !isBot(p.userId)) return;

    const decision = decideBotAction(room, p.userId);
    if (decision.type === 'dudo') {
        if (!room.lastBid) {
            // Cannot dudo without a previous bid — open instead.
            const opening = decideBotAction({ ...room, lastBid: null }, p.userId);
            if (opening.type === 'bid' && opening.bid) {
                applyBid(code, p.userId, opening.bid);
            }
            return;
        }
        applyDudo(code, p.userId);
    } else if (decision.bid) {
        applyBid(code, p.userId, decision.bid);
    }
}

// ── Game actions ──────────────────────────────────────────────────────────────

function applyBid(code: string, userId: string, raw: Bid): void {
    const room = rooms[code];
    if (!room || room.phase !== 'bidding') return;
    const p = room.players[room.currentPlayerIndex];
    if (!p?.alive || p.userId !== userId) return;

    const bid: Bid = {
        userId,
        count: Math.floor(Number(raw.count)),
        face: Math.floor(Number(raw.face)),
    };
    if (!isBidValid(room.lastBid, bid, room.pacosWild)) {
        console.log(`[PERUDO] Invalid bid by ${userId}:`, bid, 'against', room.lastBid);
        return;
    }
    // If someone bids on 1s while pacosWild, freeze pacos for the rest of the round.
    if (bid.face === 1 && room.pacosWild) {
        room.pacosWild = false;
    }
    room.lastBid = bid;
    room.afkStrikes[userId] = 0;
    pushLog(room, 'move', `${p.username} mise ${bid.count} × ${faceLabel(bid.face)}`);

    // Move to next alive player.
    room.currentPlayerIndex = nextAliveIndex(room, room.currentPlayerIndex);

    emitState(io, room);
    startTimer(io, code);
    setTimeout(() => botTakeTurnIfNeeded(code), 600);
}

function applyDudo(code: string, challengerUserId: string): void {
    const room = rooms[code];
    if (!room || room.phase !== 'bidding') return;
    if (!room.lastBid) return;
    const challenger = findPlayer(room, challengerUserId);
    if (!challenger?.alive) return;

    const bid = room.lastBid;
    const actualCount = countDice(room, bid.face, room.pacosWild);
    const bidValid = actualCount >= bid.count;
    const loserUserId = bidValid ? challengerUserId : bid.userId;

    const revealedDice = room.players
        .filter(p => p.alive)
        .map(p => ({ userId: p.userId, username: p.username, dice: [...p.dice] }));

    const reveal: RevealResult = {
        bid,
        actualCount,
        loserUserId,
        challengerUserId,
        revealedDice,
        pacosWild: room.pacosWild,
    };
    room.lastReveal = reveal;
    room.phase = 'reveal';
    room.afkStrikes[challengerUserId] = 0;
    const loserName = findPlayer(room, loserUserId)?.username ?? '?';
    pushLog(room, 'attack', `${challenger.username} conteste (Dudo) la mise de ${bid.count} × ${faceLabel(bid.face)}`);
    pushLog(room, bidValid ? 'defend' : 'coup',
        `Compte réel : ${actualCount} × ${faceLabel(bid.face)} — mise ${bidValid ? 'tenue' : 'fausse'}, ${loserName} perd un dé`);
    clearTimer(code);
    emitState(io, room);
    io.to(code).emit('perudo:roundResolved', reveal);

    // After a short delay, apply consequences and start next round (or end game).
    setTimeout(() => resolveAfterReveal(code, loserUserId), 4000);
}

function resolveAfterReveal(code: string, loserUserId: string): void {
    const room = rooms[code];
    if (!room) return;
    const loserIdxBefore = findPlayerIndex(room, loserUserId);
    const eliminated = loseDie(room, loserUserId);
    if (eliminated) {
        const aliveAfter = aliveCount(room);
        const loser = findPlayer(room, loserUserId);
        if (loser) {
            pushEliminated(room.eliminated, {
                userId: loser.userId,
                username: loser.username,
            }, aliveAfter);
            pushLog(room, 'coup', `${loser.username} est éliminé !`);
            io.to(code).emit('perudo:playerEliminated', { userId: loser.userId, username: loser.username });
        }
    }

    if (aliveCount(room) <= 1 || !hasHumanAlive(room)) {
        finishGame(code);
        return;
    }

    // Start next round: pick loser as next starter if still alive, else next alive.
    if (eliminated) {
        room.currentPlayerIndex = nextAliveIndex(room, loserIdxBefore);
    } else {
        room.currentPlayerIndex = findPlayerIndex(room, loserUserId);
    }
    room.round++;
    room.lastBid = null;
    room.pacosWild = true;
    room.lastReveal = null;
    room.phase = 'bidding';
    rerollAll(room);
    pushLog(room, 'system', `Manche ${room.round} — nouveaux dés`);

    emitState(io, room);
    startTimer(io, code);
    setTimeout(() => botTakeTurnIfNeeded(code), 1000);
}

function finishGame(code: string): void {
    const room = rooms[code];
    if (!room) return;
    clearTimer(code);
    room.phase = 'ended';
    const winnerPlayer = room.players.find(p => p.alive);
    const winner = winnerPlayer ? { userId: winnerPlayer.userId, username: winnerPlayer.username } : null;
    if (winner) pushLog(room, 'coup', `${winner.username} remporte la partie !`);
    const gameId = crypto.randomUUID();
    emitState(io, room);
    io.to(code).emit('perudo:finished', {
        winner,
        eliminated: room.eliminated,
        gameId,
    });
    savePerudoResults(room, winner, gameId);
    delete rooms[code];
}

// ── Timer callbacks ───────────────────────────────────────────────────────────

timerCallbacks.onTimeout = (code: string) => {
    const room = rooms[code];
    if (!room || room.phase !== 'bidding') return;
    const p = room.players[room.currentPlayerIndex];
    if (!p?.alive) return;

    // Bots shouldn't time out (they auto-play), but if they do, just take their turn.
    if (isBot(p.userId)) { botTakeTurnIfNeeded(code); return; }

    // Kick the AFK human immediately.
    const idxBefore = room.currentPlayerIndex;
    const username = p.username;
    const userId = p.userId;
    const aliveAfter = aliveCount(room) - 1;
    pushEliminated(room.eliminated, { userId, username, afk: true }, aliveAfter);
    p.alive = false;
    p.dice = [];

    io.to(code).emit('perudo:playerKicked', { userId, username, reason: 'inactivity' });

    if (aliveCount(room) <= 1 || !hasHumanAlive(room)) { finishGame(code); return; }
    room.currentPlayerIndex = nextAliveIndex(room, idxBefore);
    emitState(io, room);
    startTimer(io, code);
    setTimeout(() => botTakeTurnIfNeeded(code), 800);
};

// ── Socket events from clients ────────────────────────────────────────────────

io.on('connection', (socket) => {
    console.log('[PERUDO] connexion', socket.id);

    socket.on('perudo:join', ({ lobbyId: code }: { lobbyId: string }) => {
        const userId = socket.data?.userId as string;
        const room = rooms[code];
        if (!room) { socket.emit('notFound'); return; }
        const isMember = !!userId && room.players.some(p => p.userId === userId);
        if (!isMember) { socket.emit('perudo:accessDenied'); return; }

        socket.data.lobbyId = code;
        socket.join(code);
        room.socketIds.set(userId, socket.id);
        const timer = room.disconnectTimers.get(userId);
        if (timer) {
            clearTimeout(timer);
            room.disconnectTimers.delete(userId);
            io.to(code).emit('perudo:playerReconnected', { userId });
        }
        socket.emit('perudo:state', { code: room.code, phase: room.phase, currentPlayerIndex: room.currentPlayerIndex }); // quick ping
        emitState(io, room);
    });

    socket.on('perudo:bid', ({ lobbyId: code, count, face }: { lobbyId: string; count: number; face: number }) => {
        const userId = socket.data?.userId as string;
        if (!userId) return;
        applyBid(code, userId, { userId, count, face });
    });

    socket.on('perudo:dudo', ({ lobbyId: code }: { lobbyId: string }) => {
        const userId = socket.data?.userId as string;
        if (!userId) return;
        applyDudo(code, userId);
    });

    socket.on('perudo:surrender', ({ lobbyId: code }: { lobbyId: string }) => {
        const userId = socket.data?.userId as string;
        const room = rooms[code];
        if (!room || !userId) return;
        if (room.phase === 'ended') return;
        const p = findPlayer(room, userId);
        if (!p?.alive) return;

        const idxBefore = findPlayerIndex(room, userId);
        const aliveAfter = aliveCount(room) - 1;
        pushEliminated(room.eliminated, { userId, username: p.username, abandon: true }, aliveAfter);
        pushLog(room, 'system', `${p.username} abandonne la partie`);
        p.alive = false;
        p.dice = [];

        io.to(code).emit('perudo:playerSurrendered', { userId, username: p.username });

        if (aliveCount(room) <= 1 || !hasHumanAlive(room)) { finishGame(code); return; }

        // If the surrenderer was the current player, advance turn.
        if (idxBefore === room.currentPlayerIndex) {
            room.currentPlayerIndex = nextAliveIndex(room, idxBefore);
            clearTimer(code);
            emitState(io, room);
            startTimer(io, code);
            setTimeout(() => botTakeTurnIfNeeded(code), 600);
        } else {
            emitState(io, room);
        }
    });

    socket.on('disconnect', () => {
        const userId = socket.data?.userId as string;
        const code = socket.data?.lobbyId as string;
        if (!userId || !code) return;
        const room = rooms[code];
        if (!room || room.phase === 'ended') return;
        const player = findPlayer(room, userId);
        if (!player?.alive) return;

        room.socketIds.delete(userId);
        io.to(code).emit('perudo:inactivityWarning', { userId, username: player.username, secondsLeft: 60 });
        room.disconnectTimers.set(userId, setTimeout(() => {
            const r = rooms[code];
            if (!r || r.phase === 'ended') return;
            const pl = findPlayer(r, userId);
            if (!pl?.alive) return;
            const idxBefore = findPlayerIndex(r, userId);
            const aliveAfter = aliveCount(r) - 1;
            pushEliminated(r.eliminated, { userId, username: pl.username, afk: true }, aliveAfter);
            pl.alive = false;
            pl.dice = [];
            io.to(code).emit('perudo:playerKicked', { userId, username: pl.username, reason: 'inactivity' });
            if (aliveCount(r) <= 1 || !hasHumanAlive(r)) { finishGame(code); return; }
            if (idxBefore === r.currentPlayerIndex) {
                r.currentPlayerIndex = nextAliveIndex(r, idxBefore);
                clearTimer(code);
                emitState(io, r);
                startTimer(io, code);
                setTimeout(() => botTakeTurnIfNeeded(code), 600);
            } else {
                emitState(io, r);
            }
        }, 60_000));
    });
});

// ── Startup ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 10012;
server.listen(PORT, () => console.log('[PERUDO] listening on port', PORT));

const shutdown = () => {
    io.close(() => {
        server.close(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 3000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Suppress unused warnings (helpers exported for completeness)
void totalAliveDice;
