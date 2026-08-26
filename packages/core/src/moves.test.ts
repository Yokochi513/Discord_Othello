/**
 * moves.ts のテスト。8 方向の方向ベクトルと 1 方向ぶんの走査、
 * 指定マスが合法手かの判定、合法手の列挙と有無の判定を検証する。
 *
 * 盤面の生成やマスの参照そのものは board.test.ts の責務とし、
 * ここでは検証済みの board.ts / coord.ts をテスト用ヘルパー経由で利用する。
 */

import { describe, expect, it } from "vitest";
import { createInitialBoard, freezeBoard, getCell } from "./board.js";
import type { Board } from "./board.js";
import { BOARD_SIZE, formatSquare, parseSquare } from "./coord.js";
import {
    DIRECTIONS,
    hasLegalMove,
    isLegalMove,
    listFlipsInDirection,
    listLegalMoves,
    step,
} from "./moves.js";
import type { Cell, Coord, Direction, Player, Square } from "./type.js";

/**
 * 文字列から盤面を組み立てるテスト用ヘルパー。
 * 1 行が盤面の 1 行に対応し、. = 空 / b = 黒 / w = 白 を表す。
 */
function boardOf(rows: readonly string[]): Board {
    const cellByChar: Record<string, Cell> = { ".": "empty", b: "black", w: "white" };
    return freezeBoard(rows.map((row) => [...row].map((char) => cellByChar[char]!)));
}

/** 空の盤面 8 行ぶん。必要な行だけ差し替えて使う */
const EMPTY_ROWS = Array.from({ length: BOARD_SIZE }, () => "........");

/** 座標表記で合法手かを判定するテスト用ヘルパー */
function legalAt(board: Board, square: Square, player: Player): boolean {
    return isLegalMove(board, parseSquare(square)!, player);
}

/**
 * 合法手の一覧を座標表記へ変換するテスト用ヘルパー。
 * 走査順そのものを検証するため、並べ替えはしない。
 */
function toSquares(coords: readonly Coord[]): Square[] {
    return coords.map((coord) => formatSquare(coord)!);
}

/** 上方向（row が減る側）。1 方向ぶんの走査を検証するために名前を付ける */
const UP: Direction = { rowDelta: -1, colDelta: 0 };

/** 下方向（row が増える側） */
const DOWN: Direction = { rowDelta: 1, colDelta: 0 };

/** 左方向（col が減る側） */
const LEFT: Direction = { rowDelta: 0, colDelta: -1 };

/** 右方向（col が増える側） */
const RIGHT: Direction = { rowDelta: 0, colDelta: 1 };

/** 右下方向（斜め） */
const DOWN_RIGHT: Direction = { rowDelta: 1, colDelta: 1 };

/**
 * 座標表記で 1 方向ぶんの反転石を列挙するテスト用ヘルパー。
 * 走査順そのものを検証するため、並べ替えはしない。
 */
function flipsToward(board: Board, square: Square, direction: Direction, player: Player): Square[] {
    return toSquares(listFlipsInDirection(board, parseSquare(square)!, direction, player));
}

/** 盤上の全マスを走査し、合法手の座標表記を昇順で返す */
function legalSquares(board: Board, player: Player): Square[] {
    const squares: Square[] = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            if (isLegalMove(board, { row, col }, player)) {
                squares.push(formatSquare({ row, col })!);
            }
        }
    }
    return squares.sort();
}

describe("DIRECTIONS", () => {
    it("縦横斜めの 8 方向を持つ", () => {
        expect(DIRECTIONS).toHaveLength(8);
    });

    it("各成分は -1 / 0 / 1 のいずれか", () => {
        for (const { rowDelta, colDelta } of DIRECTIONS) {
            expect([-1, 0, 1]).toContain(rowDelta);
            expect([-1, 0, 1]).toContain(colDelta);
        }
    });

    it("その場に留まる (0, 0) を含まない", () => {
        for (const { rowDelta, colDelta } of DIRECTIONS) {
            expect(rowDelta === 0 && colDelta === 0).toBe(false);
        }
    });

    it("同じ方向が重複しない", () => {
        const keys = DIRECTIONS.map(({ rowDelta, colDelta }) => `${rowDelta},${colDelta}`);

        expect(new Set(keys).size).toBe(DIRECTIONS.length);
    });
});

