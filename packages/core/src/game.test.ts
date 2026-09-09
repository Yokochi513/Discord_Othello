/**
 * game.ts のテスト。対局状態の生成、着手適用の一連の処理
 * （合法手判定 → 反転 → 手番遷移／自動パス → 終局判定）、
 * 棋譜からの再生、JSON往復を検証する。
 *
 * 個々のルール判定そのもの（合法手・反転・手番遷移・終局条件）は
 * moves.test.ts / apply.test.ts / turn.test.ts / result.test.ts の責務とし、
 * ここでは検証済みのそれらを組み合わせた配線が正しいことを確認する。
 */

import { describe, expect, it } from "vitest";
import { formatSquare } from "./coord.js";
import {
    createGameState,
    InvalidSquareError,
    NotYourTurnError,
    playMove,
    replayGame,
    restoreGameState,
    type GameState,
} from "./game.js";
import { listLegalMoves } from "./moves.js";
import { resignGame } from "./result.js";
import { boardOf } from "./testHelpers.js";
import type { Square } from "./type.js";

/** 関数が投げた例外を返すテスト用ヘルパー。投げなかった場合は null */
function caught(fn: () => unknown): unknown {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

describe("createGameState", () => {
    it("初期盤面・先手番・手数0・空の棋譜を持つ", () => {
        const state = createGameState();

        expect(state.turn).toBe("black");
        expect(state.moveCount).toBe(0);
        expect(state.log).toEqual([]);
    });

    it("盤面は凍結されている", () => {
        const state = createGameState();

        expect(Object.isFrozen(state.board)).toBe(true);
        for (const row of state.board) expect(Object.isFrozen(row)).toBe(true);
    });
});

describe("playMove: 通常の着手", () => {
    it("盤面を更新し、手番を渡し、棋譜に1手を記録する", () => {
        const state = playMove(createGameState(), "black", "d3");

        expect(state.turn).toBe("white");
        expect(state.moveCount).toBe(1);
        expect(state.log).toEqual([{ kind: "move", player: "black", square: "d3" }]);
    });

    it("元の対局状態を破壊しない", () => {
        const before = createGameState();

        playMove(before, "black", "d3");

        expect(before.turn).toBe("black");
        expect(before.moveCount).toBe(0);
        expect(before.log).toEqual([]);
    });
});

describe("playMove: 手番違反", () => {
    it("手番でない側が着手すると NotYourTurnError を投げる", () => {
        const state = createGameState();

        expect(() => playMove(state, "white", "c4")).toThrow(NotYourTurnError);
    });

    it("エラーは期待した手番と実際の手番を保持する", () => {
        const error = caught(() => playMove(createGameState(), "white", "c4"));

        expect(error).toBeInstanceOf(NotYourTurnError);
        expect((error as NotYourTurnError).expected).toBe("black");
        expect((error as NotYourTurnError).actual).toBe("white");
    });
});

describe("playMove: 不正な座標表記", () => {
    it("座標表記として不正な文字列は InvalidSquareError を投げる", () => {
        const state = createGameState();

        expect(() => playMove(state, "black", "z9" as Square)).toThrow(InvalidSquareError);
    });

    it("エラーは元の文字列を保持する", () => {
        const error = caught(() => playMove(createGameState(), "black", "z9" as Square));

        expect(error).toBeInstanceOf(InvalidSquareError);
        expect((error as InvalidSquareError).square).toBe("z9");
    });
});

describe("playMove: 非合法な着手", () => {
    it("既に石があるマスへの着手は例外を投げる（apply.ts の IllegalMoveError）", () => {
        const state = createGameState();

        expect(() => playMove(state, "black", "d4")).toThrow();
    });
});

describe("playMove: 自動パスと終局判定の一連の処理", () => {
    /**
     * a1=黒, b1=白, c1=白, h1=黒, h2=白, h3=白 の盤面。
     * - 黒が d1 に着手すると b1・c1 を反転できる。反転後、白はどこにも
     *   合法手が無くなる一方、黒は h4 でなお合法手を持つため、白だけが
     *   自動パスして手番は黒に戻る（対局は続く）。
     * - 続けて黒が h4 に着手すると h2・h3 を反転できる。反転後、白の
     *   石は 0 枚になり shutout で終局し、手番は null になる。
     */
    const board = boardOf([
        "bww....b",
        ".......w",
        ".......w",
        "........",
        "........",
        "........",
        "........",
        "........",
    ]);
    const initial: GameState = { board, turn: "black", moveCount: 0, log: [] };

    it("相手だけが自動パスすると、手番は着手した側へ戻り棋譜に pass を記録する", () => {
        const state = playMove(initial, "black", "d1");

        expect(state.turn).toBe("black");
        expect(state.moveCount).toBe(2);
        expect(state.log).toEqual([
            { kind: "move", player: "black", square: "d1" },
            { kind: "pass", player: "white" },
        ]);
    });

    it("結果として白の石が0枚になれば shutout で終局し、手番は null になる", () => {
        const afterFirstMove = playMove(initial, "black", "d1");
        const state = playMove(afterFirstMove, "black", "h4");

        expect(state.turn).toBeNull();
        expect(state.log.at(-1)).toEqual({ kind: "pass", player: "black" });
        expect(state.log.at(-2)).toEqual({ kind: "pass", player: "white" });
        expect(state.log.at(-3)).toEqual({ kind: "move", player: "black", square: "h4" });
    });

    it("終局後に着手しようとすると NotYourTurnError を投げ、期待する手番は null になる", () => {
        const afterFirstMove = playMove(initial, "black", "d1");
        const ended = playMove(afterFirstMove, "black", "h4");

        const error = caught(() => playMove(ended, "black", "a2"));

        expect(error).toBeInstanceOf(NotYourTurnError);
        expect((error as NotYourTurnError).expected).toBeNull();
        expect((error as NotYourTurnError).message).toContain("終了済み");
    });
});

describe("replayGame: 完了条件① 再生と逐次適用の一致", () => {
    /** 各手番で listLegalMoves の先頭（a1→h8順）を選び続け、対局を最後まで進める */
    function playToEnd(): GameState {
        let state = createGameState();

        while (state.turn !== null) {
            const moves = listLegalMoves(state.board, state.turn);
            const square = formatSquare(moves[0]!)!;
            state = playMove(state, state.turn, square);
        }

        return state;
    }

    it("初期局面から棋譜を再生した結果が、逐次着手した結果と一致する", () => {
        const sequential = playToEnd();

        expect(sequential.turn).toBeNull();
        expect(sequential.log.length).toBeGreaterThan(0);

        const replayed = replayGame(sequential.log);

        expect(replayed).toEqual(sequential);
    });
});

describe("通しテスト: 投了による決着", () => {
    /**
     * 投了は GameState では扱わず、盤面から resignGame で決着を確定する
     * （game.ts のコメントの通り、投了は盤面から導けない事象のため result.ts の責務）。
     */
    it("対局が終わっていない盤面でも、対局状態から取り出した盤面で投了による決着がつく", () => {
        let state = createGameState();
        state = playMove(state, "black", "d3");
        state = playMove(state, "white", "c3");

        expect(state.turn).not.toBeNull();

        const result = resignGame(state.board, "black");

        expect(result).toEqual({
            reason: "resign",
            outcome: "whiteWin",
            score: { black: 3, white: 3 },
        });
    });

    it("投了しても対局状態そのものは変化しない", () => {
        let state = createGameState();
        state = playMove(state, "black", "d3");
        state = playMove(state, "white", "c3");
        const before = state;

        resignGame(state.board, "white");

        expect(state).toBe(before);
        expect(state.turn).toBe("black");
    });
});

describe("restoreGameState: 完了条件② JSON往復", () => {
    it("JSON.stringify と JSON.parse で構造的に一致する", () => {
        const state = playMove(createGameState(), "black", "d3");

        const revived = JSON.parse(JSON.stringify(state)) as GameState;

        expect(revived).toEqual(state);
    });

    it("復元後の盤面は凍結され、続けて playMove を適用できる", () => {
        const state = playMove(createGameState(), "black", "d3");
        const parsed = JSON.parse(JSON.stringify(state)) as GameState;

        const revived = restoreGameState(parsed);

        expect(Object.isFrozen(revived.board)).toBe(true);
        for (const row of revived.board) expect(Object.isFrozen(row)).toBe(true);

        expect(() => playMove(revived, "white", "c3")).not.toThrow();
    });
});
