/**
 * 終局と対局結果。終局条件の判定、石数からの勝敗判定、
 * 投了による決着の表現を担う。
 *
 * 終局条件は ①両者が連続でパス ②盤面が石で埋まる ③一方の石が 0 枚 の 3 つで、
 * いずれも盤面だけから判定できる。投了は盤面から導けない事象のため、専用の関数で扱う。
 *
 * 中断（無効試合）はサーバー側のセッション管理の責務であり、ここでは扱わない。
 *
 * `board.ts`,`coord.ts`,`moves.ts`に依存する。
 */

import { countCells, type Board } from "./board.js";
import { BOARD_SIZE } from "./coord.js";
import { hasLegalMove } from "./moves.js";
import type { GameEndReason, GameResult, Outcome, Player, Score } from "./type.js";

/**
 * 盤面が終局しているか判定し、終局していればその理由を返す。
 * 複数の理由が同時に成立する場合は shutout -> boardFull -> bothPassed の順に、
 * より具体的な理由を優先する。投了は盤面に現れないため、ここでは判定しない。
 * @param board 対象の盤面
 * @returns 終局理由。対局が続いている場合は null
 */
export function detectGameEnd(board: Board): GameEndReason | null {
    const count = countCells(board);
    // どちらかの色が0枚の場合 -> 完封
    if (count.black === 0 || count.white === 0) return "shutout";

    // 両方の色を足して埋まっている場合 -> 完封
    if (count.black + count.white === BOARD_SIZE * BOARD_SIZE) return "boardFull";

    // どちらにも合法手が無い場合
    if (!hasLegalMove(board, "black") && !hasLegalMove(board, "white")) return "bothPassed";

    // 継続中
    return null;
}

/**
 * 盤面が終局しているかを返す。終局理由が不要な場面で用いる。
 * @param board 対象の盤面
 * @returns 終局していれば true
 */
export function isGameOver(board: Board): boolean {
    if (detectGameEnd(board) !== null) return true;

    return false;
}

/**
 * 石数から勝敗を判定する。石数が多い方の勝ちとし、同数は引き分けとする。
 * @param score 判定する石数
 * @returns 勝敗。同数の場合は "draw"
 */
export function judgeOutcome(score: Score): Outcome {
    if (score.black < score.white) return "whiteWin";
    if (score.white < score.black) return "blackWin";
    return "draw";
}

/**
 * 自然終局（連続パス・盤面が埋まる・完封）による対局結果を確定する。
 * 投了による決着は盤面から判定できないため、`resignGame`を用いること。
 * @param board 対象の盤面
 * @returns 終局理由・勝敗・石数を含む対局結果。対局が続いている場合は null
 */
export function finishGame(board: Board): GameResult | null {
    const endReason = detectGameEnd(board);

    if (endReason === null) return null;

    const count = countCells(board);
    const score: Score = { black: count.black, white: count.white };

    const outCome = judgeOutcome(score);

    return { reason: endReason, outcome: outCome, score: score };
}

/**
 * 投了による対局結果を確定する。投了した側の負けとして扱う。
 * 石数は投了時点の盤面の値をそのまま記録し、残った空マスは勝者に加算しない。
 * @param board 投了時点の盤面
 * @param resigner 投了した側の色
 * @returns reason が "resign" の対局結果。勝敗は resigner の相手の勝ちとなる
 */
export function resignGame(board: Board, resigner: Player): GameResult {
    const count = countCells(board);
    const score: Score = { black: count.black, white: count.white };

    const outCome: Outcome = resigner === "black" ? "whiteWin" : "blackWin";

    return { reason: "resign", outcome: outCome, score: score };
}

/**
 * 対局結果から勝者を取り出す。画面表示や戦績の記録で用いる。
 * @param result 対象の対局結果
 * @returns 勝った側の色。引き分けの場合は null
 */
export function winnerOf(result: GameResult): Player | null {
    if (result.outcome === "blackWin") return "black";
    if (result.outcome === "whiteWin") return "white";
    return null;
}
