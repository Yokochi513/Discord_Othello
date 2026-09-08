import type { Server } from "node:http";
import type { Duplex } from "node:stream";

import type { ClientMessage, Participant, ServerMessage } from "@othello/protocol";
import { WebSocket, WebSocketServer } from "ws";

import {
    LobbyStore,
    toRoomState,
    type LobbyResult,
    type LobbyState,
    type SeatId,
} from "./lobby.ts";
import { fetchDiscordUser } from "./oauth.ts";

/** Discord APIによって認証済みの接続者。表示名は Discord の表示名（要件定義 §11.5）。 */
export type WebSocketIdentity = { readonly id: string; readonly displayName: string };

/** WebSocket サーバーの差し替え可能な依存関係。 */
export type WebSocketOptions = {
    /** テスト時には Discord API の代替を注入できる。 */
    readonly authenticate?: (accessToken: string) => Promise<WebSocketIdentity>;
    readonly log?: Pick<Console, "log" | "error">;
};

/** 1本の WebSocket に固定された認証コンテキスト。 */
export type WebSocketConnection = {
    readonly userId: string;
    readonly displayName: string;
    readonly instanceId: string;
};

/** Activity インスタンス単位の接続・ロビー状態・配信を管理する。 */
export class WebSocketHub {
    readonly #rooms = new Map<string, Map<WebSocket, WebSocketConnection>>();
    readonly #activeGames = new Map<string, string>();
    readonly #lobbies = new LobbyStore();

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
        // ロビーだけの配信（state.game === null）では対局IDを消さない。
        // 対局の終了は game_ended で明示される。
        if (message.type === "game_started") {
            this.#activeGames.set(instanceId, message.game.id);
        } else if (message.type === "state" && message.state.game !== null) {
            this.#activeGames.set(instanceId, message.state.game.id);
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

    /** 指定ユーザーの接続が、そのインスタンスにまだ残っているかを検査する。
     * @param instanceId Activity インスタンスID
     * @param userId Discord User ID
     * @returns 1本でも残っていれば true
     */
    hasConnection(instanceId: string, userId: string): boolean {
        for (const connection of this.#rooms.get(instanceId)?.values() ?? []) {
            if (connection.userId === userId) return true;
        }
        return false;
    }

    /** 対局IDが、そのインスタンスに対してサーバーから通知済みかを検査する。
     * @param instanceId Activity インスタンスID
     * @param gameId クライアントから提示された対局ID
     * @returns 現在の対局と一致する場合は true
     */
    authorizesGame(instanceId: string, gameId: string): boolean {
        return this.#activeGames.get(instanceId) === gameId;
    }

    /** 指定インスタンスのロビー状態を返す。
     * @param instanceId Activity インスタンスID
     * @returns 現在のロビー状態
     */
    lobby(instanceId: string): LobbyState {
        return this.#lobbies.get(instanceId);
    }

    /** 接続者をロビーへ加える。着席していない参加者は観戦者になる（要件定義 F-13）。
     * @param connection 認証済みコンテキスト
     * @returns ロビー状態が変化したら true
     */
    joinLobby(connection: WebSocketConnection): boolean {
        return this.#lobbies.join(connection.instanceId, participantOf(connection)).changed;
    }

    /** 接続者を座席に着かせる（要件定義 F-03）。
     * @param connection 認証済みコンテキスト
     * @param seatId 着席先の座席
     * @returns 着席結果。埋まっている席は拒否される
     */
    takeSeat(connection: WebSocketConnection, seatId: SeatId): LobbyResult {
        return this.#lobbies.takeSeat(connection.instanceId, participantOf(connection), seatId);
    }

    /** 接続者を退席させ、観戦者に戻す（要件定義 F-03）。
     * @param connection 認証済みコンテキスト
     * @returns ロビー状態が変化したら true
     */
    leaveSeat(connection: WebSocketConnection): boolean {
        return this.#lobbies.leaveSeat(connection.instanceId, connection.userId).changed;
    }

    /** 接続者をロビーから取り除く（切断時）。
     * @param connection 認証済みコンテキスト
     * @returns ロビー状態が変化したら true
     */
    leaveLobby(connection: WebSocketConnection): boolean {
        return this.#lobbies.leave(connection.instanceId, connection.userId).changed;
    }

    /** 現在のロビー状態をルーム全員へ配信する（要件定義 F-02）。
     * @param instanceId Activity インスタンスID
     */
    broadcastLobby(instanceId: string): void {
        // 進行中の対局は M3-3 のゲームセッションが持つため、ここでは常に null を送る。
        this.broadcast(instanceId, { type: "state", state: toRoomState(this.lobby(instanceId)) });
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
    const authenticate = options.authenticate ?? authenticateWithDiscord;
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
                        displayName: identity.displayName,
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
            // 接続直後は観戦者として参加し、参加者一覧を全員へ配り直す（要件定義 F-02・F-13）。
            hub.joinLobby(connection);
            hub.broadcastLobby(connection.instanceId);

            socket.on("message", (data) => {
                const message = parseClientMessage(data.toString());
                if (message === null) {
                    sendError(socket, "invalid_message", "メッセージの形式が不正です");
                    return;
                }
                if (
                    "gameId" in message &&
                    !hub.authorizesGame(connection.instanceId, message.gameId)
                ) {
                    sendError(socket, "unauthorized", "この対局を操作する権限がありません");
                    return;
                }
                if (message.type === "seat" || message.type === "leave") {
                    handleLobbyMessage(hub, socket, connection, message, log);
                    return;
                }
                // 対局操作の実行は後続 Issue のゲームセッションに委ねる。ここでは必ず認証済み
                // 接続に紐づくため、ユーザー ID やインスタンス ID を本文から偽装できない。
                socket.emit("authorizedMessage", message, connection);
            });

            socket.on("close", () => {
                hub.remove(socket, connection);
                // 同じユーザーの別接続が残っていれば、まだロビーから外さない。
                if (
                    !hub.hasConnection(connection.instanceId, connection.userId) &&
                    hub.leaveLobby(connection)
                ) {
                    hub.broadcastLobby(connection.instanceId);
                }
                log.log(
                    `WebSocket 切断: userId=${connection.userId} instanceId=${connection.instanceId}`,
                );
            });
        },
    );

