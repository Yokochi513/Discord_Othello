/**
 * apply.ts のテスト。着手によって反転する石の列挙と、
 * 反転を反映した新しい盤面の生成、非合法な着手の拒否を検証する。
 *
 * 合法手そのものの判定は moves.test.ts の責務とし、
 * ここでは検証済みの moves.ts / board.ts / coord.ts をテスト用ヘルパー経由で利用する。
 */

import { describe, expect, it } from "vitest";
import { applyMove, IllegalMoveError, listFlips } from "./apply.js";
import { countCells, createInitialBoard, getCell } from "./board.js";
import type { Board } from "./board.js";
import { BOARD_SIZE, formatSquare, parseSquare } from "./coord.js";
import { isLegalMove, listLegalMoves } from "./moves.js";
import { opponent } from "./player.js";
import { boardOf, EMPTY_ROWS } from "./testHelpers.js";
import type { Cell, Player, Square } from "./type.js";

/** 盤面を boardOf と同じ表記の文字列配列へ戻すテスト用ヘルパー */
function rowsOf(board: Board): string[] {
    const charByCell: Record<Cell, string> = { empty: ".", black: "b", white: "w" };
    return board.map((row) => row.map((cell) => charByCell[cell]).join(""));
}

/**
 * 反転する石を座標表記で返すテスト用ヘルパー。
 * 走査順そのものを検証するため、並べ替えはしない。
 */
function flipsAt(board: Board, square: Square, player: Player): Square[] {
    return listFlips(board, parseSquare(square)!, player).map((coord) => formatSquare(coord)!);
}

/** 座標表記で着手を適用するテスト用ヘルパー */
function moveAt(board: Board, square: Square, player: Player): Board {
    return applyMove(board, parseSquare(square)!, player);
}