describe("step", () => {
    it("方向ベクトルのぶんだけ座標を進める", () => {
        expect(step({ row: 3, col: 4 }, RIGHT)).toEqual({ row: 3, col: 5 });
        expect(step({ row: 3, col: 4 }, LEFT)).toEqual({ row: 3, col: 3 });
        expect(step({ row: 3, col: 4 }, UP)).toEqual({ row: 2, col: 4 });
        expect(step({ row: 3, col: 4 }, DOWN)).toEqual({ row: 4, col: 4 });
        expect(step({ row: 3, col: 4 }, DOWN_RIGHT)).toEqual({ row: 4, col: 5 });
    });

    it("DIRECTIONS のどの方向でも成分ぶんだけ進む", () => {
        const origin: Coord = { row: 4, col: 4 };

        for (const direction of DIRECTIONS) {
            expect(step(origin, direction)).toEqual({
                row: origin.row + direction.rowDelta,
                col: origin.col + direction.colDelta,
            });
        }
    });

    it("盤外へはみ出す座標もそのまま返す（盤上判定は行わない）", () => {
        expect(step({ row: 0, col: 0 }, UP)).toEqual({ row: -1, col: 0 });
        expect(step({ row: 0, col: 0 }, LEFT)).toEqual({ row: 0, col: -1 });
        expect(step({ row: BOARD_SIZE - 1, col: BOARD_SIZE - 1 }, DOWN_RIGHT)).toEqual({
            row: BOARD_SIZE,
            col: BOARD_SIZE,
        });
    });

    it("元の座標を書き換えず、別のオブジェクトを返す", () => {
        const coord: Coord = { row: 3, col: 4 };
        const next = step(coord, RIGHT);

        expect(coord).toEqual({ row: 3, col: 4 });
        expect(next).not.toBe(coord);
    });

    it("逆向きの方向で進め直すと元の座標に戻る", () => {
        const coord: Coord = { row: 2, col: 5 };

        for (const { rowDelta, colDelta } of DIRECTIONS) {
            const back = step(step(coord, { rowDelta, colDelta }), {
                rowDelta: -rowDelta,
                colDelta: -colDelta,
            });

            expect(back).toEqual(coord);
        }
    });
});

describe("listFlipsInDirection: 挟める方向", () => {
    it("指定方向の相手の石を着手点に近い順で返す", () => {
        // a1=黒, b1=白, c1=白, d1=黒。a1 から右へ 2 枚挟める
        const board = boardOf(["bwwb....", ...EMPTY_ROWS.slice(1)]);

        expect(flipsToward(board, "a1", RIGHT, "black")).toEqual(["b1", "c1"]);
    });

    it("逆向きの方向からも同じ石を挟める", () => {
        const board = boardOf(["bwwb....", ...EMPTY_ROWS.slice(1)]);

        expect(flipsToward(board, "d1", LEFT, "black")).toEqual(["c1", "b1"]);
    });

    it("縦方向も同様に挟める", () => {
        // a1=黒, a2=白, a3=白, a4=黒
        const board = boardOf([
            "b.......",
            "w.......",
            "w.......",
            "b.......",
            ...EMPTY_ROWS.slice(4),
        ]);

        expect(flipsToward(board, "a1", DOWN, "black")).toEqual(["a2", "a3"]);
        expect(flipsToward(board, "a4", UP, "black")).toEqual(["a3", "a2"]);
    });

    it("斜め方向も同様に挟める", () => {
        // a1=黒, b2=白, c3=白, d4=黒
        const board = boardOf([
            "b.......",
            ".w......",
            "..w.....",
            "...b....",
            ...EMPTY_ROWS.slice(4),
        ]);

        expect(flipsToward(board, "a1", DOWN_RIGHT, "black")).toEqual(["b2", "c3"]);
    });

    it("指定した方向の石だけを返し、他の方向の石は含まない", () => {
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

        expect(flipsToward(board, "d4", RIGHT, "black")).toEqual(["e4"]);
        expect(flipsToward(board, "d4", DOWN, "black")).toEqual(["d5"]);
        expect(flipsToward(board, "d4", UP, "black")).toEqual([]);
    });

    it("手番の色を入れ替えると挟めなくなる", () => {
        const board = boardOf(["bwwb....", ...EMPTY_ROWS.slice(1)]);

        expect(flipsToward(board, "a1", RIGHT, "white")).toEqual([]);
    });

    it("着手点が空マスかどうかは判定しない（呼び出し側の責務）", () => {
        // a1 には既に黒石があるが、右方向の走査結果はそのまま返す
        const board = boardOf(["bwwb....", ...EMPTY_ROWS.slice(1)]);

        expect(getCell(board, parseSquare("a1")!)).toBe("black");
        expect(flipsToward(board, "a1", RIGHT, "black")).toEqual(["b1", "c1"]);
    });
});

