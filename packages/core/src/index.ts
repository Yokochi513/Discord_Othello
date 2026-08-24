import type { Cell, Coord, Player, Square } from "./type.ts"

export type { Cell, Coord, File, Player, Rank, Square } from "./type.ts";

/** 盤面の一辺のマス数。オセロの標準ルールに従い 8 とする */
export const BOARD_SIZE = 8;

/**
 * 盤面。board[row][col] で各マスの状態を参照する（左上が a1）。
 *
 * 盤面は不変（イミュータブル）として扱う。core が返す盤面は型の readonly に加えて
 * 実行時にも凍結されているため、着手などの操作は元の盤面を書き換えず新しい盤面を返す。
 */
export type Board = readonly (readonly Cell[])[];

/** 盤面上の石数・空マス数 */
export type CellCount = Readonly<Record<Cell, number>>;

/**
 * 盤面を実行時に凍結して不変にする（外側の配列と各行の両方）。
 * 盤面を生成・更新する処理は、呼び出し元へ返す直前にこの関数を通すこと。
 */
export function freezeBoard(board: Cell[][]): Board {
    for (const row of board) {
        Object.freeze(row);
    }
    return Object.freeze(board);
}

/** 初期盤面を返す。d4=白, e4=黒, d5=黒, e5=白 で、先手は黒 */
export function createInitialBoard(): Board {
    const board: Cell[][] = Array.from( {length: BOARD_SIZE }, () =>
        Array.from({ length: BOARD_SIZE }, (): Cell => "empty"),
    );

    board[3]![3] = "white";
    board[3]![4] = "black";
    board[4]![3] = "black";
    board[4]![4] = "white";

    return freezeBoard(board);
}

export const FIRST_PLAYER: Player = "black";
export const opponent = (p: Player): Player => (p === "black" ? "white" : "black");

/** 列 a〜h。添字が内部インデックスの col に対応する */
const FILES = "abcdefgh";

/** 行 1〜8。添字が内部インデックスの row に対応する */
const RANKS = "12345678";

/**
 * 内部インデックスが盤上（row / col とも 0〜7 の整数）を指しているか判定する。
 * 小数・NaN・Infinity はすべて盤外として扱う。
 */
export function isOnBoard(coord: Coord): boolean {
    const { row, col } = coord;
    return (
        Number.isInteger(row) && row >= 0 && row < BOARD_SIZE &&
        Number.isInteger(col) && col >= 0 && col < BOARD_SIZE
    );
}

/**
 * 座標表記（a1〜h8）を内部インデックスへ変換する。
 * 盤外・不正な表記の場合は例外を投げず null を返す。
 * 受け付けるのは半角小文字 2 文字のみで、大文字や全角の正規化は入力層の責務とする。
 */
export function parseSquare(square: string): Coord | null {
    if (square.length !== 2) return null;

    const col = FILES.indexOf(square[0]!);
    const row = RANKS.indexOf(square[1]!);
    if (col < 0 || row < 0) return null;

    return { row, col };
}

/**
 * 内部インデックスを座標表記（a1〜h8）へ変換する。
 * 盤外の場合は例外を投げず null を返す。
 */
export function formatSquare(coord: Coord): Square | null {
    if (!isOnBoard(coord)) return null;

    return `${FILES[coord.col]!}${RANKS[coord.row]!}` as Square;
}

/** 文字列が盤上の座標表記（a1〜h8）かどうかを判定する型ガード */
export function isSquare(value: string): value is Square {
    return parseSquare(value) !== null;
}

/**
 * 盤面のマスを取得する。盤外を指す座標の場合は null を返す。
 */
export function getCell(board: Board, coord: Coord): Cell | null {
    if (!isOnBoard(coord)) return null;

    return board[coord.row]![coord.col]!;
}

/**
 * 盤面の石数と空マス数を数える。
 * 終局時の勝敗判定（石数の多い方が勝ち）と、盤面が埋まったかの判定に用いる。
 */
export function countCells(board: Board): CellCount {
    const count: Record<Cell, number> = { black: 0, white: 0, empty: 0 };

    for (const row of board) {
        for (const cell of row) {
            count[cell] += 1;
        }
    }

    return count;
}

/** 指定した色の石数を数える */
export function countStones(board: Board, player: Player): number {
    return countCells(board)[player];
}
