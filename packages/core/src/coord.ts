/**
 * 座標系。盤の大きさと、座標表記(a1~h8)と内部インデックス(row / col)の
 * 相互変換を担う。
 *
 * 盤上かどうかの判定はこのファイルの責務とし、マスの中身は扱わない。
 * 盤面データそのものは`board.ts`を参照
 *
 * 依存は`type.ts`のみ。coreの中で最下層に位置する。
 */

import type { Coord, Square } from "./type.ts";

/** 盤面の一辺のマス数。オセロの標準ルールに従い 8 とする */
export const BOARD_SIZE = 8;

/** 列 a〜h。添字が内部インデックスの col に対応する */
const FILES = "abcdefgh";

/** 行 1〜8。添字が内部インデックスの row に対応する */
const RANKS = "12345678";

/**
 * 内部インデックスが盤上（row / col とも 0〜7 の整数）を指しているか判定する。
 * 小数・NaN・Infinity はすべて盤外として扱う。
 * @param coord 判定する内部インデックス
 * @returns 盤上を指していれば true
 */
export function isOnBoard(coord: Coord): boolean {
    const { row, col } = coord;
    return (
        Number.isInteger(row) &&
        row >= 0 &&
        row < BOARD_SIZE &&
        Number.isInteger(col) &&
        col >= 0 &&
        col < BOARD_SIZE
    );
}

/**
 * 座標表記（a1〜h8）を内部インデックスへ変換する。
 * 受け付けるのは半角小文字 2 文字のみで、大文字や全角の正規化は入力層の責務とする。
 * @param square 変換する座標表記
 * @returns 対応する内部インデックス。盤外・不正な表記の場合は例外を投げず null
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
 * @param coord 変換する内部インデックス
 * @returns 対応する座標表記。盤外の場合は例外を投げず null
 */
export function formatSquare(coord: Coord): Square | null {
    if (!isOnBoard(coord)) return null;

    return `${FILES[coord.col]!}${RANKS[coord.row]!}` as Square;
}

/**
 * 文字列が盤上の座標表記（a1〜h8）かどうかを判定する型ガード。
 * @param value 判定する文字列
 * @returns 盤上の座標表記であれば true
 */
export function isSquare(value: string): value is Square {
    return parseSquare(value) !== null;
}
