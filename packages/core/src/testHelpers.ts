/**
 * テスト専用の盤面組み立てヘルパー。
 * 各 *.test.ts で重複していた盤面組み立て処理を共通化する。
 *
 * 本体コード（*.test.ts 以外）からは参照しないこと。
 */

import { freezeBoard, type Board } from "./board.js";
import { BOARD_SIZE } from "./coord.js";
import type { Cell } from "./type.js";

/**
 * 文字列から盤面を組み立てる。
 * 1 行が盤面の 1 行に対応し、. = 空 / b = 黒 / w = 白 を表す。
 * @param rows 盤面の各行を表す文字列（8 行ぶん）
 * @returns 凍結済みの盤面
 */
export function boardOf(rows: readonly string[]): Board {
    const cellByChar: Record<string, Cell> = { ".": "empty", b: "black", w: "white" };
    return freezeBoard(rows.map((row) => [...row].map((char) => cellByChar[char]!)));
}

/** 空の盤面 8 行ぶん。必要な行だけ差し替えて使う */
export const EMPTY_ROWS: readonly string[] = Array.from({ length: BOARD_SIZE }, () => "........");
