/**
 * Activity インスタンス単位の対局セッション
 * （要件定義 §5.4 / F-05〜F-07・F-09〜F-12 / §14 E-01〜E-05・E-09）。
 *
 * 合法手判定・反転・手番遷移・終局判定は `@othello/core` を唯一の正として用いる。
 * クライアントから届くのは座標だけで、着手する色は座席と接続情報から決めるため、
 * 改変クライアントが手番や色を偽ることはできない（要件定義 §15）。
 *
 * 自動パス・終局・投了・中断のいずれで対局が終わったかは`result`に確定させ、
 * 以後の着手・投了・中断はすべて拒否する。無効試合（中断・離脱）は勝敗を付けない。
 *
 * ロビーと同じく状態遷移は副作用のない関数として実装し、配信は WebSocket 側に任せる。
 * 対局は Activity インスタンスごとに 1 局で、`GameStore` がインスタンス単位に保持する
 * ため、同時に複数の対局が進行しても互いに影響しない（要件定義 §12 同時対局数）。
 */

import { randomUUID } from "node:crypto";

import {
    countCells,
    createGameState,
    finishGame,
    IllegalMoveError,
    InvalidSquareError,
    playMove,
    resignGame,
    type GameEndReason as CoreEndReason,
    type GameState as CoreGameState,
    type Outcome as CoreOutcome,
    type Player,
    type Square,
} from "@othello/core";
import type {
    ErrorCode,
    GameEndReason,
    GameResult,
    GameState as GameView,
    Outcome,
    Participant,
} from "@othello/protocol";

import type { LobbyState } from "./lobby.ts";

/** 対局している 2 人。対局開始時に確定し、以後の着席状況の変化には影響されない。 */
export type GamePlayers = { readonly black: Participant; readonly white: Participant };

/** 1 局分の対局セッション。盤面・手番・手数・棋譜は core の対局状態が持つ。 */
export type GameSession = {
    readonly id: string;
    readonly players: GamePlayers;
    readonly state: CoreGameState;
    /** 直前に打たれた手。まだ着手がなければ null */
    readonly lastMove: Square | null;
    /** 確定した対局結果。対局中は null（要件定義 §6） */
    readonly result: GameResult | null;
};

/** 対局操作の結果。拒否した場合は盤面を変えず、クライアントへ返すエラーを持つ。 */
export type SessionResult =
    | { readonly ok: true; readonly session: GameSession }
    | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

/** 着手の結果。受理した場合は、その着手で起きた自動パスを併せて返す（F-09）。 */
export type MoveResult =
    | {
          readonly ok: true;
          readonly session: GameSession;
          /** この着手の後に自動パスした側。パスが起きなければ空配列 */
          readonly passedBy: readonly Player[];
      }
    | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

// core の終局理由・勝敗を、クライアントへ配信する表記へ対応付ける
const END_REASONS: Readonly<Record<CoreEndReason, GameEndReason>> = {
    bothPassed: "both_passed",
    boardFull: "board_full",
    shutout: "shutout",
    resign: "resign",
};

const OUTCOMES: Readonly<Record<CoreOutcome, Outcome>> = {
    blackWin: "black_win",
    whiteWin: "white_win",
    draw: "draw",
};

/**
 * 対局セッションを生成する。初期盤面・黒番から始まる（要件定義 §6）。
 * @param id 対局ID
 * @param players 黒番・白番に着いている参加者
 * @returns 初期局面の対局セッション
 */
export function createSession(id: string, players: GamePlayers): GameSession {
    return { id, players, state: createGameState(), lastMove: null, result: null };
}

/**
 * 指定ユーザーが対局しているかを調べ、その色を返す。
 * @param session 対局セッション
 * @param userId Discord User ID
 * @returns 対局者ならその色。観戦者など対局していない場合は null
 */
export function seatOf(session: GameSession, userId: string): Player | null {
    if (session.players.black.userId === userId) return "black";
    if (session.players.white.userId === userId) return "white";
    return null;
}

/**
 * 着手を検証して適用する（要件定義 F-07・F-09・F-10 / §14 E-01〜E-04）。
 * 終局済み・観戦者・手番違い・非合法手はいずれも拒否し、盤面を変えない。
 * 受理した場合は、着手に続いて起きた自動パスと、成立した終局を併せて確定する。
 * @param session 対局セッション
 * @param userId 着手しようとしたユーザーの Discord User ID
 * @param square 着手する座標表記
 * @returns 適用後のセッションと自動パスした側、または拒否理由
 */