/** 関数が投げた例外を返すテスト用ヘルパー。投げなかった場合は null */
function caught(fn: () => unknown): unknown {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

describe("listFlips: 初期盤面", () => {
    it("黒の d3 は d4 を反転する", () => {
        expect(flipsAt(createInitialBoard(), "d3", "black")).toEqual(["d4"]);
    });

    it("黒の c4 は d4 を反転する", () => {
        expect(flipsAt(createInitialBoard(), "c4", "black")).toEqual(["d4"]);
    });

    it("黒の f5 は e5 を反転する", () => {
        expect(flipsAt(createInitialBoard(), "f5", "black")).toEqual(["e5"]);
    });

    it("黒の e6 は e5 を反転する", () => {
        expect(flipsAt(createInitialBoard(), "e6", "black")).toEqual(["e5"]);
    });

    it("白の e3 は e4 を反転する", () => {
        expect(flipsAt(createInitialBoard(), "e3", "white")).toEqual(["e4"]);
    });

    it("初期盤面の合法手はいずれもちょうど 1 枚だけ反転する", () => {
        const board = createInitialBoard();

        for (const player of ["black", "white"] as const) {
            for (const coord of listLegalMoves(board, player)) {
                expect(listFlips(board, coord, player), `${formatSquare(coord)!}`).toHaveLength(1);
            }
        }
    });
});

describe("listFlips: 反転しない着手", () => {
    it("既に石があるマスは空配列を返す", () => {
        const board = createInitialBoard();

        for (const square of ["d4", "e4", "d5", "e5"] as const) {
            expect(flipsAt(board, square, "black"), `${square} は着手済み`).toEqual([]);
            expect(flipsAt(board, square, "white"), `${square} は着手済み`).toEqual([]);
        }
    });

    it("盤外の座標は空配列を返す", () => {
        const board = createInitialBoard();

        expect(listFlips(board, { row: -1, col: 0 }, "black")).toEqual([]);
        expect(listFlips(board, { row: 0, col: -1 }, "black")).toEqual([]);
        expect(listFlips(board, { row: BOARD_SIZE, col: 0 }, "black")).toEqual([]);
        expect(listFlips(board, { row: 0, col: BOARD_SIZE }, "black")).toEqual([]);
    });

    it("小数・NaN・Infinity の座標は空配列を返す", () => {
        const board = createInitialBoard();

        expect(listFlips(board, { row: 2.5, col: 3 }, "black")).toEqual([]);
        expect(listFlips(board, { row: Number.NaN, col: 3 }, "black")).toEqual([]);
        expect(listFlips(board, { row: 2, col: Number.POSITIVE_INFINITY }, "black")).toEqual([]);
    });

    it("石が 1 つも無い盤面ではどこに置いても空配列を返す", () => {
        const board = boardOf(EMPTY_ROWS);

        expect(flipsAt(board, "d4", "black")).toEqual([]);
        expect(flipsAt(board, "a1", "white")).toEqual([]);
    });

    it("隣が自分の石だけの方向は反転しない（0 枚挟み）", () => {
        // a1=黒, b1=黒。黒が c1 に置いても相手の石を 1 枚も挟めない
        const board = boardOf(["bb......", ...EMPTY_ROWS.slice(1)]);

        expect(flipsAt(board, "c1", "black")).toEqual([]);
    });

    it("相手の石の並びの先が空マスなら反転しない", () => {
        // a1=空, b1=白, c1=白。黒が d1 に置いても左端が空マスで閉じられない
        const board = boardOf([".ww.....", ...EMPTY_ROWS.slice(1)]);

        expect(flipsAt(board, "d1", "black")).toEqual([]);
    });

    it("相手の石が盤端まで続く方向は反転しない", () => {
        // g1=白, h1=白。黒が f1 に置いても右端が盤外で閉じられない
        const board = boardOf(["......ww", ...EMPTY_ROWS.slice(1)]);

        expect(flipsAt(board, "f1", "black")).toEqual([]);
    });

    it("盤端で反対側へ回り込まない", () => {
        // g1=黒, h1=白。a1 から左へ回り込めば h1(白) → g1(黒) で挟めてしまう
        const board = boardOf(["......bw", ...EMPTY_ROWS.slice(1)]);

        expect(flipsAt(board, "a1", "black")).toEqual([]);
    });

    it("手番の色を入れ替えると反転しなくなる", () => {
        // b1=白, c1=黒。a1 は黒なら b1 を反転できるが、白では挟めない
        const board = boardOf([".wb.....", ...EMPTY_ROWS.slice(1)]);

        expect(flipsAt(board, "a1", "black")).toEqual(["b1"]);
        expect(flipsAt(board, "a1", "white")).toEqual([]);
    });
});

describe("listFlips: 複数枚・複数方向", () => {
    it("一直線に連続する 6 枚を着手点に近い順で返す", () => {
        // a1=黒, b1〜g1=白。黒が h1 に置くと 6 枚まとめて反転する
        const board = boardOf(["bwwwwww.", ...EMPTY_ROWS.slice(1)]);

        expect(flipsAt(board, "h1", "black")).toEqual(["g1", "f1", "e1", "d1", "c1", "b1"]);
    });

    it("複数方向で挟める場合は全方向ぶんをまとめて返す", () => {
        // d4 の右（e4=白, f4=黒）と下（d5=白, d6=黒）の両方で挟める
        const board = boardOf([
            "........",
            "........",
            "........",
            "....wb..",
            "...w....",
            "...b....",
            "........",
            "........",
        ]);

        expect([...flipsAt(board, "d4", "black")].sort()).toEqual(["d5", "e4"]);
    });

    it("斜め方向の石も反転する", () => {
        // b2=白, c3=黒。黒が a1 に置くと b2 を反転する
        const board = boardOf(["........", ".w......", "..b.....", ...EMPTY_ROWS.slice(3)]);

        expect(flipsAt(board, "a1", "black")).toEqual(["b2"]);
    });

    it("反転するマスはすべて相手の石であり、重複しない", () => {
        const board = boardOf([
            "........",
            "...bw...",
            "..bwb...",
            "...wbw..",
            "..b.w...",
            "........",
            "........",
            "........",
        ]);

        for (const player of ["black", "white"] as const) {
            for (const coord of listLegalMoves(board, player)) {
                const flips = listFlips(board, coord, player);
                const squares = flips.map((flip) => formatSquare(flip)!);

                expect(new Set(squares).size, `${formatSquare(coord)!}`).toBe(flips.length);
                for (const flip of flips) {
                    expect(getCell(board, flip), `${formatSquare(flip)!}`).toBe(opponent(player));
                }
            }
        }
    });
});

describe("listFlips: isLegalMove との整合", () => {
    it("反転する石があることと合法手であることは常に一致する", () => {
        const board = boardOf([
            "........",
            "...bw...",
            "..bwb...",
            "...wbw..",
            "..b.w...",
            "........",
            "........",
            "........",
        ]);

        for (const player of ["black", "white"] as const) {
            for (let row = 0; row < BOARD_SIZE; row++) {
                for (let col = 0; col < BOARD_SIZE; col++) {
                    const coord = { row, col };

                    expect(
                        listFlips(board, coord, player).length > 0,
                        `${formatSquare(coord)!} (${player})`,
                    ).toBe(isLegalMove(board, coord, player));
                }
            }
        }
    });
});

describe("listFlips: 副作用がない", () => {
    it("列挙しても盤面の内容が変わらない", () => {
        const board = createInitialBoard();
        const before = JSON.stringify(board);

        for (const player of ["black", "white"] as const) {
            for (const coord of listLegalMoves(board, player)) {
                listFlips(board, coord, player);
            }
        }

        expect(JSON.stringify(board)).toBe(before);
    });
});

describe("applyMove: 盤面の更新", () => {
    it("着手点に自分の石を置き、挟んだ石を反転する", () => {
        const next = moveAt(createInitialBoard(), "d3", "black");

        expect(rowsOf(next)).toEqual([
            "........",
            "........",
            "...b....",
            "...bb...",
            "...bw...",
            "........",
            "........",
            "........",
        ]);
    });

    it("一直線に連続する 6 枚をまとめて反転する", () => {
        // a1=黒, b1〜g1=白。黒が h1 に置くと 1 行がすべて黒になる
        const board = boardOf(["bwwwwww.", ...EMPTY_ROWS.slice(1)]);

        expect(rowsOf(moveAt(board, "h1", "black"))[0]).toBe("bbbbbbbb");
    });

    it("複数方向の石を同時に反転する", () => {
        const board = boardOf([
            "........",
            "........",
            "........",
            "....wb..",
            "...w....",
            "...b....",
            "........",
            "........",
        ]);

        expect(rowsOf(moveAt(board, "d4", "black"))).toEqual([
            "........",
            "........",
            "........",
            "...bbb..",
            "...b....",
            "...b....",
            "........",
            "........",
        ]);
    });

    it("着手のたびに石の合計が 1 増え、空マスが 1 減る", () => {
        const board = createInitialBoard();
        const before = countCells(board);
        const after = countCells(moveAt(board, "d3", "black"));

        expect(after.black + after.white).toBe(before.black + before.white + 1);
        expect(after.empty).toBe(before.empty - 1);
    });

    it("反転した枚数だけ自分の石が増え、相手の石が減る", () => {
        const board = createInitialBoard();
        const coord = parseSquare("d3")!;
        const flipCount = listFlips(board, coord, "black").length;
        const before = countCells(board);
        const after = countCells(applyMove(board, coord, "black"));

        // 着手点の 1 枚と、反転した枚数のぶん増える
        expect(after.black).toBe(before.black + flipCount + 1);
        expect(after.white).toBe(before.white - flipCount);
    });

    it("listFlips が返したマスがすべて自分の色になる", () => {
        const board = createInitialBoard();
        const coord = parseSquare("f5")!;
        const flips = listFlips(board, coord, "black");
        const next = applyMove(board, coord, "black");

        expect(getCell(next, coord)).toBe("black");
        for (const flip of flips) {
            expect(getCell(next, flip), `${formatSquare(flip)!}`).toBe("black");
        }
    });
});

describe("applyMove: 不変性", () => {
    it("元の盤面を破壊しない", () => {
        const board = createInitialBoard();
        const before = JSON.stringify(board);

        moveAt(board, "d3", "black");

        expect(JSON.stringify(board)).toBe(before);
    });

    it("元の盤面とは別のインスタンスを返す", () => {
        const board = createInitialBoard();
        const next = moveAt(board, "d3", "black");

        expect(next).not.toBe(board);
        for (let row = 0; row < BOARD_SIZE; row++) {
            expect(next[row]).not.toBe(board[row]);
        }
    });

    it("返す盤面は外側の配列も各行も凍結されている", () => {
        const next = moveAt(createInitialBoard(), "d3", "black");

        expect(Object.isFrozen(next)).toBe(true);
        for (const row of next) {
            expect(Object.isFrozen(row)).toBe(true);
        }
    });
});

describe("applyMove: 非合法な着手", () => {
    it("既に石があるマスへの着手は IllegalMoveError を投げる", () => {
        const board = createInitialBoard();

        expect(() => moveAt(board, "d4", "black")).toThrow(IllegalMoveError);
    });

    it("挟めないマスへの着手は IllegalMoveError を投げる", () => {
        const board = createInitialBoard();

        expect(() => moveAt(board, "a1", "black")).toThrow(IllegalMoveError);
    });

    it("盤外の座標への着手は IllegalMoveError を投げる", () => {
        const board = createInitialBoard();

        expect(() => applyMove(board, { row: -1, col: 0 }, "black")).toThrow(IllegalMoveError);
        expect(() => applyMove(board, { row: 0, col: BOARD_SIZE }, "black")).toThrow(
            IllegalMoveError,
        );
    });

    it("エラーは着手しようとした座標と色を保持する", () => {
        const coord = parseSquare("d4")!;
        const error = caught(() => applyMove(createInitialBoard(), coord, "black"));

        expect(error).toBeInstanceOf(IllegalMoveError);
        expect(error).toBeInstanceOf(Error);
        expect((error as IllegalMoveError).name).toBe("IllegalMoveError");
        expect((error as IllegalMoveError).coord).toEqual(coord);
        expect((error as IllegalMoveError).player).toBe("black");
    });

    it("エラーメッセージに座標表記と色が含まれる", () => {
        const error = caught(() => moveAt(createInitialBoard(), "d4", "black"));

        expect((error as IllegalMoveError).message).toBe("非合法な着手です: d4 (black)");
    });

    it("盤外の座標では内部インデックスをメッセージに用いる", () => {
        const error = caught(() => applyMove(createInitialBoard(), { row: -1, col: 0 }, "white"));

        expect((error as IllegalMoveError).message).toBe("非合法な着手です: row=-1, col=0 (white)");
    });

    it("例外を投げても盤面の内容が変わらない", () => {
        const board = createInitialBoard();
        const before = JSON.stringify(board);

        expect(() => moveAt(board, "d4", "black")).toThrow(IllegalMoveError);

        expect(JSON.stringify(board)).toBe(before);
    });

    it("合法手はすべて例外を投げずに適用できる", () => {
        const board = createInitialBoard();

        for (const player of ["black", "white"] as const) {
            for (const coord of listLegalMoves(board, player)) {
                const square = formatSquare(coord)!;

                expect(() => applyMove(board, coord, player), square).not.toThrow();
            }
        }
    });
});

describe("applyMove: 連続した着手", () => {
    it("交互に着手しても石の合計と空マスの関係が保たれる", () => {
        let board = createInitialBoard();
        let player: Player = "black";

        for (let turn = 0; turn < 10; turn++) {
            const moves = listLegalMoves(board, player);
            // 打てない側はパスとして扱い、盤面を変えずに手番だけ渡す
            if (moves.length > 0) {
                const before = countCells(board);

                board = applyMove(board, moves[0]!, player);

                const after = countCells(board);
                expect(after.black + after.white).toBe(before.black + before.white + 1);
                expect(after.empty).toBe(before.empty - 1);
            }
            player = opponent(player);
        }

        const count = countCells(board);
        expect(count.black + count.white + count.empty).toBe(BOARD_SIZE * BOARD_SIZE);
    });

    it("同じ手順を 2 回適用すると同じ盤面になる", () => {
        const first = moveAt(moveAt(createInitialBoard(), "d3", "black"), "c3", "white");
        const second = moveAt(moveAt(createInitialBoard(), "d3", "black"), "c3", "white");

        expect(rowsOf(first)).toEqual(rowsOf(second));
    });
});
