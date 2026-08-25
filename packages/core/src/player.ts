/**
 * 手番。先手の定義と、手番の相手色を求める処理を担う。
 *
 * 手番の進行は対局の状態遷移の責務であり、
 * ここでは色の対応関係のみを扱う。
 *
 * 依存は`type.ts`のみ。
 */

import type { Player } from "./type.ts";

export const FIRST_PLAYER: Player = "black";
export const opponent = (p: Player): Player => (p === "black" ? "white" : "black");
