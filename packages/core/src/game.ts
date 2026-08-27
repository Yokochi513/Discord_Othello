/**
 * 対局状態モデルと棋譜の記録・再生。
 *
 * 着手適用（合法手判定 → 反転 → 手番遷移／自動パス → 終局判定）を
 * 一連の処理としてまとめ、盤面・手番・手数・棋譜を持つ`GameState`を
 * 不変な値として更新する。永続化と再接続で局面を復元する基礎となる。
 *
 * 終局は`turn`が`null`になることで表す。終局理由や勝敗は持たず、
 * 必要になれば`result.ts`の関数へ盤面を渡して求める。
 *
 * `board.ts`,`coord.ts`,`player.ts`,`apply.ts`,`turn.ts`,`result.ts`に依存する。
 */

import { applyMove } from "./apply.js";
import { createInitialBoard, freezeBoard, type Board } from "./board.js";
import { parseSquare } from "./coord.js";
import { FIRST_PLAYER } from "./player.js";
import { detectGameEnd } from "./result.js";
import { nextTurn, passedPlayers } from "./turn.js";
import type { Player, Square } from "./type.js";

/** 棋譜の1エントリ。実際の着手か自動パスかを判別する */
export type MoveEntry =
    | { readonly kind: "move"; readonly player: Player; readonly square: Square }
    | { readonly kind: "pass"; readonly player: Player };

/** 棋譜。初手から順に並んだ手の履歴（自動パスを含む） */
export type MoveLog = readonly MoveEntry[];

/** 対局状態。盤面・手番・手数・棋譜を保持する */
export type GameState = {
    readonly board: Board;
    /** 現在の手番。対局が終了している場合は null */
    readonly turn: Player | null;
    /** 経過手数。log.length と一致する（自動パスも1手として数える） */
    readonly moveCount: number;
    readonly log: MoveLog;
};

/** 座標表記として不正な文字列が渡されたことを表す */
export class InvalidSquareError extends Error {
    /** 不正な座標表記の元の文字列 */
    readonly square: string;

    /**
     * 不正な座標表記を表すエラーを生成する。
     * @param square 不正な座標表記の元の文字列
     */
    constructor(square: string) {
        super(`不正な座標表記です: ${square}`);
        this.name = "InvalidSquareError";
        this.square = square;
    }
}

/**
 * 手番でないプレイヤーが着手しようとしたことを表す。
 * expected が null の場合は対局が既に終了していることを意味する。
 */
export class NotYourTurnError extends Error {
    /** 期待される手番。対局が終了している場合は null */
    readonly expected: Player | null;
    /** 実際に着手しようとした側の色 */
    readonly actual: Player;

    /**
     * 手番違反を表すエラーを生成する。
     * @param expected 期待される手番。対局が終了している場合は null
     * @param actual 実際に着手しようとした側の色
     */
    constructor(expected: Player | null, actual: Player) {
        const expectedLabel = expected ?? "終了済み";
        super(`手番ではありません: 期待=${expectedLabel}, 実際=${actual}`);
        this.name = "NotYourTurnError";
        this.expected = expected;
        this.actual = actual;
    }
}

/**
 * 初期対局状態を生成する。初期盤面・先手番・手数 0・空の棋譜を持つ。
 * @returns 初期対局状態
 */
export function createGameState(): GameState {
    return { board: createInitialBoard(), turn: FIRST_PLAYER, moveCount: 0, log: [] };
}

/**
 * 着手を対局状態へ適用する。合法手判定 → 反転 → 手番遷移／自動パス → 終局判定を
 * 一連の処理として行い、更新後の対局状態を新しいインスタンスとして返す。
 * @param state 適用前の対局状態
 * @param player 着手する側の色
 * @param square 着手する座標表記
 * @returns 更新後の対局状態
 * @throws {NotYourTurnError} player が現在の手番と一致しない場合（対局終了後も含む）
 * @throws {InvalidSquareError} square が座標表記として不正な場合
 * @throws {IllegalMoveError} 着手が非合法な場合
 */
export function playMove(state: GameState, player: Player, square: Square): GameState {
    if (player !== state.turn) throw new NotYourTurnError(state.turn, player);

    const coord = parseSquare(square);
    if (coord === null) throw new InvalidSquareError(square);

    // 合法手判定 -> 反転
    const board = applyMove(state.board, coord, player);

    // 手番遷移/自動パス
    const turnResult = nextTurn(board, player);
    const passEntries = passedPlayers(turnResult).map((p): MoveEntry => ({
        kind: "pass",
        player: p,
    }));
    const log: MoveLog = [...state.log, { kind: "move", player, square }, ...passEntries];

    // 終局判定。shutout など nextTurn だけでは拾えない終局条件も
    // detectGameEnd を正とすることで正しく反映する
    const isOver = detectGameEnd(board) !== null;
    const turn = isOver ? null : turnResult.kind === "bothPassed" ? null : turnResult.player;

    return { board, turn, moveCount: log.length, log };
}

/**
 * 棋譜から局面を再生し、対局状態を再構築する。
 * 自動パスは盤面から一意に導出されるため、log中の pass エントリは無視して
 * move エントリのみを順に適用する。
 * @param log 再生する棋譜
 * @returns 棋譜を初手から再生した結果の対局状態
 */
export function replayGame(log: MoveLog): GameState {
    let state = createGameState();

    for (const entry of log) {
        if (entry.kind !== "move") continue;
        state = playMove(state, entry.player, entry.square);
    }

    return state;
}

/**
 * JSON からの復元など、実行時の不変性が失われた対局状態を復旧する。
 * 盤面を`freezeBoard`で再凍結した新しいインスタンスを返す。
 * @param state 復旧前の対局状態（`JSON.parse`直後などを想定）
 * @returns 盤面が凍結された対局状態
 */
export function restoreGameState(state: GameState): GameState {
    const board = state.board.map((row) => [...row]);
    return { ...state, board: freezeBoard(board) };
}
