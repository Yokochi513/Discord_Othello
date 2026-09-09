/**
 * 盤面に出す内容の組み立て（要件定義 §7.3 / §7.4）。
 *
 * 対局画面と終局画面はどちらも同じ 8×8 の盤を描くため、マス 1 つ分の表示内容と
 * その並べ方をここへ置き、両画面の組み立て（gameView.ts / finishedView.ts）から使う。
 * DOM にも React にも依存しない純粋な関数として実装し、描画は Board.tsx が受け持つ。
 */

import { BOARD_SIZE, formatSquare } from "@othello/core";
import type { GameState, Square } from "@othello/protocol";

/** 盤上のマス 1 つ分の表示内容。 */
export type CellView = {
    /** マスの座標表記（a1〜h8） */
    readonly square: Square;
    /** マスに置かれている石。空マスなら "empty" */
    readonly stone: "black" | "white" | "empty";
    /** 打てるマスの印を出すか（手番側にのみ出す。要件定義 §7.3） */
    readonly legal: boolean;
    /** 直前に打たれた手か */
    readonly last: boolean;
    /** クリック／タップで着手できるか（観戦者・手番でない側は常に false） */
    readonly playable: boolean;
};

/** 打てるマスの印を出さない盤面のための空集合。終局画面のように読むだけの盤で使う。 */
export const NO_LEGAL_SQUARES: ReadonlySet<Square> = new Set<Square>();

/**
 * 盤面を a1 から h8 まで（行昇順・列昇順）の 64 マスへ並べ直す。
 * @param game 描く対局状態
 * @param legalSquares 打てるマスの印を出す座標。印を出さない盤では空集合を渡す
 * @param canPlay 今このマスをクリックして着手できる状態か
 * @returns 64 マス分の表示内容
 */
export function buildCells(
    game: GameState,
    legalSquares: ReadonlySet<Square>,
    canPlay: boolean,
): readonly CellView[] {
    const cells: CellView[] = [];

    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const square = formatSquare({ row, col });
            // 盤上の座標しか作らないため null にはならない
            if (square === null) continue;

            const legal = legalSquares.has(square);
            cells.push({
                square,
                stone: game.board[row]?.[col] ?? "empty",
                legal,
                last: game.lastMove === square,
                playable: canPlay && legal,
            });
        }
    }

    return cells;
}
