/**
 * result.ts のテスト。3 つの終局条件の検出、石数からの勝敗判定、
 * 投了による決着を検証する。
 *
 * 合法手の判定そのものは moves.test.ts の責務とし、
 * ここでは検証済みの moves.ts / board.ts をテスト用ヘルパー経由で利用する。
 */

import { describe, expect, it } from "vitest";
import { createInitialBoard } from "./board.js";
import { BOARD_SIZE } from "./coord.js";
import { hasLegalMove } from "./moves.js";
import {
    detectGameEnd,
    finishGame,
    isGameOver,
    judgeOutcome,
    resignGame,
    winnerOf,
} from "./result.js";
import { boardOf, EMPTY_ROWS } from "./testHelpers.js";
import type { GameResult } from "./type.js";

/** 黒が 0 枚の盤面。空マスは残っている */
const BLACK_SHUTOUT = boardOf(["ww......", ...EMPTY_ROWS.slice(1)]);

/** 白が 0 枚の盤面。空マスは残っている */
const WHITE_SHUTOUT = boardOf(["bb......", ...EMPTY_ROWS.slice(1)]);

/** 黒一色で埋まった盤面。白 0 枚と盤面が埋まる条件が同時に成立する */
const FULL_ALL_BLACK = boardOf(Array.from({ length: BOARD_SIZE }, () => "bbbbbbbb"));

/** 石で埋まり、黒 40 対 白 24 で黒が多い盤面 */
const FULL_BLACK_WIN = boardOf([
    ...Array.from({ length: 5 }, () => "bbbbbbbb"),
    ...Array.from({ length: 3 }, () => "wwwwwwww"),
]);

/** 石で埋まり、黒 32 対 白 32 の同数の盤面 */
const FULL_DRAW = boardOf([
    ...Array.from({ length: 4 }, () => "bbbbbbbb"),
    ...Array.from({ length: 4 }, () => "wwwwwwww"),
]);

/** 両者とも打てない盤面。a1=黒, h8=白 が離れており、どちらの色も石を挟めない */
const BOTH_STUCK = boardOf(["b.......", ...EMPTY_ROWS.slice(1, BOARD_SIZE - 1), ".......w"]);

/**
 * 白だけが打てない盤面。a1=黒, b1=白。
 * 黒は c1 に打って b1 を挟めるため、まだ終局していない。
 */
const WHITE_STUCK = boardOf(["bw......", ...EMPTY_ROWS.slice(1)]);

/** 黒 24 対 白 1 で黒が大きくリードしている盤面。投了の検証に用いる */
const BLACK_LEAD = boardOf([
    ...Array.from({ length: 3 }, () => "bbbbbbbb"),
    "w.......",
    ...EMPTY_ROWS.slice(4),
]);

describe("detectGameEnd: 継続中", () => {
    it("初期盤面は終局していない", () => {
        expect(detectGameEnd(createInitialBoard())).toBeNull();
    });

    it("片方だけが打てない盤面は終局していない（自動パスで対局が続く）", () => {
        expect(hasLegalMove(WHITE_STUCK, "white")).toBe(false);
        expect(hasLegalMove(WHITE_STUCK, "black")).toBe(true);

        expect(detectGameEnd(WHITE_STUCK)).toBeNull();
    });
});

describe("detectGameEnd: 終局条件①両者が連続でパス", () => {
    it("前提: 空マスが残っていて、どちらも打てない", () => {
        expect(hasLegalMove(BOTH_STUCK, "black")).toBe(false);
        expect(hasLegalMove(BOTH_STUCK, "white")).toBe(false);
    });

    it("両者とも合法手が無ければ bothPassed になる", () => {
        expect(detectGameEnd(BOTH_STUCK)).toBe("bothPassed");
    });
});

describe("detectGameEnd: 終局条件②盤面が石で埋まる", () => {
    it("両者の石で埋まっていれば boardFull になる", () => {
        expect(detectGameEnd(FULL_BLACK_WIN)).toBe("boardFull");
    });

    it("同数で埋まっていても boardFull になる", () => {
        expect(detectGameEnd(FULL_DRAW)).toBe("boardFull");
    });
});

describe("detectGameEnd: 終局条件③一方の石が 0 枚になる", () => {
    it("黒が 0 枚なら shutout になる", () => {
        expect(detectGameEnd(BLACK_SHUTOUT)).toBe("shutout");
    });

    it("白が 0 枚なら shutout になる", () => {
        expect(detectGameEnd(WHITE_SHUTOUT)).toBe("shutout");
    });

    it("一色で埋まった場合は boardFull より shutout を優先する", () => {
        expect(detectGameEnd(FULL_ALL_BLACK)).toBe("shutout");
    });
});

