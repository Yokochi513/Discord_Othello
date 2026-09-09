/**
 * 終局画面に出す内容の組み立て（要件定義 §7.4 / F-10・F-19）。
 *
 * 勝敗・最終石数・最終盤面は、サーバーが確定させた対局結果をそのまま採る（要件定義 §5.4）。
 * 勝ち負けの言い回しは終局した対局の座席で決めるが、「もう一局」を押せるかどうかは
 * 現在のロビーの座席で決める。終局後に退席した人は次の対局を始められないためである。
 * DOM にも React にも依存しない純粋な関数として実装し、画面（Finished.tsx）は結果を描くだけにする。
 */

import type { GameResult, GameState, Outcome } from "@othello/protocol";

import { buildCells, NO_LEGAL_SQUARES, type CellView } from "./boardView.ts";
import { selectSeat, type ClientState, type SeatId } from "./roomState.ts";

/** 終局した対局の対局者 1 人分の表示内容。 */
export type FinishedPlayerView = {
    /** 座席の色 */
    readonly seat: SeatId;
    /** 座席の表示名（黒 / 白） */
    readonly label: string;
    /** 座席を表す石の記号 */
    readonly mark: string;
    /** Discord の表示名 */
    readonly displayName: string;
    /** 最終石数。投了で終わった場合は投了時点の石数（要件定義 §6） */
    readonly score: number;
    /** 自分自身か */
    readonly mine: boolean;
    /** 勝者か。引き分けと無効試合ではどちらも false */
    readonly winner: boolean;
};

/** 終局画面全体の表示内容。 */
export type FinishedView = {
    /** 決着の見出し（あなたの勝ち／黒の勝ち／引き分け／無効試合） */
    readonly outcomeLabel: string;
    /** 決着に至った理由（要件定義 §6） */
    readonly reasonLabel: string;
    /** 無効試合（中断・離脱）で終わり、戦績に残らないか（要件定義 §6 / F-12） */
    readonly invalid: boolean;
    /** 最終盤面。a1 から h8 まで、行昇順・列昇順に並べた 64 マス */
    readonly cells: readonly CellView[];
    /** 黒番・白番の順に並べた対局者 */
    readonly players: readonly [FinishedPlayerView, FinishedPlayerView];
    /** 対局の総手数。自動パスも 1 手として数える */
    readonly moveCount: number;
    /** 「もう一局」を出すか。再戦を操作できるのは座席に着いている側だけ（要件定義 §7.4） */
    readonly showRematch: boolean;
    /** 「もう一局」を押せるか（要件定義 F-19） */
    readonly canRematch: boolean;
    /** 「もう一局」に添える説明。押せない場合はその理由 */
    readonly rematchHint: string;
};

// 座席の色の表示名と記号（要件定義 §7.3 の対局画面に合わせる）
const SEAT_LABELS: Readonly<Record<SeatId, string>> = { black: "黒", white: "白" };
const SEAT_MARKS: Readonly<Record<SeatId, string>> = { black: "⚫", white: "⚪" };

/**
 * クライアント状態から終局画面の表示内容を組み立てる。
 * @param state 現在のクライアント状態
 * @returns 終局画面の表示内容。まだ終局した対局が無ければ null
 */
export function buildFinishedView(state: ClientState): FinishedView | null {
    const finished = state.finished;
    if (finished === null) return null;

    const { game, result } = finished;
    // 勝ち負けの言い回しは、終局した対局での自分の色で決める
    const mySeat = findSeat(game, state.userId);
    // 再戦できるかは、終局後の今どちらの席に着いているかで決める
    const lobbySeat = selectSeat(state);
    // 接続が切れている間は送信できないため、操作そのものを受け付けない（要件定義 §14 E-15）
    const connected = state.connection === "open";
    const bothSeated =
        state.room !== null && state.room.seats.black !== null && state.room.seats.white !== null;

    return {
        outcomeLabel: outcomeLabel(result.outcome, mySeat),
        reasonLabel: reasonLabel(result),
        invalid: result.outcome === null,
        // 終局後の盤面には打てるマスの印も着手の操作も出さない
        cells: buildCells(game, NO_LEGAL_SQUARES, false),
        players: [
            buildPlayerView("black", game, result, state.userId),
            buildPlayerView("white", game, result, state.userId),
        ],
        moveCount: game.moveCount,
        showRematch: lobbySeat !== null,
        canRematch: lobbySeat !== null && bothSeated && connected,
        rematchHint: rematchHint(bothSeated),
    };
}

function buildPlayerView(
    seat: SeatId,
    game: GameState,
    result: GameResult,
    userId: string | null,
): FinishedPlayerView {
    const player = game.players[seat];
    return {
        seat,
        label: SEAT_LABELS[seat],
        mark: SEAT_MARKS[seat],
        displayName: player.displayName,
        score: game.scores[seat],
        mine: player.userId === userId,
        winner: winnerSeat(result.outcome) === seat,
    };
}

// 決着を一言で伝える。対局者には自分から見た勝ち負けを、観戦者には色で示す
function outcomeLabel(outcome: Outcome | null, mySeat: SeatId | null): string {
    // 中断・離脱は勝敗を付けない無効試合として扱う（要件定義 §6）
    if (outcome === null) return "無効試合";
    if (outcome === "draw") return "引き分け";

    const winner = winnerSeat(outcome);
    if (winner === null) return "引き分け";
    if (mySeat === null) return `${SEAT_LABELS[winner]}の勝ち`;
    return mySeat === winner ? "あなたの勝ち" : "あなたの負け";
}

// 終局・投了・中断・無効試合を、それぞれの言い回しで出し分ける（要件定義 §6 / §7.4）
function reasonLabel(result: GameResult): string {
    switch (result.reason) {
        case "both_passed":
            return "両者が続けてパスしたため終局しました";
        case "board_full":
            return "盤面が埋まったため終局しました";
        case "shutout":
            return "一方の石が無くなったため終局しました";
        case "resign":
            return resignLabel(result.outcome);
        case "abort":
            return "対局が中断されました。無効試合のため戦績には残りません";
        case "disconnect":
            return "対局者が離脱しました。無効試合のため戦績には残りません";
    }
}

// 投了した側は勝者の反対側として決まる（投了には必ず勝敗が付く）
function resignLabel(outcome: Outcome | null): string {
    const winner = winnerSeat(outcome);
    if (winner === null) return "投了で決着しました";
    return `${SEAT_LABELS[winner === "black" ? "white" : "black"]}の投了で決着しました`;
}

// 「もう一局」に添える説明。押せない場合はその理由を示す
function rematchHint(bothSeated: boolean): string {
    if (!bothSeated) return "相手が席に着くと押せます";
    return "もう一局では黒白が入れ替わります";
}

function winnerSeat(outcome: Outcome | null): SeatId | null {
    if (outcome === "black_win") return "black";
    if (outcome === "white_win") return "white";
    return null;
}

// この対局で自分が着いていた座席。対局開始時の顔ぶれで決まるため、ロビーの座席では判定しない
function findSeat(game: GameState, userId: string | null): SeatId | null {
    if (userId === null) return null;
    if (game.players.black.userId === userId) return "black";
    if (game.players.white.userId === userId) return "white";
    return null;
}