    server.on("close", () => websocketServer.close());
    return hub;
}

// 着席・退席を処理し、ロビー状態が変わったときだけルーム全員へ配信する
function handleLobbyMessage(
    hub: WebSocketHub,
    socket: WebSocket,
    connection: WebSocketConnection,
    message: Extract<ClientMessage, { type: "seat" | "leave" }>,
    log: Pick<Console, "log" | "error">,
): void {
    if (message.type === "seat") {
        const result = hub.takeSeat(connection, message.seat);
        if (!result.ok) {
            sendError(socket, result.code, result.message);
            return;
        }
        if (!result.changed) return;
        log.log(
            `着席: userId=${connection.userId} seat=${message.seat} instanceId=${connection.instanceId}`,
        );
    } else {
        if (!hub.leaveSeat(connection)) return;
        log.log(`退席: userId=${connection.userId} instanceId=${connection.instanceId}`);
    }
    hub.broadcastLobby(connection.instanceId);
}

// 認証コンテキストから、ロビーが保持する参加者情報を作る
function participantOf(connection: WebSocketConnection): Participant {
    return { userId: connection.userId, displayName: connection.displayName };
}

// Discord のユーザー情報から接続者を特定する。表示名は global_name を優先する
async function authenticateWithDiscord(accessToken: string): Promise<WebSocketIdentity> {
    const user = await fetchDiscordUser(accessToken);
    return { id: user.id, displayName: user.global_name ?? user.username };
}

function sendError(
    socket: WebSocket,
    code: Extract<ServerMessage, { type: "error" }>["code"],
    message: string,
): void {
    socket.send(JSON.stringify({ type: "error", code, message } satisfies ServerMessage));
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
