import { createInitialBoard, playMove, createGameState } from "@othello/core";
import type {
    ErrorCode,
    GameResult,
    GameState,
    Participant,
    RoomState,
    ServerMessage,
} from "@othello/protocol";
import { describe, expect, it } from "vitest";

import {
    boardDigest,
    evaluateResponses,
    MISSING_GAME_ID,
    parseProbeArgs,
    pickLegalSquare,
    pickOccupiedSquare,
    planChecks,
    seatOfGame,
    type ProbeCheck,
    type ProbeCheckId,
} from "./probePlan.ts";

const yokochi: Participant = { userId: "user-1", displayName: "よこち" };
const harima: Participant = { userId: "user-2", displayName: "はりま" };
const ojosama: Participant = { userId: "user-3", displayName: "お嬢様" };

// 初期局面の対局。turn と result を差し替えて各状況を作る
function game(overrides: Partial<GameState> = {}): GameState {
    return {
        id: "game-1",
        board: createInitialBoard(),
        turn: "black",
        scores: { black: 2, white: 2 },
        moveCount: 0,
        lastMove: null,
        players: { black: yokochi, white: harima },
        result: null,
        ...overrides,
    };
}

function room(current: GameState | null): RoomState {
    return {
        instanceId: "room-a",
        seats: { black: yokochi, white: harima },
        spectators: [ojosama],
        game: current,
    };
}

// 実行できる検査を番号で取り出す
function ids(state: RoomState, userId: string): readonly ProbeCheckId[] {
    return planChecks(state, userId).checks.map((check) => check.id);
}

function checkOf(state: RoomState, userId: string, id: ProbeCheckId): ProbeCheck {
    const found = planChecks(state, userId).checks.find((check) => check.id === id);
    if (found === undefined) throw new Error(`${id} が計画に含まれていません`);
    return found;
}

describe("planChecks", () => {
    it("対局がなければ E-05 だけを実行し、残りは理由を添えて未実施にする", () => {
        const plan = planChecks(room(null), yokochi.userId);

        expect(plan.checks.map((check) => check.id)).toEqual(["E-05"]);
        expect(plan.skipped.map((skipped) => skipped.id)).toEqual(["E-01", "E-02", "E-03", "E-04"]);
        expect(plan.skipped[0]?.reason).toContain("対局");
    });

    it("手番でない対局者では E-01 を実行する", () => {
        expect(ids(room(game()), harima.userId)).toEqual(["E-01", "E-05"]);
    });

    it("手番の対局者では E-02 を実行する", () => {
        expect(ids(room(game()), yokochi.userId)).toEqual(["E-02", "E-05"]);
    });

    it("観戦者では E-03 を実行する", () => {
        expect(ids(room(game()), ojosama.userId)).toEqual(["E-03", "E-05"]);
    });

    it("終局済みの対局では、対局者・観戦者のいずれでも E-04 を実行する", () => {
        const result: GameResult = { reason: "resign", outcome: "white_win" };
        const finished = room(game({ turn: null, result }));

        expect(ids(finished, yokochi.userId)).toEqual(["E-04", "E-05"]);
        expect(ids(finished, ojosama.userId)).toEqual(["E-04", "E-05"]);
    });

    it("E-01 は手番の側にとっての合法手を送り、手番違いだけを理由に拒否させる", () => {
        const check = checkOf(room(game()), harima.userId, "E-01");

        expect(check.message).toEqual({ type: "move", gameId: "game-1", square: "d3" });
        expect(check.expected).toBe("invalid_state");
    });

    it("E-02 は石のあるマスを送り、非合法手として拒否させる", () => {
        const check = checkOf(room(game()), yokochi.userId, "E-02");

        expect(check.message).toEqual({ type: "move", gameId: "game-1", square: "d4" });
        expect(check.expected).toBe("illegal_move");
    });

    it("E-05 は存在しない対局 ID を送る", () => {
        const check = checkOf(room(game()), yokochi.userId, "E-05");

        expect(check.message).toEqual({
            type: "move",
            gameId: MISSING_GAME_ID,
            square: "d3",
        });
        expect(check.expected).toBe("game_not_found");
    });

    it("進行中の対局では E-04 を未実施にし、終局させる手順を理由に示す", () => {
        const plan = planChecks(room(game()), yokochi.userId);
        const skipped = plan.skipped.find((entry) => entry.id === "E-04");

        expect(skipped?.reason).toContain("終局");
    });
});

