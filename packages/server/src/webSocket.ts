import type { Server } from "node:http";
import type { Duplex } from "node:stream";

import type { ClientMessage, ServerMessage } from "@othello/protocol";
import { WebSocket, WebSocketServer } from "ws";

import { fetchDiscordUser } from "./oauth.ts";

/** Discord APIによって認証済みの接続者。 */
export type WebSocketIdentity = { readonly id: string };

/** WebSocket サーバーの差し替え可能な依存関係。 */
export type WebSocketOptions = {
    /** テスト時には Discord API の代替を注入できる。 */
    readonly authenticate?: (accessToken: string) => Promise<WebSocketIdentity>;
    readonly log?: Pick<Console, "log" | "error">;
};

/** 1本の WebSocket に固定された認証コンテキスト。 */
export type WebSocketConnection = {
    readonly userId: string;
    readonly instanceId: string;
};

/** Activity インスタンス単位の接続と配信を管理する。 */
export class WebSocketHub {
    readonly #rooms = new Map<string, Map<WebSocket, WebSocketConnection>>();
    readonly #activeGames = new Map<string, string>();

    /** 接続を認証済みインスタンスのルームへ登録する。
     * @param socket WebSocket 接続
     * @param connection 認証済みコンテキスト
     */
    add(socket: WebSocket, connection: WebSocketConnection): void {
        let room = this.#rooms.get(connection.instanceId);
        if (room === undefined) {
            room = new Map();
            this.#rooms.set(connection.instanceId, room);
        }
        room.set(socket, connection);
    }

    /** 接続をルームから除く。
     * @param socket WebSocket 接続
     * @param connection 認証済みコンテキスト
     */
    remove(socket: WebSocket, connection: WebSocketConnection): void {
        const room = this.#rooms.get(connection.instanceId);
        room?.delete(socket);
        if (room?.size === 0) this.#rooms.delete(connection.instanceId);
    }

    /** 同じ Activity インスタンスの全接続へ通知する。
     * @param instanceId 配信対象の Activity インスタンスID
     * @param message サーバーメッセージ
     */
    broadcast(instanceId: string, message: ServerMessage): void {
        const game = message.type === "state" ? message.state.game : undefined;
        if (message.type === "game_started") {
            this.#activeGames.set(instanceId, message.game.id);
        } else if (game !== undefined) {
            if (game === null) this.#activeGames.delete(instanceId);
            else this.#activeGames.set(instanceId, game.id);
        }
        const encoded = JSON.stringify(message);
        for (const socket of this.#rooms.get(instanceId)?.keys() ?? []) {
            if (socket.readyState === WebSocket.OPEN) socket.send(encoded);
        }
        if (message.type === "game_ended") this.#activeGames.delete(instanceId);
    }

    /** 指定インスタンスの現在の接続数を返す。
     * @param instanceId Activity インスタンスID
     * @returns 接続数
     */
    connectionCount(instanceId: string): number {
        return this.#rooms.get(instanceId)?.size ?? 0;
    }

    /** 対局IDが、そのインスタンスに対してサーバーから通知済みかを検査する。
     * @param instanceId Activity インスタンスID
     * @param gameId クライアントから提示された対局ID
     * @returns 現在の対局と一致する場合は true
     */
    authorizesGame(instanceId: string, gameId: string): boolean {
        return this.#activeGames.get(instanceId) === gameId;
    }
}

/**
 * 既存 HTTP サーバーに `/ws` の Upgrade ハンドラーを追加する。
 * @param server 相乗り先の HTTP サーバー
 * @param options 認証関数とロガー
 * @returns インスタンス単位の配信を行うハブ
 */
export function attachWebSocketServer(
    server: Server,
    options: WebSocketOptions = {},
): WebSocketHub {
    const authenticate = options.authenticate ?? fetchDiscordUser;
    const log = options.log ?? console;
    const websocketServer = new WebSocketServer({ noServer: true });
    const hub = new WebSocketHub();

    server.on("upgrade", (request, socket, head) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname !== "/ws") {
            rejectUpgrade(socket, 404, "Not Found");
            return;
        }

        const accessToken = url.searchParams.get("access_token");
        const instanceId = url.searchParams.get("instance_id");
        if (!accessToken || !instanceId) {
            rejectUpgrade(socket, 401, "Unauthorized");
            return;
        }

        authenticate(accessToken)
            .then((identity) => {
                websocketServer.handleUpgrade(request, socket, head, (websocket) => {
                    websocketServer.emit("connection", websocket, request, {
                        userId: identity.id,
                        instanceId,
                    });
                });
            })
            .catch((error: unknown) => {
                log.error("WebSocket の認証に失敗しました:", error);
                rejectUpgrade(socket, 401, "Unauthorized");
            });
    });

    websocketServer.on(
        "connection",
        (socket: WebSocket, _request: unknown, connection: WebSocketConnection) => {
            hub.add(socket, connection);
            log.log(
                `WebSocket 接続: userId=${connection.userId} instanceId=${connection.instanceId}`,
            );
            socket.send(
                JSON.stringify({
                    type: "connected",
                    userId: connection.userId,
                    instanceId: connection.instanceId,
                } satisfies ServerMessage),
            );

            socket.on("message", (data) => {
                const message = parseClientMessage(data.toString());
                if (message === null) {
                    socket.send(
                        JSON.stringify({
                            type: "error",
                            code: "invalid_message",
                            message: "メッセージの形式が不正です",
                        } satisfies ServerMessage),
                    );
                    return;
                }
                if (
                    "gameId" in message &&
                    !hub.authorizesGame(connection.instanceId, message.gameId)
                ) {
                    socket.send(
                        JSON.stringify({
                            type: "error",
                            code: "unauthorized",
                            message: "この対局を操作する権限がありません",
                        } satisfies ServerMessage),
                    );
                    return;
                }
                // 操作の実行は後続 Issue のゲームルームに委ねる。ここでは必ず認証済み接続に
                // 紐づくため、ユーザー ID やインスタンス ID を本文から偽装できない。
                socket.emit("authorizedMessage", message, connection);
            });

            socket.on("close", () => {
                hub.remove(socket, connection);
                log.log(
                    `WebSocket 切断: userId=${connection.userId} instanceId=${connection.instanceId}`,
                );
            });
        },
    );

    server.on("close", () => websocketServer.close());
    return hub;
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
    if (!socket.destroyed) {
        socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
    }
}

function parseClientMessage(text: string): ClientMessage | null {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const message = value as Record<string, unknown>;
    // 認証コンテキストは接続時に確定する。本文での上書きは偽装として拒否する。
    if ("userId" in message || "instanceId" in message) return null;
    switch (message.type) {
        case "seat":
            return message.seat === "black" || message.seat === "white"
                ? (message as ClientMessage)
                : null;
        case "leave":
        case "start_game":
            return message as ClientMessage;
        case "move":
            return isId(message.gameId) && isSquare(message.square)
                ? (message as ClientMessage)
                : null;
        case "resign":
        case "abort":
            return isId(message.gameId) ? (message as ClientMessage) : null;
        default:
            return null;
    }
}

function isId(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

function isSquare(value: unknown): boolean {
    return typeof value === "string" && /^[a-h][1-8]$/.test(value);
}
