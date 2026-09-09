import type { Server } from "node:http";
import type { Duplex } from "node:stream";

import type { ClientMessage, Participant, ServerMessage, Square } from "@othello/protocol";
import { WebSocket, WebSocketServer } from "ws";

import {
    checkStartable,
    GameStore,
    toGameView,
    type GameSession,
    type MoveResult,
    type SessionResult,
} from "./gameSession.ts";
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
    /** 対局IDの採番。テストでは決め打ちの実装を渡せる。 */
    readonly createGameId?: () => string;
    readonly log?: Pick<Console, "log" | "error">;
};

/** 1本の WebSocket に固定された認証コンテキスト。 */
export type WebSocketConnection = {
    readonly userId: string;
    readonly displayName: string;
    readonly instanceId: string;
};

/** Activity インスタンス単位の接続・ロビー状態・対局・配信を管理する。 */
export class WebSocketHub {
    readonly #rooms = new Map<string, Map<WebSocket, WebSocketConnection>>();
    readonly #lobbies = new LobbyStore();
    readonly #games: GameStore;

    /**
     * インスタンス単位のハブを作る。
     * @param createGameId 対局IDの採番。省略時は randomUUID
     */
    constructor(createGameId?: () => string) {
        this.#games = createGameId === undefined ? new GameStore() : new GameStore(createGameId);
    }

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
        const encoded = JSON.stringify(message);
        for (const socket of this.#rooms.get(instanceId)?.keys() ?? []) {
            if (socket.readyState === WebSocket.OPEN) socket.send(encoded);
        }
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

    /** 対局IDが、そのインスタンスで進行中の対局のものかを検査する。
     * @param instanceId Activity インスタンスID
     * @param gameId クライアントから提示された対局ID
     * @returns 現在の対局と一致する場合は true
     */
    authorizesGame(instanceId: string, gameId: string): boolean {
        return this.#games.isCurrentGame(instanceId, gameId);
    }

    /** 指定インスタンスの対局セッションを返す。
     * @param instanceId Activity インスタンスID
     * @returns 対局セッション。まだ対局していなければ null
     */
    game(instanceId: string): GameSession | null {
        return this.#games.get(instanceId);
    }