describe("evaluateResponses", () => {
    const check = checkOf(room(game()), yokochi.userId, "E-02");

    function error(code: ErrorCode): ServerMessage {
        return { type: "error", code, message: "そのマスには打てません" };
    }

    it("期待どおりのエラーだけが返れば合格とする", () => {
        const outcome = evaluateResponses(check, [error("illegal_move")]);

        expect(outcome).toMatchObject({ id: "E-02", passed: true });
        expect(outcome.detail).toContain("illegal_move");
    });

    it("拒否されなければ不合格とする", () => {
        expect(evaluateResponses(check, [])).toMatchObject({
            passed: false,
            detail: expect.stringContaining("拒否されなかった"),
        });
    });

    it("エラー種別が違えば不合格とする", () => {
        expect(evaluateResponses(check, [error("invalid_state")])).toMatchObject({
            passed: false,
            detail: expect.stringContaining("エラー種別が違う"),
        });
    });

    it("拒否と同時に盤面が配信されていれば不合格とする", () => {
        const state: ServerMessage = { type: "state", state: room(game()) };

        expect(evaluateResponses(check, [error("illegal_move"), state])).toMatchObject({
            passed: false,
            detail: expect.stringContaining("配信"),
        });
    });
});

describe("boardDigest", () => {
    it("盤面が変わらなければ同じ文字列になる", () => {
        expect(boardDigest(game())).toBe(boardDigest(game()));
    });

    it("着手で盤面が変われば違う文字列になる", () => {
        const played = playMove(createGameState(), "black", "d3");

        expect(boardDigest(game({ board: played.board, moveCount: 1 }))).not.toBe(
            boardDigest(game()),
        );
    });

    it("対局していない状態も表せる", () => {
        expect(boardDigest(null)).toBe("対局なし");
    });
});

describe("pickLegalSquare / pickOccupiedSquare", () => {
    it("初期局面の黒の合法手を返す", () => {
        expect(pickLegalSquare(createInitialBoard(), "black")).toBe("d3");
    });

    it("石のあるマスを返す", () => {
        expect(pickOccupiedSquare(createInitialBoard())).toBe("d4");
    });

    it("石が 1 枚も無ければ null を返す", () => {
        const empty = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => "empty"));

        expect(pickOccupiedSquare(empty as GameState["board"])).toBeNull();
    });
});

describe("seatOfGame", () => {
    it("対局者の席を返し、観戦者には null を返す", () => {
        expect(seatOfGame(game(), yokochi.userId)).toBe("black");
        expect(seatOfGame(game(), harima.userId)).toBe("white");
        expect(seatOfGame(game(), ojosama.userId)).toBeNull();
    });
});

describe("parseProbeArgs", () => {
    const required = ["--url", "wss://example.com/ws", "--instance", "room-a", "--token", "abc"];

    it("既定では check モードで、待ち時間と応答性の上限に既定値を使う", () => {
        const parsed = parseProbeArgs(required, {});

        expect(parsed).toEqual({
            ok: true,
            args: {
                mode: "check",
                url: "wss://example.com/ws",
                instanceId: "room-a",
                token: "abc",
                waitMs: 2_000,
                turnTimeoutMs: 180_000,
                repeat: 3,
                limitMs: 1_000,
            },
        });
    });

    it("サブコマンドで measure モードを選べる", () => {
        const parsed = parseProbeArgs(["measure", ...required], {});

        expect(parsed).toMatchObject({ ok: true, args: { mode: "measure" } });
    });

    it("--name=value 形式と環境変数からも読む", () => {
        const parsed = parseProbeArgs(["--url=wss://example.com/ws", "--limit=1500"], {
            OTHELLO_PROBE_INSTANCE: "room-b",
            OTHELLO_PROBE_TOKEN: "xyz",
        });

        expect(parsed).toMatchObject({
            ok: true,
            args: {
                url: "wss://example.com/ws",
                instanceId: "room-b",
                token: "xyz",
                limitMs: 1500,
            },
        });
    });

    it("接続先が無ければ使い方を返す", () => {
        expect(parseProbeArgs([], {})).toEqual({
            ok: false,
            message: "接続先を --url か OTHELLO_PROBE_URL で指定してください",
        });
    });

    it("インスタンス ID とトークンの不足も使い方で伝える", () => {
        expect(parseProbeArgs(["--url", "wss://example.com/ws"], {})).toMatchObject({
            ok: false,
            message: expect.stringContaining("インスタンス ID"),
        });
        expect(
            parseProbeArgs(["--url", "wss://example.com/ws", "--instance", "room-a"], {}),
        ).toMatchObject({ ok: false, message: expect.stringContaining("アクセストークン") });
    });

    it("値の無いオプションと解釈できない引数を拒否する", () => {
        expect(parseProbeArgs([...required, "--wait"], {})).toMatchObject({
            ok: false,
            message: "--wait に値がありません",
        });
        expect(parseProbeArgs(["play"], {})).toMatchObject({
            ok: false,
            message: "解釈できない引数です: play",
        });
    });

    it("数値の設定に正の数以外を拒否する", () => {
        expect(parseProbeArgs([...required, "--repeat", "0"], {})).toMatchObject({
            ok: false,
            message: expect.stringContaining("--repeat"),
        });
    });
});
