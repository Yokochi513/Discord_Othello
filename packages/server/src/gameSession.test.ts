import type { Participant, Square } from "@othello/protocol";
import { describe, expect, it } from "vitest";

import {
    createSession,
    GameStore,
    isFinished,
    playSessionMove,
    seatOf,
    toGameView,
    type GameSession,
} from "./gameSession.ts";
import { createLobby, type LobbyState } from "./lobby.ts";

/**
 * 最短で終局する対局（黒の完封勝ち）。E-04 と再開の検証に使う。
 * 黒から交互に打ち、9 手目で白の石が 0 枚になる。
 */
const SHUTOUT_GAME: readonly Square[] = ["e6", "f4", "e3", "f6", "g5", "d6", "e7", "f5", "c5"];

function participant(userId: string): Participant {
    return { userId, displayName: `${userId}の表示名` };
}

const BLACK = participant("user-1");
const WHITE = participant("user-2");

function session(): GameSession {
    return createSession("game-1", { black: BLACK, white: WHITE });
}

function lobbyWith(seats: LobbyState["seats"]): LobbyState {
    return { ...createLobby("room-a"), seats };
}

// 黒白が交互に打つ棋譜を最後まで適用する
function playAll(start: GameSession, squares: readonly Square[]): GameSession {
    let current = start;
    squares.forEach((square, index) => {
        const result = playSessionMove(
            current,
            index % 2 === 0 ? BLACK.userId : WHITE.userId,
            square,
        );
        if (!result.ok) throw new Error(`着手が拒否されました: ${square} (${result.code})`);
        current = result.session;
    });
    return current;
}

describe("createSession", () => {
    it("初期盤面・黒番・手数 0 の対局を作る", () => {
        expect(toGameView(session())).toMatchObject({
            id: "game-1",
            turn: "black",
            scores: { black: 2, white: 2 },
            moveCount: 0,
            lastMove: null,
            players: { black: BLACK, white: WHITE },
        });
    });
});

describe("seatOf", () => {
    it("対局者の色を返す", () => {
        expect(seatOf(session(), BLACK.userId)).toBe("black");
        expect(seatOf(session(), WHITE.userId)).toBe("white");
    });

    it("対局していないユーザーには null を返す", () => {
        expect(seatOf(session(), "user-3")).toBeNull();
    });
});

describe("playSessionMove", () => {
    it("合法手を適用し、盤面・手番・石数・手数・直前の手を更新する", () => {
        const result = playSessionMove(session(), BLACK.userId, "d3");

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(toGameView(result.session)).toMatchObject({
            turn: "white",
            scores: { black: 4, white: 1 },
            moveCount: 1,
            lastMove: "d3",
        });
    });

    it("E-01: 手番でない側の着手を拒否する", () => {
        expect(playSessionMove(session(), WHITE.userId, "d3")).toEqual({
            ok: false,
            code: "invalid_state",
            message: "手番ではありません",
        });
    });

    it("E-02: 非合法手を拒否する", () => {
        expect(playSessionMove(session(), BLACK.userId, "a1")).toEqual({
            ok: false,
            code: "illegal_move",
            message: "そのマスには打てません",
        });
    });

    it("E-03: 観戦者の着手を拒否する", () => {
        expect(playSessionMove(session(), "user-3", "d3")).toEqual({
            ok: false,
            code: "unauthorized",
            message: "観戦者は着手できません",
        });
    });

    it("E-04: 終局した対局への着手を拒否する", () => {
        const finished = playAll(session(), SHUTOUT_GAME);

        expect(isFinished(finished)).toBe(true);
        expect(playSessionMove(finished, BLACK.userId, "d3")).toEqual({
            ok: false,
            code: "invalid_state",
            message: "対局は既に終了しています",
        });
    });

    it("拒否しても元の対局状態を変えない", () => {
        const before = session();

        playSessionMove(before, BLACK.userId, "a1");

        expect(toGameView(before)).toMatchObject({ moveCount: 0, lastMove: null });
    });
});

