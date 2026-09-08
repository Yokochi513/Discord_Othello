import type { Participant, Square } from "@othello/protocol";
import { describe, expect, it } from "vitest";

import {
    abandonSession,
    abortSession,
    createSession,
    GameStore,
    isFinished,
    playSessionMove,
    resignSession,
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

/** 8 手目（白の c1）で黒の合法手が無くなり、黒の自動パスが起きる棋譜。 */
const PASS_GAME: readonly Square[] = ["d3", "c3", "e6", "d2", "d1", "e1", "b2", "c1"];

/** 盤面に空マスを残したまま両者が続けてパスし、連続パスで終局する棋譜（黒 20 対 白 8）。 */
const BOTH_PASSED_GAME: readonly Square[] = [
    "f5",
    "d6",
    "c4",
    "b3",
    "b4",
    "b5",
    "a4",
    "g5",
    "c2",
    "d3",
    "g6",
    "e2",
    "c5",
    "c6",
    "g4",
    "b1",
    "a5",
    "h7",
    "e3",
    "h3",
    "c7",
    "h5",
    "f1",
    "d1",
];

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

// 棋譜を最後まで適用する。着手する側は手番から決めるため、自動パスを挟んでも進められる
function playAll(start: GameSession, squares: readonly Square[]): GameSession {
    let current = start;
    for (const square of squares) {
        const userId = current.state.turn === "black" ? BLACK.userId : WHITE.userId;
        const result = playSessionMove(current, userId, square);
        if (!result.ok) throw new Error(`着手が拒否されました: ${square} (${result.code})`);
        current = result.session;
    }
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

    it("F-09: 合法手が無い側を自動でパスし、パスした側を返す", () => {
        const beforePass = playAll(session(), PASS_GAME.slice(0, -1));

        const result = playSessionMove(beforePass, WHITE.userId, "c1");

        expect(result).toMatchObject({ ok: true, passedBy: ["black"] });
        if (!result.ok) return;
        // 黒が打てないため手番は白へ戻る。パスも 1 手として数える
        expect(toGameView(result.session)).toMatchObject({
            turn: "white",
            moveCount: 9,
            result: null,
        });
    });

    it("パスが起きなければ passedBy は空になる", () => {
        const result = playSessionMove(session(), BLACK.userId, "d3");

        expect(result).toMatchObject({ ok: true, passedBy: [] });
    });

    it("F-10: 完封で終局し、理由と勝敗を確定する", () => {
        const finished = playAll(session(), SHUTOUT_GAME);

        expect(finished.result).toEqual({ reason: "shutout", outcome: "black_win" });
        expect(toGameView(finished)).toMatchObject({
            turn: null,
            scores: { black: 13, white: 0 },
        });
    });

    it("F-10: 両者の連続パスで終局し、石数の多い側の勝ちとする", () => {
        const finished = playAll(session(), BOTH_PASSED_GAME);

        expect(finished.result).toEqual({ reason: "both_passed", outcome: "black_win" });
        expect(toGameView(finished)).toMatchObject({
            turn: null,
            scores: { black: 20, white: 8 },
        });
    });

    it("拒否しても元の対局状態を変えない", () => {
        const before = session();

        playSessionMove(before, BLACK.userId, "a1");

        expect(toGameView(before)).toMatchObject({ moveCount: 0, lastMove: null });
    });
});

describe("resignSession", () => {
    it("F-11: 投了した側の負けとし、石数は投了時点の値を残す", () => {
        const played = playAll(session(), ["d3"]);

        const result = resignSession(played, WHITE.userId);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.session.result).toEqual({ reason: "resign", outcome: "black_win" });
        expect(isFinished(result.session)).toBe(true);
        expect(toGameView(result.session)).toMatchObject({
            turn: null,
            scores: { black: 4, white: 1 },
            moveCount: 1,
        });
    });

    it("手番でない側からの投了も受理する", () => {
        const result = resignSession(session(), WHITE.userId);

        expect(result).toMatchObject({ ok: true });
        if (!result.ok) return;
        expect(result.session.result).toEqual({ reason: "resign", outcome: "black_win" });
    });

    it("観戦者の投了を拒否する", () => {
        expect(resignSession(session(), "user-3")).toEqual({
            ok: false,
            code: "unauthorized",
            message: "観戦者は投了できません",
        });
    });

    it("終了した対局への投了を拒否する", () => {
        expect(resignSession(playAll(session(), SHUTOUT_GAME), BLACK.userId)).toEqual({
            ok: false,
            code: "invalid_state",
            message: "対局は既に終了しています",
        });
    });
});

