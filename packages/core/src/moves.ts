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
 * 座標を指定方向へ1ステップ進める。
 * @param coord 起点の内部インデックス
 * @param direction 進む方向
 * @returns 1ステップ進めた後の内部インデックス。盤外になりえるため、参照時にgetCellで判定すること
 */
export function step(coord: Coord, direction: Direction): Coord {
    return {
        row: coord.row + direction.rowDelta,
        col: coord.col + direction.colDelta,
    };
}

/**
 * coordにplayerが着手したと仮定し、direction方向で挟める相手の石を列挙する。
 * 8方向の走査で共通に使う最小単位で、盤端・空マス・自石で必ず打ち切り。
 * coord自身が空マスかどうかは判定しないため、呼び出し側で保証すること。
 * @param board 対象の盤面
 * @param coord 着手するマスの内部インデックス
 * @param direction 走査する方向
 * @param player 着手する側の色
 * @returns この方向で反転する石の一覧(着手点に近い順)。挟めていない場合は空配列
 */
export function listFlipsInDirection(
    board: Board,
    coord: Coord,
    direction: Direction,
    player: Player,
): readonly Coord[] {
    const enemy = opponent(player);
    const flips: Coord[] = [];

    let current = step(coord, direction);
    // カレントマスが相手の石である間は進む
    while (getCell(board, current) === enemy) {
        flips.push(current);
        current = step(current, direction);
    }

    // 相手の石が1枚もない、またはその先が自分の石でなければ挟めない
    if (flips.length === 0 || getCell(board, current) !== player) return [];

    return flips;
}

/**
 * 指定したマスが player にとって合法手か判定する。
 * @param board 対象の盤面
 * @param coord 判定するマスの内部インデックス
 * @param player 着手する側の色
 * @returns 8 方向のいずれかで相手の石を 1 枚以上挟めれば true。盤外・空でないマスは常に false
 */
export function isLegalMove(board: Board, coord: Coord, player: Player): boolean {
    // 盤外、または既に石があるマスにはおけない
    if (getCell(board, coord) !== "empty") return false;

    return DIRECTIONS.some(
        (direction) => listFlipsInDirection(board, coord, direction, player).length > 0,
    );
}

/**
 * player にとっての合法手をすべて列挙する。
 * 走査順は a1 -> h8（row 昇順、その中で col 昇順）で固定する。
 * @param board 対象の盤面
 * @param player 着手する側の色
 * @returns 合法手の内部インデックスの一覧。1 つも無い場合は空配列（＝その手番はパス）
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
 * player にとって合法手が 1 つでもあるかを返す。
 * パス判定・終局判定（両者とも打てない）に用いる。
 * @param board 対象の盤面
 * @param player 着手する側の色
 * @returns 合法手が 1 つでもあれば true
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
