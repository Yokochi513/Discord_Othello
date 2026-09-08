/**
 * サーバー通知を唯一の正として保持するクライアント状態（要件定義 §5.4）。
 *
 * 画面はここで組み立てた状態を描画するだけにし、盤面や勝敗をクライアント側で
 * 作り替えることはしない。core の判定は打てるマスの表示など即応性のためだけに使う。
 *
 * DOM にも WebSocket にも依存しない純粋な状態遷移として実装し、
 * 通信は gameSocket.ts、React への接続は useGameSession.ts が受け持つ。
 */

import type { GameResult, GameState, RoomState, ServerMessage } from "@othello/protocol";

/** サーバーとの接続状態（要件定義 §11.3 / §14 E-15）。 */
export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

/** 表示すべき画面（要件定義 §7.1）。戦績画面は M6 で扱う。 */
export type Phase = "connecting" | "lobby" | "playing" | "finished";

/** 座席の色。 */
export type SeatId = "black" | "white";

/** 終局した対局と確定した結果。終局画面のために保持する（要件定義 §7.4）。 */
export type FinishedGame = { readonly game: GameState; readonly result: GameResult };

/** クライアントが保持する状態のすべて。 */
export type ClientState = {
    /** サーバーとの接続状態 */
    readonly connection: ConnectionStatus;
    /** サーバーが認証した自分の Discord User ID。接続が確定するまでは null */
    readonly userId: string | null;
    /** サーバーが認識している Activity インスタンス ID。接続が確定するまでは null */
    readonly instanceId: string | null;
    /** 最後に届いたルーム状態。まだ届いていなければ null */
    readonly room: RoomState | null;
    /** 終局した対局。ロビーへ戻るか次の対局が始まるまで保持する */
    readonly finished: FinishedGame | null;
    /** 直前の着手に続いて自動パスした側（要件定義 F-09）。パスが無ければ空配列 */
    readonly passedBy: readonly SeatId[];
    /** 画面に出すエラー文言。無ければ null（要件定義 §14 E-15） */
    readonly errorMessage: string | null;
};

/** 状態を進める出来事。サーバー通知と、接続・利用者の操作による出来事からなる。 */
export type ClientEvent =
    /** 接続状態が変わった */
    | { readonly type: "connection_changed"; readonly status: ConnectionStatus }
    /** サーバーから通知が届いた */
    | { readonly type: "message_received"; readonly message: ServerMessage }
    /** クライアント側で問題が起きた（接続失敗など） */
    | { readonly type: "local_error"; readonly message: string }
    /** 表示中のエラーを閉じた */
    | { readonly type: "error_dismissed" }
    /** 終局画面からロビーへ戻った */
    | { readonly type: "returned_to_lobby" };

/** 接続前の初期状態。 */
export const initialClientState: ClientState = {
    connection: "connecting",
    userId: null,
    instanceId: null,
    room: null,
    finished: null,
    passedBy: [],
    errorMessage: null,
};

/**
 * 出来事を受けて次の状態を返す。
 * @param state 現在の状態
 * @param event 起きた出来事
 * @returns 次の状態
 */
export function reduceClientState(state: ClientState, event: ClientEvent): ClientState {
    switch (event.type) {
        case "connection_changed":
            return { ...state, connection: event.status };
        case "message_received":
            return applyServerMessage(state, event.message);
        case "local_error":
            return { ...state, errorMessage: event.message };
        case "error_dismissed":
            return state.errorMessage === null ? state : { ...state, errorMessage: null };
        case "returned_to_lobby":
            return state.finished === null ? state : { ...state, finished: null, passedBy: [] };
    }
}

// サーバー通知を状態へ反映する。盤面や勝敗はサーバーの値をそのまま採る（要件定義 §5.4）
function applyServerMessage(state: ClientState, message: ServerMessage): ClientState {
    switch (message.type) {
        case "connected":
            return {
                ...state,
                connection: "open",
                userId: message.userId,
                instanceId: message.instanceId,
                errorMessage: null,
            };
        case "state":
            return {
                ...state,
                room: message.state,
                // 次の対局が始まっていれば、前局の終局画面は畳む
                finished: isSameGame(state.finished, message.state.game) ? state.finished : null,
                passedBy: [],
            };
        case "game_started":
            return {
                ...state,
                room: withGame(state.room, message.game),
                finished: null,
                passedBy: [],
            };
        case "passed":
            // 表示中の対局に対する通知だけを受け取る（古い対局の通知は捨てる）
            return selectGame(state)?.id === message.gameId
                ? { ...state, passedBy: message.passedBy }
                : state;
        case "game_ended":
            return {
                ...state,
                room: withGame(state.room, message.game),
                finished: { game: message.game, result: message.result },
            };
        case "error":
            return { ...state, errorMessage: message.message };
    }
}

/**
 * 表示すべき画面を求める（要件定義 §7.1）。
 * @param state 現在の状態
 * @returns 表示すべき画面
 */
export function selectPhase(state: ClientState): Phase {
    if (state.finished !== null) return "finished";
    if (state.room === null) return "connecting";
    if (state.room.game !== null && state.room.game.result === null) return "playing";
    return "lobby";
}

/**
 * 画面に描く対局を求める。終局後は終局した対局を描き続ける。
 * @param state 現在の状態
 * @returns 描画対象の対局。対局がなければ null
 */
export function selectGame(state: ClientState): GameState | null {
    if (state.finished !== null) return state.finished.game;
    return state.room?.game ?? null;
}

/**
 * 自分が着いている座席を求める（要件定義 §7.2）。
 * @param state 現在の状態
 * @returns 着席していればその色。観戦者なら null
 */
export function selectSeat(state: ClientState): SeatId | null {
    const { room, userId } = state;
    if (room === null || userId === null) return null;
    if (room.seats.black?.userId === userId) return "black";
    if (room.seats.white?.userId === userId) return "white";
    return null;
}

/**
 * 自分が対局中の対局者かどうかを求める。着席していても観戦中の局では false になる。
 * @param state 現在の状態
 * @returns 表示中の対局の対局者なら true
 */
export function selectIsPlayer(state: ClientState): boolean {
    const game = selectGame(state);
    if (game === null || state.userId === null) return false;
    return game.players.black.userId === state.userId || game.players.white.userId === state.userId;
}

// ルーム状態の対局だけを差し替える。ルーム状態が未着なら何もできないため null のままにする
function withGame(room: RoomState | null, game: GameState): RoomState | null {
    return room === null ? null : { ...room, game };
}

function isSameGame(finished: FinishedGame | null, game: GameState | null): boolean {
    if (finished === null) return false;
    // 中断した対局はルームから消えるため、対局が無くなっただけなら終局画面は残す
    return game === null || game.id === finished.game.id;
}
