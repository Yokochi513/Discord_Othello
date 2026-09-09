/**
 * WebSocket 接続とクライアント状態を React へつなぐフック。
 *
 * 接続の管理は gameSocket.ts、状態遷移は roomState.ts が受け持ち、
 * ここは両者の橋渡しと、画面から呼ぶ操作の入口だけを提供する。
 * 操作はサーバーへ送るだけで、結果は状態通知として戻ってくる（要件定義 §5.4）。
 */

import type { ClientMessage, Square } from "@othello/protocol";
import { useEffect, useMemo, useReducer } from "react";

import { resolveWebSocketUrl } from "./api.ts";
import type { ClientConfig } from "./env.ts";
import { GameSocket } from "./gameSocket.ts";
import {
    initialClientState,
    reduceClientState,
    type ClientState,
    type SeatId,
} from "./roomState.ts";

/** WebSocket 接続に必要な、OAuth で確定した識別情報（要件定義 §15）。 */
export type SessionCredentials = {
    /** OAuth2 で得たアクセストークン */
    readonly accessToken: string;
    /** Activity のインスタンス ID */
    readonly instanceId: string;
};

/** 画面から呼ぶ操作。いずれもサーバーへ要求を送るだけで、状態は通知で更新される。 */
export type GameActions = {
    /** 座席に着く（要件定義 F-03）
     * @param seat 着席する色
     */
    takeSeat(seat: SeatId): void;
    /** 座席を離れて観戦者に戻る（要件定義 F-03） */
    leaveSeat(): void;
    /** 対局を開始する（要件定義 F-05） */
    startGame(): void;
    /** 終局後、黒白を入れ替えて同じ座席で次の対局を始める（要件定義 F-19 / §20 O-10） */
    rematch(): void;
    /** 着手する（要件定義 F-07）
     * @param square 着手する座標表記
     */
    play(square: Square): void;
    /** 投了する（要件定義 F-11） */
    resign(): void;
    /** 対局を中断する（無効試合。要件定義 F-12） */
    abort(): void;
    /** 終局画面を閉じてロビーへ戻る（要件定義 §7.4） */
    returnToLobby(): void;
    /** 表示中のエラーを閉じる */
    dismissError(): void;
};

/** useGameSession が返すもの。 */
export type GameSessionHandle = {
    /** サーバー通知から組み立てた現在の状態 */
    readonly state: ClientState;
    /** 画面から呼ぶ操作 */
    readonly actions: GameActions;
};

/**
 * サーバーへ接続し、通知から組み立てた状態と操作を返す。
 * @param config クライアントの実行時設定
 * @param credentials OAuth で確定した識別情報
 * @returns 現在の状態と操作
 */
export function useGameSession(
    config: ClientConfig,
    credentials: SessionCredentials,
): GameSessionHandle {
    const [state, dispatch] = useReducer(reduceClientState, initialClientState);
    const { accessToken, instanceId } = credentials;

    const url = useMemo(
        () =>
            resolveWebSocketUrl(window.location.origin, config, {
                access_token: accessToken,
                instance_id: instanceId,
            }),
        [config, accessToken, instanceId],
    );

    const socket = useMemo(
        () =>
            new GameSocket({
                url,
                onMessage: (message) => dispatch({ type: "message_received", message }),
                onStatus: (status) => dispatch({ type: "connection_changed", status }),
                onError: (message) => dispatch({ type: "local_error", message }),
            }),
        [url],
    );

    useEffect(() => {
        socket.connect();
        // StrictMode では effect が 2 回走る。後片付けで確実に閉じ、接続を残さない
        return () => socket.close();
    }, [socket]);

    // 対局に関わる操作には、サーバーが受理する対局IDを添える（要件定義 §15 E-05）
    const gameId = state.room?.game?.id ?? null;

    const actions = useMemo<GameActions>(() => {
        const send = (message: ClientMessage): void => {
            // 前の操作で出たエラーは、新しい操作を送る時点で畳む
            dispatch({ type: "error_dismissed" });
            socket.send(message);
        };
        const sendForGame = (build: (id: string) => ClientMessage): void => {
            if (gameId === null) {
                dispatch({ type: "local_error", message: "対局が始まっていません" });
                return;
            }
            send(build(gameId));
        };

        return {
            takeSeat: (seat) => send({ type: "seat", seat }),
            leaveSeat: () => send({ type: "leave" }),
            startGame: () => send({ type: "start_game" }),
            rematch: () => send({ type: "rematch" }),
            play: (square) => sendForGame((id) => ({ type: "move", gameId: id, square })),
            resign: () => sendForGame((id) => ({ type: "resign", gameId: id })),
            abort: () => sendForGame((id) => ({ type: "abort", gameId: id })),
            returnToLobby: () => dispatch({ type: "returned_to_lobby" }),
            dismissError: () => dispatch({ type: "error_dismissed" }),
        };
    }, [socket, gameId]);

    return { state, actions };
}
