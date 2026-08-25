/**
 * 盤面のデータ構造。盤面型の定義、初期配置の生成、不変性の担保、
 * マスの参照と石数の集計を担う。
 *
 * 盤面は不変として扱い、外部へ返す盤面は必ず凍結する。
 * 合法手の判定や石の反転といったルール処理は持たず、`moves.ts`以降にゆだねる。
 *
 * `coord.ts`に依存する。
*/

import { BOARD_SIZE, isOnBoard } from "./coord";
import type { Cell, Coord, Player } from "./type.ts";

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