describe("listFlipsInDirection: 挟めない方向", () => {
    it("隣が自分の石なら空配列を返す（0 枚挟み）", () => {
        // a1=黒, b1=黒。c1 から左へ進んでも相手の石が 1 枚も無い
        const board = boardOf(["bb......", ...EMPTY_ROWS.slice(1)]);

        expect(flipsToward(board, "c1", LEFT, "black")).toEqual([]);
    });

    it("隣が空マスなら空配列を返す", () => {
        // b1=空, c1=白, d1=黒。a1 の右隣が空マスで走査が始まらない
        const board = boardOf(["..wb....", ...EMPTY_ROWS.slice(1)]);

        expect(flipsToward(board, "a1", RIGHT, "black")).toEqual([]);
    });

    it("相手の石の並びの先が空マスなら空配列を返す", () => {
        // a1=空, b1=白, c1=白。d1 から左へ進むと空マスで閉じられない
        const board = boardOf([".ww.....", ...EMPTY_ROWS.slice(1)]);

        expect(flipsToward(board, "d1", LEFT, "black")).toEqual([]);
    });

    it("相手の石が盤端まで続く方向は空配列を返す", () => {
        // g1=白, h1=白。f1 から右へ進むと盤外に出て閉じられない
        const board = boardOf(["......ww", ...EMPTY_ROWS.slice(1)]);

        expect(flipsToward(board, "f1", RIGHT, "black")).toEqual([]);
    });

    it("盤端の外へ向かう方向は空配列を返す（反対側へ回り込まない）", () => {
        // g1=黒, h1=白。a1 から左へ回り込めば h1(白) → g1(黒) で挟めてしまう
        const board = boardOf(["......bw", ...EMPTY_ROWS.slice(1)]);

        expect(flipsToward(board, "a1", LEFT, "black")).toEqual([]);
        expect(flipsToward(board, "a1", UP, "black")).toEqual([]);
    });
});

describe("listFlipsInDirection: isLegalMove との整合", () => {
    it("8 方向のいずれかで挟めることと合法手であることは常に一致する", () => {
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
                    const coord: Coord = { row, col };
                    // isLegalMove は空マスであることも条件に含む
                    const flippable =
                        getCell(board, coord) === "empty" &&
                        DIRECTIONS.some(
                            (direction) =>
                                listFlipsInDirection(board, coord, direction, player).length > 0,
                        );

                    expect(flippable, `${formatSquare(coord) ?? `${row},${col}`} (${player})`).toBe(
                        isLegalMove(board, coord, player),
                    );
                }
            }
        }
    });
});

describe("listFlipsInDirection: 副作用がない", () => {
    it("走査しても盤面の内容が変わらない", () => {
        const board = createInitialBoard();
        const before = JSON.stringify(board);

        for (const direction of DIRECTIONS) {
            listFlipsInDirection(board, parseSquare("d3")!, direction, "black");
        }

        expect(JSON.stringify(board)).toBe(before);
    });
});