export function playSessionMove(session: GameSession, userId: string, square: Square): MoveResult {
    // E-04: 既に終局した対局への着手
    if (isFinished(session)) {
        return { ok: false, code: "invalid_state", message: "対局は既に終了しています" };
    }

    // E-03: 観戦者の着手
    const player = seatOf(session, userId);
    if (player === null) {
        return { ok: false, code: "unauthorized", message: "観戦者は着手できません" };
    }

    // E-01: 手番でない者の着手
    if (player !== session.state.turn) {
        return { ok: false, code: "invalid_state", message: "手番ではありません" };
    }

    try {
        // core が着手の適用・自動パス・終局判定をまとめて行う（要件定義 §5.4）
        const state = playMove(session.state, player, square);
        const played = { ...session, state, lastMove: square, result: naturalResult(state) };
        return { ok: true, session: played, passedBy: passedBetween(session.state, state) };
    } catch (error) {
        // E-02: 非合法手。core の判定を唯一の正とする（要件定義 §5.4）
        if (error instanceof IllegalMoveError || error instanceof InvalidSquareError) {
            return { ok: false, code: "illegal_move", message: "そのマスには打てません" };
        }
        throw error;
    }
}

/**
 * 投了を受理する（要件定義 F-11 / §6）。投了した側の負けとし、石数は投了時点の値を残す。
 * @param session 対局セッション
 * @param userId 投了しようとしたユーザーの Discord User ID
 * @returns 投了で決着したセッション、または拒否理由
 */
export function resignSession(session: GameSession, userId: string): SessionResult {
    const requester = endRequester(session, userId, "投了");
    if (!requester.ok) return requester;

    const resigned = resignGame(session.state.board, requester.player);
    const result: GameResult = { reason: "resign", outcome: OUTCOMES[resigned.outcome] };
    return { ok: true, session: { ...session, result } };
}

/**
 * 中断を受理する（要件定義 F-12 / §6）。無効試合として扱い、勝敗を付けない。
 * @param session 対局セッション
 * @param userId 中断しようとしたユーザーの Discord User ID
 * @returns 中断で終了したセッション、または拒否理由
 */
export function abortSession(session: GameSession, userId: string): SessionResult {
    const requester = endRequester(session, userId, "中断");
    if (!requester.ok) return requester;

    return { ok: true, session: { ...session, result: { reason: "abort", outcome: null } } };
}

/**
 * 対局中の離脱による無効試合を確定する（要件定義 §14 E-09）。
 * 中断と同じく勝敗は付けない。対局していないユーザーの離脱では何も起きない。
 * @param session 対局セッション
 * @param userId 離脱したユーザーの Discord User ID
 * @returns 無効試合として終了したセッション。終了させる必要がなければ null
 */
export function abandonSession(session: GameSession, userId: string): GameSession | null {
    if (isFinished(session) || seatOf(session, userId) === null) return null;

    return { ...session, result: { reason: "disconnect", outcome: null } };
}

/**
 * 対局セッションを、クライアントへ配信する対局状態へ変換する。
 * 盤面・手番に加え、対局画面が必要とする石数・手数・直前の手を載せる（要件定義 §7.3 / F-06）。
 * @param session 対局セッション
 * @returns 配信用の対局状態
 */
export function toGameView(session: GameSession): GameView {
    const count = countCells(session.state.board);
    return {
        id: session.id,
        board: session.state.board,
        // 投了・中断では core の手番が残るため、決着した対局の手番は必ず null にする
        turn: session.result === null ? session.state.turn : null,
        scores: { black: count.black, white: count.white },
        moveCount: session.state.moveCount,
        lastMove: session.lastMove,
        players: session.players,
        result: session.result,
    };
}

/**
 * 対局が終了しているかを返す。終局・投了・中断・離脱のいずれも終了として扱う。
 * @param session 対局セッション
 * @returns 終了していれば true
 */
export function isFinished(session: GameSession): boolean {
    return session.result !== null;
}

/**
 * Activity インスタンスごとの対局セッションを保持する。
 * 対局IDはインスタンスをまたいで一意になるよう採番し、他インスタンスの対局IDを
 * 指定した操作は成立しない（要件定義 §15）。
 */
export class GameStore {
    readonly #games = new Map<string, GameSession>();
    readonly #createId: () => string;

    /**
     * 対局の保管庫を作る。
     * @param createId 対局IDの採番。テストでは決め打ちの実装を渡せる
     */
    constructor(createId: () => string = randomUUID) {
        this.#createId = createId;
    }

    /** 指定インスタンスで進行中・終局済みの対局を返す。
     * @param instanceId Activity インスタンスID
     * @returns 対局セッション。まだ対局していなければ null
     */
    get(instanceId: string): GameSession | null {
        return this.#games.get(instanceId) ?? null;
    }

    /** 指定インスタンスの対局IDが、クライアントの提示した対局IDと一致するかを調べる。
     * @param instanceId Activity インスタンスID
     * @param gameId クライアントから提示された対局ID
     * @returns 現在の対局と一致する場合は true
     */
    isCurrentGame(instanceId: string, gameId: string): boolean {
        return this.get(instanceId)?.id === gameId;
    }

