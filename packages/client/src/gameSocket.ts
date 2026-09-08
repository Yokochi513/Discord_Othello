/**
 * サーバーとの WebSocket 接続の管理。
 *
 * 接続先は api.ts が Discord のプロキシ（`/.proxy/`）込みで解決する（要件定義 §13）。
 * 受け取った通知は roomState.ts の状態遷移へ渡すだけで、盤面の判定はここでは行わない。
 *
 * 切断したときは待ち時間を延ばしながら再接続を試みる。
 * 局面の復帰そのものはサーバーが接続直後に配る状態通知に委ね、
 * 猶予つきの本格的な復帰処理は M5（要件定義 §11.3 / F-14）で扱う。
 */

import type { ClientMessage, ServerMessage } from "@othello/protocol";

import type { ConnectionStatus } from "./roomState.ts";

/** 送受信に使う WebSocket の最小機能。テストでは差し替えられる。 */
export type SocketLike = {
    /** 文字列フレームを送る
     * @param data 送信するフレーム
     */
    send(data: string): void;
    /** 接続を閉じる */
    close(): void;
};

/** 接続で起きた出来事の受け口。 */
export type SocketHandlers = {
    /** 接続が確立した */
    readonly onOpen: () => void;
    /** フレームを受信した */
    readonly onMessage: (data: string) => void;
    /** 接続が閉じた（確立前の失敗を含む） */
    readonly onClose: () => void;
};

/** 接続を作る関数。既定はブラウザの WebSocket を使う。 */
export type CreateSocket = (url: string, handlers: SocketHandlers) => SocketLike;

/** GameSocket の構成。 */
export type GameSocketOptions = {
    /** 接続先の WebSocket URL */
    readonly url: string;
    /** サーバー通知を受け取る */
    readonly onMessage: (message: ServerMessage) => void;
    /** 接続状態の変化を受け取る */
    readonly onStatus: (status: ConnectionStatus) => void;
    /** 画面に出すべきエラーを受け取る（要件定義 §14 E-15） */
    readonly onError: (message: string) => void;
    /** 接続の作り方。テストでは差し替える */
    readonly createSocket?: CreateSocket;
};

/**
 * 再接続の待ち時間。試行のたびに延ばし、使い切ったら諦めて画面に再読み込みを促す。
 * 短時間の通信断は前半の試行で拾い、長い断は M5 の復帰処理に任せる。
 */
const RECONNECT_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 15_000];

/** サーバーとの 1 本の接続を保ち、切断時には再接続を試みる。 */
export class GameSocket {
    readonly #options: GameSocketOptions;
    readonly #createSocket: CreateSocket;
    #socket: SocketLike | null = null;
    #open = false;
    #timer: ReturnType<typeof setTimeout> | null = null;
    #attempt = 0;
    #closed = false;

    /**
     * 接続を構成する。この時点では接続しない。
     * @param options 接続先と各種の受け口
     */
    constructor(options: GameSocketOptions) {
        this.#options = options;
        this.#createSocket = options.createSocket ?? createBrowserSocket;
    }

    /** 接続を開始する。既に接続中・接続済みの場合は何もしない。 */
    connect(): void {
        if (this.#closed || this.#socket !== null) return;

        this.#options.onStatus(this.#attempt === 0 ? "connecting" : "reconnecting");
        this.#socket = this.#createSocket(this.#options.url, {
            onOpen: () => {
                this.#open = true;
                this.#attempt = 0;
                this.#options.onStatus("open");
            },
            onMessage: (data) => {
                const message = parseServerMessage(data);
                if (message === null) {
                    this.#options.onError("サーバーから解釈できない通知が届きました");
                    return;
                }
                this.#options.onMessage(message);
            },
            onClose: () => {
                this.#socket = null;
                this.#open = false;
                this.#scheduleReconnect();
            },
        });
    }

    /**
     * 操作をサーバーへ送る。
     * @param message 送信するクライアントメッセージ
     * @returns 送信できたら true。未接続で送れなければ false
     */
    send(message: ClientMessage): boolean {
        if (this.#socket === null || !this.#open) {
            this.#options.onError("サーバーへ接続していないため操作を送信できませんでした");
            return false;
        }
        this.#socket.send(JSON.stringify(message));
        return true;
    }

    /** 接続を閉じ、以後の再接続も止める。 */
    close(): void {
        this.#closed = true;
        if (this.#timer !== null) {
            clearTimeout(this.#timer);
            this.#timer = null;
        }
        const socket = this.#socket;
        this.#socket = null;
        this.#open = false;
        socket?.close();
    }

    // 待ち時間を置いて接続をやり直す。試行を使い切ったら諦め、利用者に再読み込みを促す
    #scheduleReconnect(): void {
        if (this.#closed) return;

        const delay = RECONNECT_DELAYS_MS[this.#attempt];
        if (delay === undefined) {
            this.#options.onStatus("closed");
            this.#options.onError(
                "サーバーへ再接続できませんでした。画面を開き直してください（対局はサーバーに残っています）",
            );
            return;
        }

        this.#attempt += 1;
        this.#options.onStatus("reconnecting");
        this.#timer = setTimeout(() => {
            this.#timer = null;
            this.connect();
        }, delay);
    }
}

/**
 * 受信したフレームをサーバーメッセージとして解釈する。
 * サーバーを唯一の正とするため中身の妥当性までは検査せず、
 * 種別と必須項目の有無だけを確かめて描画時の破綻を防ぐ（要件定義 §5.4）。
 * @param data 受信したフレーム
 * @returns サーバーメッセージ。解釈できなければ null
 */
export function parseServerMessage(data: string): ServerMessage | null {
    let value: unknown;
    try {
        value = JSON.parse(data);
    } catch {
        return null;
    }
    if (!isRecord(value)) return null;

    switch (value.type) {
        case "connected":
            return isText(value.userId) && isText(value.instanceId) ? toMessage(value) : null;
        case "state":
            return isRecord(value.state) ? toMessage(value) : null;
        case "game_started":
            return isRecord(value.game) ? toMessage(value) : null;
        case "passed":
            return isText(value.gameId) && isSeatList(value.passedBy) ? toMessage(value) : null;
        case "game_ended":
            return isRecord(value.game) && isRecord(value.result) ? toMessage(value) : null;
        case "error":
            return isText(value.code) && isText(value.message) ? toMessage(value) : null;
        default:
            return null;
    }
}

// ブラウザの WebSocket を SocketLike として使えるようにする
function createBrowserSocket(url: string, handlers: SocketHandlers): SocketLike {
    const socket = new WebSocket(url);
    socket.onopen = () => handlers.onOpen();
    socket.onmessage = (event: MessageEvent<unknown>) => {
        if (typeof event.data === "string") handlers.onMessage(event.data);
    };
    // error の直後には必ず close が届くため、再接続は close 側だけで扱う
    socket.onclose = () => handlers.onClose();
    return {
        send: (data) => socket.send(data),
        close: () => socket.close(),
    };
}

function toMessage(value: Record<string, unknown>): ServerMessage {
    return value as unknown as ServerMessage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

function isSeatList(value: unknown): boolean {
    return Array.isArray(value) && value.every((seat) => seat === "black" || seat === "white");
}
