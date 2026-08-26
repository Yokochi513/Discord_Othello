/**
 * 手番遷移と自動パスの判定を担う。
 *
 * 依存は`player.ts`,`type.js`,`moves.ts`,`board.ts`
 */

import type { Board } from "./board.js";
import { hasLegalMove } from "./moves.js";
import { opponent } from "./player.js";
import type { Player } from "./type.js";

/** 手番遷移の結果。パスが起きたかどうかを呼び出し側へ伝えるための判別可能なユニオン */
export type TurnResult =
    /** 通常遷移。相手に合法手があり、そのまま手番が移る */
    | { readonly kind: "next"; readonly player: Player }
    /** 自動パス。相手に合法手が無く、手番がplayer側へ戻る。passedByがパスした側 */
    | { readonly kind: "pass"; readonly player: Player; readonly passedBy: Player }
    /** 連続パス。両者とも合法手が無い。終局判定はここでは行わない */
    | { readonly kind: "bothPassed"; readonly passedBy: [Player, Player] };

/**
 * 次ターンは誰の手番なのかを返す
 * @param board 対象の盤面
 * @param lastPlayer 最後に指した側の色
 * @returns 次のターンの結果
 */
export function nextTurn(board: Board, lastPlayer: Player): TurnResult {
    const next = opponent(lastPlayer);

    // 相手に合法手がある -> 通常遷移
    if (hasLegalMove(board, next)) return { kind: "next", player: next };

    // 相手が打てず、自分が打てる
    if (hasLegalMove(board, lastPlayer))
        return { kind: "pass", player: lastPlayer, passedBy: next };

    // 両者とも打てない
    return { kind: "bothPassed", passedBy: [next, lastPlayer] };
}

/**
 * 手番遷移でパスした側を、パスが起きた順に列挙する。
 * @param result 対象の手番遷移の結果
 * @returns パスした側の一覧。パスがなければ空配列
 */
export function passedPlayers(result: TurnResult): readonly Player[] {
    switch (result.kind) {
        case "next":
            return [];
        case "pass":
            return [result.passedBy];
        case "bothPassed":
            return result.passedBy;
    }
}
