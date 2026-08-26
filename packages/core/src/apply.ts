/**
 * 着手の適用。着手によって反転する石の列挙と
 * 反転を反映した新しい盤面の生成を担う。
 *
 * 非合法な着手は適用せず`IllegalMoveError`を投げる。サーバー権威のため、
 * 不正な入力がここを通り抜けて盤面を書き換えることはない。
 *
 * 手番の遷移・パス・終局の判定はここでは行わず、この結果を利用する側に置く。
 *
 * `board.ts`,`coord.ts`,`player.ts`,`moves.ts`に依存する。
 */

import { freezeBoard, getCell, type Board } from "./board.js";
import { formatSquare } from "./coord.js";
import { DIRECTIONS, listFlipsInDirection } from "./moves.js";
import type { Cell, Coord, Player } from "./type.js";

/** 非合法な着手が適用されようとしたことを表すエラー */
export class IllegalMoveError extends Error {
    /** 着手しようとしたマスの内部インデックス */
    readonly coord: Coord;
    /** 着手しようとした側の色 */
    readonly player: Player;

    /**
     * 非合法な着手を表すエラーを生成する。
     * @param coord 着手しようとしたマスの内部インデックス
     * @param player 着手しようとした側の色
     */
    constructor(coord: Coord, player: Player) {
        const square = formatSquare(coord) ?? `row=${coord.row}, col=${coord.col}`;
        super(`非合法な着手です: ${square} (${player})`);
        this.name = "IllegalMoveError";
        this.coord = coord;
        this.player = player;
    }
}

/**
 * 着手によって反転する石をすべて列挙する。
 * 走査順はDIRECTIONSの並び(左上->右下)で、各方向内は着手点に近い順。
 * @param board 対象の盤面
 * @param coord 着手するマスの内部インデックス
 * @param player 着手する側の色
 * @returns 反転するマスの一覧。着手が非合法な場合は空配列
 */
export function listFlips(board: Board, coord: Coord, player: Player): readonly Coord[] {
    // 盤外、または既に石があるマスにはおけない
    if (getCell(board, coord) !== "empty") return [];

    return DIRECTIONS.flatMap((direction) => listFlipsInDirection(board, coord, direction, player));
}

/**
 * 着手を適用した新しい盤面を返す。元のboardは破壊しない。
 * @param board 対象の盤面
 * @param coord 着手するマスの内部インデックス
 * @param player 着手する側の色
 * @returns 着手点と反転を反映した凍結済みの新しい盤面
 * @throws {IllegalMoveError} 着手が非合法な場合
 */
export function applyMove(board: Board, coord: Coord, player: Player): Board {
    const flips = listFlips(board, coord, player);
    // 合法手なら必ず1枚以上反転するので、空=非合法
    if (flips.length === 0) throw new IllegalMoveError(coord, player);

    const next: Cell[][] = board.map((row) => [...row]);
    next[coord.row]![coord.col] = player;
    for (const flip of flips) {
        next[flip.row]![flip.col] = player;
    }

    return freezeBoard(next);
}
