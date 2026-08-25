/**
 * 合法手の判定。8方向の走査を共通化し、指定マスが合法手かの判定
 * 合法手の列挙・合法手の有無の判定を担う。
 *
 * 合法手は「空マスに石を置いたとき、8方向のいずれかで相手の石を1枚以上挟めるマス」とする。
 * 捜査は盤端で必ず打ち切り、反対側へ回り込まない。
 *
 * 石の反転やパス・終局の判定はここでは行わず、このファイルの判定結果を利用する側に置く。
 *
 * `coord.ts`, `board.ts`, `player.ts`に依存する。
 */

import { getCell, type Board } from "./board.js";
import { BOARD_SIZE } from "./coord.js";
import { opponent } from "./player.js";
import type { Coord, Direction, Player } from "./type.ts";

/** 盤面の 8 方向。上下左右と斜めを 3x3 の並びで表すため、整形対象から外す */
// prettier-ignore
export const DIRECTIONS: readonly Direction[] = [
    { rowDelta: -1, colDelta: -1 }, { rowDelta: -1, colDelta: 0 }, { rowDelta: -1, colDelta: 1 },
    { rowDelta:  0, colDelta: -1 },                                { rowDelta:  0, colDelta: 1 },
    { rowDelta:  1, colDelta: -1 }, { rowDelta:  1, colDelta: 0 }, { rowDelta:  1, colDelta: 1 },
];

/**
 * 指定したマスが player にとって合法手か判定する。
 * 盤外・空でないマスは常にfalse。
 */
export function isLegalMove(board: Board, coord: Coord, player: Player): boolean {
    // 盤外、または既に石があるマスにはおけない
    if (getCell(board, coord) !== "empty") return false;

    const enemy = opponent(player);

    // 各方向をチェック
    for (const direction of DIRECTIONS) {
        let current: Coord = {
            row: coord.row + direction.rowDelta,
            col: coord.col + direction.colDelta,
        };
        let hasEnemyBetween = false;
        // カレントマスが相手の石である
        while (getCell(board, current) === enemy) {
            current = {
                row: current.row + direction.rowDelta,
                col: current.col + direction.colDelta,
            };
            hasEnemyBetween = true;
        }

        // 相手の石の並びの先が自分の石なら、この方向で挟めている。
        if (getCell(board, current) === player && hasEnemyBetween) return true;
    }

    return false;
}

/**
 * playerにとって合法手は何があるのかを列挙する。
 * 走査順は a1 -> h8 で固定する。
 * 合法手が一つもない場合はから配列を返す。
 * @param board
 * @param player
 * @returns
 */
export function listLegalMoves(board: Board, player: Player): readonly Coord[] {
    const moves: Coord[] = [];

    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const coord: Coord = { row, col };
            if (isLegalMove(board, coord, player)) moves.push(coord);
        }
    }

    return moves;
}

/**
 * playerにとって合法手が一つでもあるのか銅貨を返す。
 * @param board
 * @param player
 * @returns
 */
export function hasLegalMove(board: Board, player: Player): boolean {
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const coord: Coord = { row, col };
            if (isLegalMove(board, coord, player)) return true;
        }
    }

    return false;
}
