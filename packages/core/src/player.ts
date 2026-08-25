/**
 * 手番。先手の定義と、手番の相手色を求める処理を担う。
 *
 * 手番の進行は対局の状態遷移の責務であり、
 * ここでは色の対応関係のみを扱う。
 *
 * 依存は`type.ts`のみ。
 */

import type { Player } from "./type.ts";

/** 先手の色。オセロの標準ルールに従い黒とする */
export const FIRST_PLAYER: Player = "black";

/**
 * 手番の相手色を返す。
 * @param p 基準となる手番の色
 * @returns p と反対の色
 */
export const opponent = (p: Player): Player => (p === "black" ? "white" : "black");
