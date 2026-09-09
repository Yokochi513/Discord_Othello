/**
 * turn.ts のテスト。着手後の手番遷移と、合法手が無い側の自動パス、
 * 両者が打てない連続パスの検出を検証する。
 *
 * 合法手の判定そのものは moves.test.ts の責務とし、
 * ここでは検証済みの moves.ts / board.ts / coord.ts をテスト用ヘルパー経由で利用する。
 */

import { describe, expect, it } from "vitest";
import { applyMove } from "./apply.js";
import { createInitialBoard } from "./board.js";
import { BOARD_SIZE, parseSquare } from "./coord.js";
import { hasLegalMove } from "./moves.js";
import { boardOf, EMPTY_ROWS } from "./testHelpers.js";
import { nextTurn, passedPlayers } from "./turn.js";

/**
 * 白だけが打てない盤面。a1=黒, b1=白。
 * 黒は c1 に打って b1 を挟めるが、白が挟める黒石は隅の a1 だけで、
 * その先は盤外なのでどこにも打てない。
 */
const WHITE_STUCK = boardOf(["bw......", ...EMPTY_ROWS.slice(1)]);

/** 黒だけが打てない盤面。WHITE_STUCK の白黒を入れ替えたもの */
const BLACK_STUCK = boardOf(["wb......", ...EMPTY_ROWS.slice(1)]);

/** 両者とも打てない盤面。a1=黒, h8=白 が離れており、どちらの色も石を挟めない */
const BOTH_STUCK = boardOf(["b.......", ...EMPTY_ROWS.slice(1, BOARD_SIZE - 1), ".......w"]);

/** 石で埋まった盤面。空マスが無いのでどちらの色も打てない */
const FULL_BOARD = boardOf(Array.from({ length: BOARD_SIZE }, () => "bbbbbbbb"));

describe("nextTurn: 通常遷移", () => {
    it("相手に合法手があれば相手へ手番が移る", () => {
        expect(nextTurn(createInitialBoard(), "black")).toEqual({ kind: "next", player: "white" });
    });

    it("白が着手した場合も同様に相手へ手番が移る", () => {
        expect(nextTurn(createInitialBoard(), "white")).toEqual({ kind: "next", player: "black" });
    });

    it("着手を適用した直後の盤面でも相手へ手番が移る", () => {
        const board = applyMove(createInitialBoard(), parseSquare("d3")!, "black");

        expect(nextTurn(board, "black")).toEqual({ kind: "next", player: "white" });
    });

    it("通常遷移ではパスした側を持たない", () => {
        expect(nextTurn(createInitialBoard(), "black")).not.toHaveProperty("passedBy");
    });
});

describe("nextTurn: 自動パス", () => {
    it("前提: 白に合法手が無く、黒には合法手がある", () => {
        expect(hasLegalMove(WHITE_STUCK, "white")).toBe(false);
        expect(hasLegalMove(WHITE_STUCK, "black")).toBe(true);
    });

    it("相手に合法手が無ければ、相手がパスして手番が着手側へ戻る", () => {
        expect(nextTurn(WHITE_STUCK, "black")).toEqual({
            kind: "pass",
            player: "black",
            passedBy: "white",
        });
    });

    it("白黒を入れ替えても同様にパスする", () => {
        expect(nextTurn(BLACK_STUCK, "white")).toEqual({
            kind: "pass",
            player: "white",
            passedBy: "black",
        });
    });
});

describe("nextTurn: 連続パス", () => {
    it("前提: 両者とも合法手が無い", () => {
        expect(hasLegalMove(BOTH_STUCK, "black")).toBe(false);
        expect(hasLegalMove(BOTH_STUCK, "white")).toBe(false);
    });

    it("両者とも合法手が無ければ連続パスになる", () => {
        expect(nextTurn(BOTH_STUCK, "black")).toEqual({
            kind: "bothPassed",
            passedBy: ["white", "black"],
        });
    });

    it("passedBy はパスが起きた順（相手 → 着手側）に並ぶ", () => {
        expect(nextTurn(BOTH_STUCK, "white")).toEqual({
            kind: "bothPassed",
            passedBy: ["black", "white"],
        });
    });

    it("連続パスでは次の手番を持たない", () => {
        expect(nextTurn(BOTH_STUCK, "black")).not.toHaveProperty("player");
    });

    it("盤面が石で埋まっている場合も連続パスになる", () => {
        expect(nextTurn(FULL_BOARD, "black")).toEqual({
            kind: "bothPassed",
            passedBy: ["white", "black"],
        });
    });
});

describe("nextTurn: 不変性", () => {
    it("渡された盤面を書き換えない", () => {
        const board = createInitialBoard();

        nextTurn(board, "black");

        expect(board).toEqual(createInitialBoard());
    });
});

describe("passedPlayers", () => {
    it("通常遷移では空配列を返す", () => {
        expect(passedPlayers(nextTurn(createInitialBoard(), "black"))).toEqual([]);
    });

    it("自動パスではパスした側だけを返す", () => {
        expect(passedPlayers(nextTurn(WHITE_STUCK, "black"))).toEqual(["white"]);
    });

    it("連続パスでは両者をパスの順に返す", () => {
        expect(passedPlayers(nextTurn(BOTH_STUCK, "black"))).toEqual(["white", "black"]);
        expect(passedPlayers(nextTurn(BOTH_STUCK, "white"))).toEqual(["black", "white"]);
    });
});