describe("isGameOver", () => {
    it("継続中の盤面では false", () => {
        expect(isGameOver(createInitialBoard())).toBe(false);
    });

    it("終局した盤面では true", () => {
        expect(isGameOver(BOTH_STUCK)).toBe(true);
        expect(isGameOver(FULL_DRAW)).toBe(true);
        expect(isGameOver(BLACK_SHUTOUT)).toBe(true);
    });
});

describe("judgeOutcome", () => {
    it("黒が多ければ黒の勝ち", () => {
        expect(judgeOutcome({ black: 40, white: 24 })).toBe("blackWin");
    });

    it("白が多ければ白の勝ち", () => {
        expect(judgeOutcome({ black: 24, white: 40 })).toBe("whiteWin");
    });

    it("同数なら引き分け", () => {
        expect(judgeOutcome({ black: 32, white: 32 })).toBe("draw");
    });

    it("1 枚差でも勝敗がつく", () => {
        expect(judgeOutcome({ black: 33, white: 31 })).toBe("blackWin");
        expect(judgeOutcome({ black: 31, white: 33 })).toBe("whiteWin");
    });
});

describe("finishGame", () => {
    it("継続中の盤面では null を返す", () => {
        expect(finishGame(createInitialBoard())).toBeNull();
    });

    it("盤面が埋まった場合、終局理由・勝敗・石数を返す", () => {
        expect(finishGame(FULL_BLACK_WIN)).toEqual({
            reason: "boardFull",
            outcome: "blackWin",
            score: { black: 40, white: 24 },
        });
    });

    it("同数で埋まった場合は引き分けになる", () => {
        expect(finishGame(FULL_DRAW)).toEqual({
            reason: "boardFull",
            outcome: "draw",
            score: { black: 32, white: 32 },
        });
    });

    it("完封の場合、石が残っている側の勝ちになる", () => {
        expect(finishGame(BLACK_SHUTOUT)).toEqual({
            reason: "shutout",
            outcome: "whiteWin",
            score: { black: 0, white: 2 },
        });
    });

    it("連続パスの場合、その時点の石数で勝敗が決まる", () => {
        expect(finishGame(BOTH_STUCK)).toEqual({
            reason: "bothPassed",
            outcome: "draw",
            score: { black: 1, white: 1 },
        });
    });
});

describe("resignGame", () => {
    it("投了した側の負けになる", () => {
        expect(resignGame(createInitialBoard(), "black").outcome).toBe("whiteWin");
        expect(resignGame(createInitialBoard(), "white").outcome).toBe("blackWin");
    });

    it("終局理由は resign になる", () => {
        expect(resignGame(createInitialBoard(), "black").reason).toBe("resign");
    });

    it("石数でリードしていても投了した側の負けになる", () => {
        expect(resignGame(BLACK_LEAD, "black")).toEqual({
            reason: "resign",
            outcome: "whiteWin",
            score: { black: 24, white: 1 },
        });
    });

    it("石数は投了時点の値で確定し、空マスは勝者に加算しない", () => {
        const result = resignGame(BLACK_LEAD, "black");

        expect(result.score).toEqual({ black: 24, white: 1 });
        expect(result.score.black + result.score.white).toBe(25);
    });

    it("終局していない盤面でも投了できる", () => {
        expect(isGameOver(createInitialBoard())).toBe(false);

        expect(resignGame(createInitialBoard(), "white")).toEqual({
            reason: "resign",
            outcome: "blackWin",
            score: { black: 2, white: 2 },
        });
    });
});

describe("winnerOf", () => {
    /** 勝敗だけを差し替えた対局結果を作る */
    const resultWith = (outcome: GameResult["outcome"]): GameResult => ({
        reason: "boardFull",
        outcome,
        score: { black: 32, white: 32 },
    });

    it("黒の勝ちなら black を返す", () => {
        expect(winnerOf(resultWith("blackWin"))).toBe("black");
    });

    it("白の勝ちなら white を返す", () => {
        expect(winnerOf(resultWith("whiteWin"))).toBe("white");
    });

    it("引き分けなら null を返す", () => {
        expect(winnerOf(resultWith("draw"))).toBeNull();
    });
});