describe("isLegalMove: 初期盤面", () => {
    it("黒の合法手は c4 / d3 / e6 / f5 のちょうど 4 つ", () => {
        expect(legalSquares(createInitialBoard(), "black")).toEqual(["c4", "d3", "e6", "f5"]);
    });

    it("白の合法手は c5 / d6 / e3 / f4 のちょうど 4 つ", () => {
        expect(legalSquares(createInitialBoard(), "white")).toEqual(["c5", "d6", "e3", "f4"]);
    });
});

describe("isLegalMove: 置けないマス", () => {
    it("既に石があるマスは合法手にならない", () => {
        const board = createInitialBoard();

        for (const square of ["d4", "e4", "d5", "e5"] as const) {
            expect(legalAt(board, square, "black"), `${square} は着手済み`).toBe(false);
            expect(legalAt(board, square, "white"), `${square} は着手済み`).toBe(false);
        }
    });

    it("盤外の座標は合法手にならない", () => {
        const board = createInitialBoard();

        expect(isLegalMove(board, { row: -1, col: 0 }, "black")).toBe(false);
        expect(isLegalMove(board, { row: 0, col: -1 }, "black")).toBe(false);
        expect(isLegalMove(board, { row: BOARD_SIZE, col: 0 }, "black")).toBe(false);
        expect(isLegalMove(board, { row: 0, col: BOARD_SIZE }, "black")).toBe(false);
    });

    it("小数・NaN・Infinity の座標は合法手にならない", () => {
        const board = createInitialBoard();

        expect(isLegalMove(board, { row: 2.5, col: 3 }, "black")).toBe(false);
        expect(isLegalMove(board, { row: Number.NaN, col: 3 }, "black")).toBe(false);
        expect(isLegalMove(board, { row: 2, col: Number.POSITIVE_INFINITY }, "black")).toBe(false);
    });

    it("石が 1 つも無い盤面には合法手が存在しない", () => {
        const board = boardOf(EMPTY_ROWS);

        expect(legalSquares(board, "black")).toEqual([]);
        expect(legalSquares(board, "white")).toEqual([]);
    });
});

describe("isLegalMove: 挟めない配置", () => {
    it("隣が自分の石だけの方向は挟めない（0 枚挟み）", () => {
        // a1=黒, b1=黒。黒が c1 に置いても相手の石を 1 枚も挟めない
        const board = boardOf(["bb......", ...EMPTY_ROWS.slice(1)]);

        expect(legalAt(board, "c1", "black")).toBe(false);
    });

    it("隣が空マスの方向は挟めない", () => {
        // b1=空, c1=白, d1=黒。黒が a1 に置いても隣が空マスで走査が始まらない
        const board = boardOf(["..wb....", ...EMPTY_ROWS.slice(1)]);

        expect(legalAt(board, "a1", "black")).toBe(false);
    });

    it("相手の石の並びの先が空マスなら挟めない", () => {
        // a1=空, b1=白, c1=白。黒が d1 に置いても左端が空マスで閉じられない
        const board = boardOf([".ww.....", ...EMPTY_ROWS.slice(1)]);

        expect(legalAt(board, "d1", "black")).toBe(false);
    });

    it("相手の石が盤端まで続く方向は挟めない", () => {
        // g1=白, h1=白。黒が f1 に置いても右端が盤外で閉じられない
        const board = boardOf(["......ww", ...EMPTY_ROWS.slice(1)]);

        expect(legalAt(board, "f1", "black")).toBe(false);
    });
});