describe("GameStore", () => {
    const bothSeats = lobbyWith({ black: BLACK, white: WHITE });

    function store(): GameStore {
        let count = 0;
        return new GameStore(() => `game-${++count}`);
    }

    it("両席が埋まっていれば対局を生成する", () => {
        const games = store();

        const result = games.start("room-a", bothSeats, BLACK.userId);

        expect(result).toMatchObject({ ok: true, session: { id: "game-1" } });
        expect(games.get("room-a")?.players).toEqual({ black: BLACK, white: WHITE });
    });

    it("空席がある状態の開始を拒否する", () => {
        const games = store();

        expect(
            games.start("room-a", lobbyWith({ black: BLACK, white: null }), BLACK.userId),
        ).toEqual({
            ok: false,
            code: "invalid_state",
            message: "両席が埋まるまで対局を開始できません",
        });
        expect(games.get("room-a")).toBeNull();
    });

    it("観戦者からの開始要求を拒否する", () => {
        const games = store();

        expect(games.start("room-a", bothSeats, "user-3")).toEqual({
            ok: false,
            code: "unauthorized",
            message: "対局者だけが開始できます",
        });
    });

    it("進行中の対局があるうちは新しい対局を始めない", () => {
        const games = store();
        games.start("room-a", bothSeats, BLACK.userId);

        expect(games.start("room-a", bothSeats, BLACK.userId)).toEqual({
            ok: false,
            code: "invalid_state",
            message: "対局が既に進行中です",
        });
        expect(games.get("room-a")?.id).toBe("game-1");
    });

    it("終局後は新しい対局を始められる", () => {
        const games = store();
        games.start("room-a", bothSeats, BLACK.userId);
        SHUTOUT_GAME.forEach((square, index) => {
            const userId = index % 2 === 0 ? BLACK.userId : WHITE.userId;
            expect(games.play("room-a", "game-1", userId, square)).toMatchObject({ ok: true });
        });

        expect(games.start("room-a", bothSeats, WHITE.userId)).toMatchObject({
            ok: true,
            session: { id: "game-2" },
        });
    });

    it("E-05: 対局IDが一致しない着手を拒否する", () => {
        const games = store();
        games.start("room-a", bothSeats, BLACK.userId);

        expect(games.play("room-a", "game-9", BLACK.userId, "d3")).toEqual({
            ok: false,
            code: "game_not_found",
            message: "対局が見つかりません",
        });
    });

    it("対局していないインスタンスへの着手を拒否する", () => {
        expect(store().play("room-a", "game-1", BLACK.userId, "d3")).toEqual({
            ok: false,
            code: "game_not_found",
            message: "対局が見つかりません",
        });
    });

    it("受理した着手だけを保持中の対局へ反映する", () => {
        const games = store();
        games.start("room-a", bothSeats, BLACK.userId);

        games.play("room-a", "game-1", BLACK.userId, "d3");
        games.play("room-a", "game-1", BLACK.userId, "c3");

        expect(games.get("room-a")?.lastMove).toBe("d3");
        expect(games.get("room-a")?.state.moveCount).toBe(1);
    });

    it("インスタンスごとに対局を分けて保持する（同時対局）", () => {
        const games = store();
        games.start("room-a", bothSeats, BLACK.userId);
        games.start("room-b", bothSeats, BLACK.userId);
        games.start("room-c", bothSeats, BLACK.userId);

        games.play("room-b", "game-2", BLACK.userId, "d3");

        expect(games.get("room-a")?.state.moveCount).toBe(0);
        expect(games.get("room-b")?.state.moveCount).toBe(1);
        expect(games.get("room-c")?.state.moveCount).toBe(0);
        expect(games.isCurrentGame("room-c", "game-2")).toBe(false);
    });

    it("対局を破棄する", () => {
        const games = store();
        games.start("room-a", bothSeats, BLACK.userId);

        games.delete("room-a");

        expect(games.get("room-a")).toBeNull();
    });
});