    /** 両席が埋まったロビーから対局を生成する（要件定義 F-05）。
     * 開始を要求できるのは着席している側に限り、進行中の対局があるときは拒否する。
     * @param instanceId Activity インスタンスID
     * @param lobby 現在のロビー状態
     * @param requesterId 開始を要求したユーザーの Discord User ID
     * @returns 生成した対局セッション、または拒否理由
     */
    start(instanceId: string, lobby: LobbyState, requesterId: string): SessionResult {
        const current = this.get(instanceId);
        if (current !== null && !isFinished(current)) {
            return { ok: false, code: "invalid_state", message: "対局が既に進行中です" };
        }

        const { black, white } = lobby.seats;
        if (black === null || white === null) {
            return {
                ok: false,
                code: "invalid_state",
                message: "両席が埋まるまで対局を開始できません",
            };
        }
        if (black.userId !== requesterId && white.userId !== requesterId) {
            return { ok: false, code: "unauthorized", message: "対局者だけが開始できます" };
        }

        const session = createSession(this.#createId(), { black, white });
        this.#games.set(instanceId, session);
        return { ok: true, session };
    }

    /** 着手を検証して適用し、成功した場合だけ保持中の対局を差し替える。
     * @param instanceId Activity インスタンスID
     * @param gameId クライアントから提示された対局ID
     * @param userId 着手しようとしたユーザーの Discord User ID
     * @param square 着手する座標表記
     * @returns 適用後のセッションと自動パスした側、または拒否理由
     */
    play(instanceId: string, gameId: string, userId: string, square: Square): MoveResult {
        const session = this.#current(instanceId, gameId);
        // E-05: 存在しない対局IDの指定
        if (session === null) {
            return { ok: false, code: "game_not_found", message: "対局が見つかりません" };
        }

        const result = playSessionMove(session, userId, square);
        if (result.ok) this.#games.set(instanceId, result.session);
        return result;
    }

    /** 投了を受理し、投了した側の負けとして対局を終える（要件定義 F-11）。
     * @param instanceId Activity インスタンスID
     * @param gameId クライアントから提示された対局ID
     * @param userId 投了しようとしたユーザーの Discord User ID
     * @returns 投了で決着したセッション、または拒否理由
     */
    resign(instanceId: string, gameId: string, userId: string): SessionResult {
        const session = this.#current(instanceId, gameId);
        if (session === null) {
            return { ok: false, code: "game_not_found", message: "対局が見つかりません" };
        }

        const result = resignSession(session, userId);
        if (result.ok) this.#games.set(instanceId, result.session);
        return result;
    }

    /** 中断を受理し、無効試合として対局を破棄する（要件定義 F-12）。
     * 破棄した対局は保持しないため、ルーム状態はロビーだけに戻る。
     * @param instanceId Activity インスタンスID
     * @param gameId クライアントから提示された対局ID
     * @param userId 中断しようとしたユーザーの Discord User ID
     * @returns 中断で終了したセッション、または拒否理由
     */
    abort(instanceId: string, gameId: string, userId: string): SessionResult {
        const session = this.#current(instanceId, gameId);
        if (session === null) {
            return { ok: false, code: "game_not_found", message: "対局が見つかりません" };
        }

        const result = abortSession(session, userId);
        if (result.ok) this.#games.delete(instanceId);
        return result;
    }

    /** 対局中の離脱を無効試合として終え、対局を破棄する（要件定義 §14 E-09）。
     * @param instanceId Activity インスタンスID
     * @param userId 離脱したユーザーの Discord User ID
     * @returns 無効試合として終了したセッション。終了させる対局がなければ null
     */
    abandon(instanceId: string, userId: string): GameSession | null {
        const session = this.get(instanceId);
        if (session === null) return null;

        const abandoned = abandonSession(session, userId);
        if (abandoned !== null) this.#games.delete(instanceId);
        return abandoned;
    }

    /** 指定インスタンスの対局を破棄する。
     * @param instanceId Activity インスタンスID
     */
    delete(instanceId: string): void {
        this.#games.delete(instanceId);
    }

    // クライアントの提示した対局IDが現在の対局と一致する場合だけ、その対局を返す
    #current(instanceId: string, gameId: string): GameSession | null {
        const session = this.get(instanceId);
        return session !== null && session.id === gameId ? session : null;
    }
}

// 対局を終わらせる操作の要求者を検証する。終局済みと観戦者はいずれも拒否する
function endRequester(session: GameSession, userId: string, label: string): RequesterResult {
    if (isFinished(session)) {
        return { ok: false, code: "invalid_state", message: "対局は既に終了しています" };
    }

    const player = seatOf(session, userId);
    if (player === null) {
        return { ok: false, code: "unauthorized", message: `観戦者は${label}できません` };
    }

    return { ok: true, player };
}

// 投了・中断を要求した対局者の検証結果
type RequesterResult =
    | { readonly ok: true; readonly player: Player }
    | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

// 着手の前後で棋譜に加わったパスを、起きた順に取り出す
function passedBetween(before: CoreGameState, after: CoreGameState): readonly Player[] {
    return after.log
        .slice(before.log.length)
        .flatMap((entry) => (entry.kind === "pass" ? [entry.player] : []));
}

// 盤面から確定した自然終局の結果を求める。対局が続いていれば null
function naturalResult(state: CoreGameState): GameResult | null {
    if (state.turn !== null) return null;

    const finished = finishGame(state.board);
    if (finished === null) return null;

    return { reason: END_REASONS[finished.reason], outcome: OUTCOMES[finished.outcome] };
}
