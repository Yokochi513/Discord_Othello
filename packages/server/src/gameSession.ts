/**
 * Activity インスタンス単位の対局セッション（要件定義 §5.4 / F-05〜F-07 / §14 E-01〜E-05）。
 *
 * 合法手判定・反転・手番遷移・終局判定は `@othello/core` を唯一の正として用いる。
 * クライアントから届くのは座標だけで、着手する色は座席と接続情報から決めるため、
 * 改変クライアントが手番や色を偽ることはできない（要件定義 §15）。
 *
 * ロビーと同じく状態遷移は副作用のない関数として実装し、配信は WebSocket 側に任せる。
 * 対局は Activity インスタンスごとに 1 局で、`GameStore` がインスタンス単位に保持する
 * ため、同時に複数の対局が進行しても互いに影響しない（要件定義 §12 同時対局数）。
 */

import { randomUUID } from "node:crypto";

import {
    countCells,
    createGameState,
    IllegalMoveError,
    InvalidSquareError,
    playMove,
    type GameState as CoreGameState,
    type Player,
    type Square,
} from "@othello/core";
import type { ErrorCode, GameState as GameView, Participant } from "@othello/protocol";

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
};

/** 対局操作の結果。拒否した場合は盤面を変えず、クライアントへ返すエラーを持つ。 */
export type SessionResult =
    | { readonly ok: true; readonly session: GameSession }
    | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

/**
 * 対局セッションを生成する。初期盤面・黒番から始まる（要件定義 §6）。
 * @param id 対局ID
 * @param players 黒番・白番に着いている参加者
 * @returns 初期局面の対局セッション
 */
export function createSession(id: string, players: GamePlayers): GameSession {
    return { id, players, state: createGameState(), lastMove: null };
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
 * 着手を検証して適用する（要件定義 F-07 / §14 E-01〜E-04）。
 * 終局済み・観戦者・手番違い・非合法手はいずれも拒否し、盤面を変えない。
 * @param session 対局セッション
 * @param userId 着手しようとしたユーザーの Discord User ID
 * @param square 着手する座標表記
 * @returns 適用後のセッション、または拒否理由
 */
export function playSessionMove(
    session: GameSession,
    userId: string,
    square: Square,
): SessionResult {
    // E-04: 既に終局した対局への着手
    if (session.state.turn === null) {
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
        const state = playMove(session.state, player, square);
        return { ok: true, session: { ...session, state, lastMove: square } };
    } catch (error) {
        // E-02: 非合法手。core の判定を唯一の正とする（要件定義 §5.4）
        if (error instanceof IllegalMoveError || error instanceof InvalidSquareError) {
            return { ok: false, code: "illegal_move", message: "そのマスには打てません" };
        }
        throw error;
    }
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
        turn: session.state.turn,
        scores: { black: count.black, white: count.white },
        moveCount: session.state.moveCount,
        lastMove: session.lastMove,
        players: session.players,
    };
}

/**
 * 対局が終了しているかを返す。
 * @param session 対局セッション
 * @returns 終局していれば true
 */
export function isFinished(session: GameSession): boolean {
    return session.state.turn === null;
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
     * @returns 適用後のセッション、または拒否理由
     */
    play(instanceId: string, gameId: string, userId: string, square: Square): SessionResult {
        const session = this.get(instanceId);
        // E-05: 存在しない対局IDの指定
        if (session === null || session.id !== gameId) {
            return { ok: false, code: "game_not_found", message: "対局が見つかりません" };
        }

        const result = playSessionMove(session, userId, square);
        if (result.ok) this.#games.set(instanceId, result.session);
        return result;
    }

    /** 指定インスタンスの対局を破棄する。
     * @param instanceId Activity インスタンスID
     */
    delete(instanceId: string): void {
        this.#games.delete(instanceId);
    }
}