describe("isLegalMove: 盤端で反対側へ回り込まない", () => {
    it("左方向の走査が右端へ回り込まない", () => {
        // g1=黒, h1=白。a1 から左へ回り込めば h1(白) → g1(黒) で挟めてしまう
        const board = boardOf(["......bw", ...EMPTY_ROWS.slice(1)]);

        expect(legalAt(board, "a1", "black")).toBe(false);
    });

    it("右方向の走査が左端へ回り込まない", () => {
        // a1=白, b1=黒。h1 から右へ回り込めば a1(白) → b1(黒) で挟めてしまう
        const board = boardOf(["wb......", ...EMPTY_ROWS.slice(1)]);

        expect(legalAt(board, "h1", "black")).toBe(false);
    });

    it("上方向の走査が下端へ回り込まない", () => {
        // a7=黒, a8=白。a1 から上へ回り込めば a8(白) → a7(黒) で挟めてしまう
        const board = boardOf([...EMPTY_ROWS.slice(0, 6), "b.......", "w......."]);

        expect(legalAt(board, "a1", "black")).toBe(false);
    });

    it("下方向の走査が上端へ回り込まない", () => {
        // a1=白, a2=黒。a8 から下へ回り込めば a1(白) → a2(黒) で挟めてしまう
        const board = boardOf(["w.......", "b.......", ...EMPTY_ROWS.slice(2)]);

        expect(legalAt(board, "a8", "black")).toBe(false);
    });
});

describe("isLegalMove: 挟める配置", () => {
    it("横方向に 1 枚挟める", () => {
        // b1=白, c1=黒。黒が a1 に置くと b1 を挟める
        const board = boardOf([".wb.....", ...EMPTY_ROWS.slice(1)]);

        expect(legalAt(board, "a1", "black")).toBe(true);
    });

    it("縦方向に 1 枚挟める", () => {
        // a2=白, a3=黒。黒が a1 に置くと a2 を挟める
        const board = boardOf(["........", "w.......", "b.......", ...EMPTY_ROWS.slice(3)]);

        expect(legalAt(board, "a1", "black")).toBe(true);
    });

    it("斜め方向に 1 枚挟める", () => {
        // b2=白, c3=黒。黒が a1 に置くと b2 を挟める
        const board = boardOf(["........", ".w......", "..b.....", ...EMPTY_ROWS.slice(3)]);

        expect(legalAt(board, "a1", "black")).toBe(true);
    });

    it("盤の一辺いっぱいの 6 枚を挟める", () => {
        // a1=黒, b1〜g1=白。黒が h1 に置くと 6 枚まとめて挟める
        const board = boardOf(["bwwwwww.", ...EMPTY_ROWS.slice(1)]);

        expect(legalAt(board, "h1", "black")).toBe(true);
    });

    it("複数方向で同時に挟める配置も合法手になる", () => {
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

        expect(legalAt(board, "d4", "black")).toBe(true);
    });

    it("手番の色を入れ替えると判定も入れ替わる", () => {
        // b1=白, c1=黒。a1 は黒にとって合法手だが、白にとっては挟めない
        const board = boardOf([".wb.....", ...EMPTY_ROWS.slice(1)]);

        expect(legalAt(board, "a1", "black")).toBe(true);
        expect(legalAt(board, "a1", "white")).toBe(false);
    });
});

describe("isLegalMove: 副作用がない", () => {
    it("判定しても盤面の内容が変わらない", () => {
        const board = createInitialBoard();
        const before = JSON.stringify(board);

        legalSquares(board, "black");
        legalSquares(board, "white");

        expect(JSON.stringify(board)).toBe(before);
    });
});

