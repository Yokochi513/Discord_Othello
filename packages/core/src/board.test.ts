/**
 * board.ts のテスト。初期配置・マスの参照・石数の集計・盤面の不変性を検証する。
 *
 * 座標表記と内部インデックスの相互変換そのものは coord.test.ts の責務とし、
 * ここでは検証済みの変換をテスト用ヘルパー経由で利用する。
 */

import { describe, expect, it } from "vitest";
import { countCells, countStones, createInitialBoard, freezeBoard, getCell } from "./board.js";
import type { Board } from "./board.js";
import { BOARD_SIZE, formatSquare, parseSquare } from "./coord.js";
import type { Cell, Square } from "./type.js";

/** 全 64 マスの座標表記を左上（a1）から順に列挙する */
function allSquares(): Square[] {
    const squares: Square[] = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            squares.push(formatSquare({ row, col })!);
        }
    }
    return squares;
}

/** 座標表記でマスの状態を取得するテスト用ヘルパー */
function at(board: Board, square: Square): Cell | undefined {
    const coord = parseSquare(square);
    if (coord === null) return undefined;
    return board[coord.row]?.[coord.col];
}

/**
 * 文字列から盤面を組み立てるテスト用ヘルパー。
 * 1 行が盤面の 1 行に対応し、. = 空 / b = 黒 / w = 白 を表す。
 */
function boardOf(rows: readonly string[]): Board {
    const cellByChar: Record<string, Cell> = { ".": "empty", b: "black", w: "white" };
    return freezeBoard(rows.map((row) => [...row].map((char) => cellByChar[char]!)));
}

describe("createInitialBoard", () => {
    it("8 行 8 列の盤面を返す", () => {
        const board = createInitialBoard();

        expect(board).toHaveLength(BOARD_SIZE);
        for (const row of board) {
            expect(row).toHaveLength(BOARD_SIZE);
        }
    });

    it("初期配置は d4=白, e4=黒, d5=黒, e5=白", () => {
        const board = createInitialBoard();

        expect(at(board, "d4")).toBe("white");
        expect(at(board, "e4")).toBe("black");
        expect(at(board, "d5")).toBe("black");
        expect(at(board, "e5")).toBe("white");
    });

    it("中央 4 マス以外はすべて空", () => {
        const board = createInitialBoard();
        const occupied = new Set<Square>(["d4", "e4", "d5", "e5"]);

        for (const square of allSquares()) {
            if (occupied.has(square)) continue;

            expect(at(board, square), `${square} は空であること`).toBe("empty");
        }
    });

    it("石数は黒 2・白 2、空きは 60", () => {
        expect(countCells(createInitialBoard())).toEqual({ black: 2, white: 2, empty: 60 });
    });

    it("四隅は空", () => {
        const board = createInitialBoard();

        expect(at(board, "a1")).toBe("empty");
        expect(at(board, "h1")).toBe("empty");
        expect(at(board, "a8")).toBe("empty");
        expect(at(board, "h8")).toBe("empty");
    });

    it("呼び出しごとに独立した盤面を返す", () => {
        const first = createInitialBoard();
        const second = createInitialBoard();

        expect(first).not.toBe(second);
        expect(first).toEqual(second);
        // 行の配列も共有していない（片方への変更がもう片方へ波及しない）
        for (let row = 0; row < BOARD_SIZE; row++) {
            expect(first[row]).not.toBe(second[row]);
        }
    });
});

describe("getCell", () => {
    it("盤上のマスの状態を返す", () => {
        const board = createInitialBoard();

        expect(getCell(board, { row: 3, col: 3 })).toBe("white");
        expect(getCell(board, { row: 3, col: 4 })).toBe("black");
        expect(getCell(board, { row: 0, col: 0 })).toBe("empty");
    });

    it("盤外の座標は null を返す", () => {
        const board = createInitialBoard();

        expect(getCell(board, { row: -1, col: 0 })).toBeNull();
        expect(getCell(board, { row: 0, col: -1 })).toBeNull();
        expect(getCell(board, { row: BOARD_SIZE, col: 0 })).toBeNull();
        expect(getCell(board, { row: 0, col: BOARD_SIZE })).toBeNull();
        expect(getCell(board, { row: 0.5, col: 0 })).toBeNull();
        expect(getCell(board, { row: Number.NaN, col: 0 })).toBeNull();
    });
});

describe("countCells", () => {
    it("初期盤面は黒 2・白 2・空き 60", () => {
        expect(countCells(createInitialBoard())).toEqual({ black: 2, white: 2, empty: 60 });
    });

    it("空の盤面は空きが 64", () => {
        const board = boardOf(Array.from({ length: BOARD_SIZE }, () => "........"));

        expect(countCells(board)).toEqual({ black: 0, white: 0, empty: 64 });
    });

    it("石で埋まった盤面は空きが 0", () => {
        const board = boardOf(Array.from({ length: BOARD_SIZE }, () => "bbbbwwww"));

        expect(countCells(board)).toEqual({ black: 32, white: 32, empty: 0 });
    });

    it("黒・白・空きが混在する盤面を数える", () => {
        const board = boardOf([
            "bbbbbbbb",
            "wwwwwwww",
            "........",
            "........",
            "........",
            "........",
            "........",
            "b......w",
        ]);

        expect(countCells(board)).toEqual({ black: 9, white: 9, empty: 46 });
    });

    it("合計は常に 64", () => {
        const count = countCells(createInitialBoard());

        expect(count.black + count.white + count.empty).toBe(BOARD_SIZE * BOARD_SIZE);
    });
});

describe("countStones", () => {
    it("指定した色の石数を返す", () => {
        const board = boardOf([
            "bbb.....",
            "w.......",
            "........",
            "........",
            "........",
            "........",
            "........",
            "........",
        ]);

        expect(countStones(board, "black")).toBe(3);
        expect(countStones(board, "white")).toBe(1);
    });

    it("初期盤面は黒 2・白 2", () => {
        const board = createInitialBoard();

        expect(countStones(board, "black")).toBe(2);
        expect(countStones(board, "white")).toBe(2);
    });
});

describe("盤面の不変性", () => {
    it("createInitialBoard が返す盤面は凍結されている", () => {
        const board = createInitialBoard();

        expect(Object.isFrozen(board)).toBe(true);
        for (const row of board) {
            expect(Object.isFrozen(row)).toBe(true);
        }
    });

    it("マスへの代入は TypeError になる", () => {
        const board = createInitialBoard() as Cell[][];

        expect(() => {
            board[0]![0] = "black";
        }).toThrow(TypeError);
        expect(getCell(board, { row: 0, col: 0 })).toBe("empty");
    });

    it("行の追加・削除は TypeError になる", () => {
        const board = createInitialBoard() as Cell[][];

        expect(() => board.push([])).toThrow(TypeError);
        expect(() => board[0]!.push("black")).toThrow(TypeError);
        expect(board).toHaveLength(BOARD_SIZE);
        expect(board[0]).toHaveLength(BOARD_SIZE);
    });

    it("行の差し替えは TypeError になる", () => {
        const board = createInitialBoard() as Cell[][];

        expect(() => {
            board[0] = [];
        }).toThrow(TypeError);
        expect(board[0]).toHaveLength(BOARD_SIZE);
    });

    it("freezeBoard は外側の配列と各行の両方を凍結する", () => {
        const board = freezeBoard([
            ["empty", "black"],
            ["white", "empty"],
        ]);

        expect(Object.isFrozen(board)).toBe(true);
        expect(Object.isFrozen(board[0])).toBe(true);
        expect(Object.isFrozen(board[1])).toBe(true);
    });
});