describe("abortSession", () => {
    it("F-12: 中断を無効試合として扱い、勝敗を付けない", () => {
        const result = abortSession(playAll(session(), ["d3"]), WHITE.userId);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.session.result).toEqual({ reason: "abort", outcome: null });
        expect(isFinished(result.session)).toBe(true);
        expect(toGameView(result.session).turn).toBeNull();
    });

    it("観戦者の中断を拒否する", () => {
        expect(abortSession(session(), "user-3")).toEqual({
            ok: false,
            code: "unauthorized",
            message: "観戦者は中断できません",
        });
    });

    it("終了した対局の中断を拒否する", () => {
        const resigned = resignSession(session(), BLACK.userId);
        if (!resigned.ok) throw new Error("投了が拒否されました");

        expect(abortSession(resigned.session, WHITE.userId)).toEqual({
            ok: false,
            code: "invalid_state",
            message: "対局は既に終了しています",
        });
    });
});

describe("abandonSession", () => {
    it("E-09: 対局者の離脱を無効試合として終える", () => {
        const abandoned = abandonSession(session(), BLACK.userId);

        expect(abandoned?.result).toEqual({ reason: "disconnect", outcome: null });
    });

    it("観戦者の離脱では対局を終えない", () => {
        expect(abandonSession(session(), "user-3")).toBeNull();
    });

    it("終了した対局では何もしない", () => {
        expect(abandonSession(playAll(session(), SHUTOUT_GAME), BLACK.userId)).toBeNull();
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

    it("投了を受理して保持中の対局へ反映する", () => {
        const games = store();
        games.start("room-a", bothSeats, BLACK.userId);

        expect(games.resign("room-a", "game-1", WHITE.userId)).toMatchObject({ ok: true });

        expect(games.get("room-a")?.result).toEqual({ reason: "resign", outcome: "black_win" });
    });

    it("投了で終わった対局のあとは新しい対局を始められる", () => {
        const games = store();
        games.start("room-a", bothSeats, BLACK.userId);
        games.resign("room-a", "game-1", BLACK.userId);

        expect(games.start("room-a", bothSeats, WHITE.userId)).toMatchObject({
            ok: true,
            session: { id: "game-2" },
        });
    });

    it("F-12: 中断した対局は破棄して保持しない", () => {
        const games = store();
        games.start("room-a", bothSeats, BLACK.userId);

        const result = games.abort("room-a", "game-1", BLACK.userId);

        expect(result).toMatchObject({ ok: true });
        expect(games.get("room-a")).toBeNull();
    });

    it("E-05: 対局IDが一致しない投了・中断を拒否する", () => {
        const games = store();
        games.start("room-a", bothSeats, BLACK.userId);

        for (const result of [
            games.resign("room-a", "game-9", BLACK.userId),
            games.abort("room-a", "game-9", BLACK.userId),
        ]) {
            expect(result).toEqual({
                ok: false,
                code: "game_not_found",
                message: "対局が見つかりません",
            });
        }
        expect(games.get("room-a")?.result).toBeNull();
    });

    it("E-09: 離脱した対局者の対局を無効試合として破棄する", () => {
        const games = store();
        games.start("room-a", bothSeats, BLACK.userId);

        const abandoned = games.abandon("room-a", WHITE.userId);

        expect(abandoned?.result).toEqual({ reason: "disconnect", outcome: null });
        expect(games.get("room-a")).toBeNull();
    });

    it("観戦者の離脱では対局を破棄しない", () => {
        const games = store();
        games.start("room-a", bothSeats, BLACK.userId);

        expect(games.abandon("room-a", "user-3")).toBeNull();
        expect(games.get("room-a")?.id).toBe("game-1");
    });

    it("対局を破棄する", () => {
        const games = store();
        games.start("room-a", bothSeats, BLACK.userId);

        games.delete("room-a");

        expect(games.get("room-a")).toBeNull();
    });
});