describe("listLegalMoves", () => {
    it("初期盤面の黒の合法手を a1 -> h8 の順で返す", () => {
        expect(toSquares(listLegalMoves(createInitialBoard(), "black"))).toEqual([
            "d3",
            "c4",
            "f5",
            "e6",
        ]);
    });

    it("初期盤面の白の合法手を a1 -> h8 の順で返す", () => {
        expect(toSquares(listLegalMoves(createInitialBoard(), "white"))).toEqual([
            "e3",
            "f4",
            "c5",
            "d6",
        ]);
    });

    it("合法手が無い盤面では空配列を返す", () => {
        const board = boardOf(EMPTY_ROWS);

        expect(listLegalMoves(board, "black")).toEqual([]);
        expect(listLegalMoves(board, "white")).toEqual([]);
    });

    it("合法手が 1 つだけの盤面ではその 1 つを返す", () => {
        // b1=白, c1=黒。黒が挟めるのは a1 のみ
        const board = boardOf([".wb.....", ...EMPTY_ROWS.slice(1)]);

        expect(toSquares(listLegalMoves(board, "black"))).toEqual(["a1"]);
    });

    it("走査順は row 昇順・col 昇順で単調に増加する", () => {
        const moves = listLegalMoves(createInitialBoard(), "black");

        expect(moves.length).toBeGreaterThan(1);
        for (let i = 1; i < moves.length; i++) {
            const prev = moves[i - 1]!;
            const current = moves[i]!;

            expect(prev.row * BOARD_SIZE + prev.col).toBeLessThan(
                current.row * BOARD_SIZE + current.col,
            );
        }
    });

    // listLegalMoves を最適化した実装に差し替えても、isLegalMove との整合が崩れないよう固定する
    it("isLegalMove を全マスに適用した結果と一致する", () => {
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
            expect(toSquares(listLegalMoves(board, player)).sort()).toEqual(
                legalSquares(board, player),
            );
        }
    });

    it("返す座標はすべて空マスであり、isLegalMove が true になる", () => {
        const board = createInitialBoard();

        for (const coord of listLegalMoves(board, "black")) {
            const square = formatSquare(coord)!;

            expect(getCell(board, coord), `${square} は空であること`).toBe("empty");
            expect(isLegalMove(board, coord, "black"), `${square} は合法手であること`).toBe(true);
        }
    });

    it("列挙しても盤面の内容が変わらない", () => {
        const board = createInitialBoard();
        const before = JSON.stringify(board);

        listLegalMoves(board, "black");
        listLegalMoves(board, "white");

        expect(JSON.stringify(board)).toBe(before);
    });
});

describe("hasLegalMove", () => {
    it("初期盤面では黒も白も打てる", () => {
        const board = createInitialBoard();

        expect(hasLegalMove(board, "black")).toBe(true);
        expect(hasLegalMove(board, "white")).toBe(true);
    });

    it("石が 1 つも無い盤面では打てない", () => {
        const board = boardOf(EMPTY_ROWS);

        expect(hasLegalMove(board, "black")).toBe(false);
        expect(hasLegalMove(board, "white")).toBe(false);
    });

    it("盤面が石で埋まっていれば打てない", () => {
        const board = boardOf(Array.from({ length: BOARD_SIZE }, () => "bbbbwwww"));

        expect(hasLegalMove(board, "black")).toBe(false);
        expect(hasLegalMove(board, "white")).toBe(false);
    });

    it("空マスが残っていても挟めなければ両者とも打てない（終局）", () => {
        // a1=黒, b1=黒のみ。白は黒を挟めず、黒は挟む相手の石が無い
        const board = boardOf(["bb......", ...EMPTY_ROWS.slice(1)]);

        expect(hasLegalMove(board, "black")).toBe(false);
        expect(hasLegalMove(board, "white")).toBe(false);
    });

    it("合法手が 1 つだけでも true を返す", () => {
        // b1=白, c1=黒。黒が挟めるのは a1 のみ
        const board = boardOf([".wb.....", ...EMPTY_ROWS.slice(1)]);

        expect(listLegalMoves(board, "black")).toHaveLength(1);
        expect(hasLegalMove(board, "black")).toBe(true);
    });

    it("listLegalMoves の件数と常に整合する", () => {
        const boards = [
            createInitialBoard(),
            boardOf(EMPTY_ROWS),
            boardOf([".wb.....", ...EMPTY_ROWS.slice(1)]),
            boardOf(["bb......", ...EMPTY_ROWS.slice(1)]),
        ];

        for (const board of boards) {
            for (const player of ["black", "white"] as const) {
                expect(hasLegalMove(board, player)).toBe(listLegalMoves(board, player).length > 0);
            }
        }
    });
});