    /** 両席が埋まったロビーから対局を始める（要件定義 F-05）。
     * @param connection 認証済みコンテキスト
     * @returns 生成した対局セッション、または拒否理由
     */
    startGame(connection: WebSocketConnection): SessionResult {
        return this.#games.start(
            connection.instanceId,
            this.lobby(connection.instanceId),
            connection.userId,
        );
    }

    /** 終局後、黒白を入れ替えて同じ座席の 2 人で次の対局を始める（要件定義 F-19 / §20 O-10）。
     * 開始できないと判断した場合は座席を入れ替えず、ロビーを元のまま残す。
     * @param connection 認証済みコンテキスト
     * @returns 生成した対局セッション、または拒否理由
     */
    rematch(connection: WebSocketConnection): SessionResult {
        const { instanceId, userId } = connection;
        const check = checkStartable(this.game(instanceId), this.lobby(instanceId), userId);
        if (!check.ok) return check;

        // O-10: 再戦のたびに先手を交代させる。入れ替えた座席のまま次の対局を組む
        const swapped = this.#lobbies.swapSeats(instanceId);
        return this.#games.start(instanceId, swapped.state, userId);
    }

    /** 着手を検証して盤面へ適用する（要件定義 F-07）。
     * @param connection 認証済みコンテキスト
     * @param gameId クライアントから提示された対局ID
     * @param square 着手する座標表記
     * @returns 適用後のセッションと自動パスした側、または拒否理由
     */
    playMove(connection: WebSocketConnection, gameId: string, square: Square): MoveResult {
        return this.#games.play(connection.instanceId, gameId, connection.userId, square);
    }

    /** 投了を受理する（要件定義 F-11）。
     * @param connection 認証済みコンテキスト
     * @param gameId クライアントから提示された対局ID
     * @returns 投了で決着したセッション、または拒否理由
     */
    resignGame(connection: WebSocketConnection, gameId: string): SessionResult {
        return this.#games.resign(connection.instanceId, gameId, connection.userId);
    }

    /** 中断を受理し、対局を破棄する（要件定義 F-12）。
     * @param connection 認証済みコンテキスト
     * @param gameId クライアントから提示された対局ID
     * @returns 中断で終了したセッション、または拒否理由
     */
    abortGame(connection: WebSocketConnection, gameId: string): SessionResult {
        return this.#games.abort(connection.instanceId, gameId, connection.userId);
    }

    /** 対局中の離脱を無効試合として終え、対局を破棄する（要件定義 §14 E-09）。
     * @param connection 認証済みコンテキスト
     * @returns 無効試合として終了したセッション。終了させる対局がなければ null
     */
    abandonGame(connection: WebSocketConnection): GameSession | null {
        return this.#games.abandon(connection.instanceId, connection.userId);
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

    /** ロビーと進行中の対局をまとめたルーム状態を全員へ配信する（要件定義 F-02 / F-06）。
     * 対局中の接続者にも同じ状態が届くため、観戦者も盤面を追える（F-13）。
     * @param instanceId Activity インスタンスID
     */
    broadcastState(instanceId: string): void {
        const session = this.game(instanceId);
        this.broadcast(instanceId, {
            type: "state",
            state: toRoomState(
                this.lobby(instanceId),
                session === null ? null : toGameView(session),
            ),
        });
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
    const hub = new WebSocketHub(options.createGameId);

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
            hub.broadcastState(connection.instanceId);

            socket.on("message", (data) => {
                const message = parseClientMessage(data.toString());
                if (message === null) {
                    sendError(socket, "invalid_message", "メッセージの形式が不正です");
                    return;
                }
                // E-05: 進行中の対局と一致しない対局IDの操作は受け付けない（要件定義 §15）
                if (
                    "gameId" in message &&
                    !hub.authorizesGame(connection.instanceId, message.gameId)
                ) {
                    sendError(socket, "game_not_found", "対局が見つかりません");
                    return;
                }
                if (message.type === "seat" || message.type === "leave") {
                    handleLobbyMessage(hub, socket, connection, message, log);
                    return;
                }
                if (message.type === "start_game" || message.type === "rematch") {
                    const isRematch = message.type === "rematch";
                    handleStartGame(hub, socket, connection, isRematch, log);
                    return;
                }
                if (message.type === "move") {
                    handleMove(hub, socket, connection, message, log);
                    return;
                }
                handleGameEnd(hub, socket, connection, message, log);
            });

            socket.on("close", () => {
                hub.remove(socket, connection);
                // 同じユーザーの別接続が残っていれば、まだロビーから外さない。
                if (!hub.hasConnection(connection.instanceId, connection.userId)) {
                    // E-09: 対局中の離脱は無効試合として終える
                    const abandoned = hub.abandonGame(connection);
                    if (abandoned !== null) {
                        broadcastGameEnd(hub, connection.instanceId, abandoned, log);
                    }
                    // 破棄した対局はルーム状態からも消えるため、併せて配り直す
                    if (hub.leaveLobby(connection) || abandoned !== null) {
                        hub.broadcastState(connection.instanceId);
                    }
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
    hub.broadcastState(connection.instanceId);
}

// 対局を開始し、全員を対局画面へ遷移させる（要件定義 F-05・F-19）
function handleStartGame(
    hub: WebSocketHub,
    socket: WebSocket,
    connection: WebSocketConnection,
    isRematch: boolean,
    log: Pick<Console, "log" | "error">,
): void {
    const result = isRematch ? hub.rematch(connection) : hub.startGame(connection);
    if (!result.ok) {
        sendError(socket, result.code, result.message);
        return;
    }
    const { id, players } = result.session;
    log.log(
        `${isRematch ? "再戦" : "対局開始"}: gameId=${id} instanceId=${connection.instanceId} ` +
            `black=${players.black.userId} white=${players.white.userId}`,
    );
    hub.broadcast(connection.instanceId, {
        type: "game_started",
        game: toGameView(result.session),
    });
    // 再戦では黒白が入れ替わるため、更新後のロビーも配り直す（要件定義 §20 O-10）
    if (isRematch) hub.broadcastState(connection.instanceId);
}

// 着手を受理し、更新後の盤面をルーム全員（観戦者含む）へ配信する（要件定義 F-06・F-07）
function handleMove(
    hub: WebSocketHub,
    socket: WebSocket,
    connection: WebSocketConnection,
    message: Extract<ClientMessage, { type: "move" }>,
    log: Pick<Console, "log" | "error">,
): void {
    const result = hub.playMove(connection, message.gameId, message.square);
    if (!result.ok) {
        // 拒否した場合は盤面を変えず、要求元にだけエラーを返す（要件定義 §14 E-01〜E-04）
        log.log(
            `着手を拒否: userId=${connection.userId} square=${message.square} ` +
                `gameId=${message.gameId} code=${result.code}`,
        );
        sendError(socket, result.code, result.message);
        return;
    }
    log.log(`着手: userId=${connection.userId} square=${message.square} gameId=${message.gameId}`);
    hub.broadcastState(connection.instanceId);

    // F-10: 終局した場合は勝敗を確定して配信する。
    // 終局に伴うパスは終局理由（連続パス・完封）が伝えるため、パスの通知は行わない
    if (result.session.result !== null) {
        broadcastGameEnd(hub, connection.instanceId, result.session, log);
        return;
    }
    // F-09: 合法手が無い側は自動でパスする。盤面に続けてその旨を全員へ知らせる
    if (result.passedBy.length > 0) {
        log.log(`自動パス: gameId=${message.gameId} passedBy=${result.passedBy.join(",")}`);
        hub.broadcast(connection.instanceId, {
            type: "passed",
            gameId: message.gameId,
            passedBy: result.passedBy,
        });
    }
}

// 投了・中断を受理し、確定した結果を全員へ配信する（要件定義 F-11・F-12）
function handleGameEnd(
    hub: WebSocketHub,
    socket: WebSocket,
    connection: WebSocketConnection,
    message: Extract<ClientMessage, { type: "resign" | "abort" }>,
    log: Pick<Console, "log" | "error">,
): void {
    const isResign = message.type === "resign";
    const result = isResign
        ? hub.resignGame(connection, message.gameId)
        : hub.abortGame(connection, message.gameId);
    if (!result.ok) {
        log.log(
            `${isResign ? "投了" : "中断"}を拒否: userId=${connection.userId} ` +
                `gameId=${message.gameId} code=${result.code}`,
        );
        sendError(socket, result.code, result.message);
        return;
    }

    broadcastGameEnd(hub, connection.instanceId, result.session, log);
    // 中断した対局は破棄されるため、ロビーだけに戻ったルーム状態を配り直す（要件定義 §6）
    if (!isResign) hub.broadcastState(connection.instanceId);
}

// 確定した対局結果を全員へ配信し、ログへ残す（要件定義 §12 ログ / F-10）
function broadcastGameEnd(
    hub: WebSocketHub,
    instanceId: string,
    session: GameSession,
    log: Pick<Console, "log" | "error">,
): void {
    const result = session.result;
    if (result === null) return;

    const game = toGameView(session);
    hub.broadcast(instanceId, { type: "game_ended", game, result });
    log.log(
        `対局終了: gameId=${session.id} instanceId=${instanceId} reason=${result.reason} ` +
            `outcome=${result.outcome ?? "無効試合"} ` +
            `black=${game.scores.black} white=${game.scores.white}`,
    );
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
        case "rematch":
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
