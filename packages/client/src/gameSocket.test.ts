import type { ServerMessage } from "@othello/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    GameSocket,
    parseServerMessage,
    type CreateSocket,
    type SocketHandlers,
} from "./gameSocket.ts";
import type { ConnectionStatus } from "./roomState.ts";

type FakeSocket = {
    readonly url: string;
    readonly handlers: SocketHandlers;
    readonly sent: string[];
    closed: boolean;
};

// 生成された接続を記録するだけの差し替え実装
function createFakeFactory(): { sockets: FakeSocket[]; createSocket: CreateSocket } {
    const sockets: FakeSocket[] = [];
    const createSocket: CreateSocket = (url, handlers) => {
        const socket: FakeSocket = { url, handlers, sent: [], closed: false };
        sockets.push(socket);
        return {
            send: (data) => socket.sent.push(data),
            close: () => {
                socket.closed = true;
            },
        };
    };
    return { sockets, createSocket };
}

function setup(): {
    socket: GameSocket;
    sockets: FakeSocket[];
    messages: ServerMessage[];
    statuses: ConnectionStatus[];
    errors: string[];
} {
    const { sockets, createSocket } = createFakeFactory();
    const messages: ServerMessage[] = [];
    const statuses: ConnectionStatus[] = [];
    const errors: string[] = [];
    const socket = new GameSocket({
        url: "wss://example.discordsays.com/.proxy/ws?access_token=t&instance_id=i",
        onMessage: (message) => messages.push(message),
        onStatus: (status) => statuses.push(status),
        onError: (message) => errors.push(message),
        createSocket,
    });
    return { socket, sockets, messages, statuses, errors };
}

// 直近の接続を切断させる
function disconnect(sockets: readonly FakeSocket[]): void {
    sockets[sockets.length - 1]?.handlers.onClose();
}

describe("GameSocket", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("接続を開始すると接続中になる", () => {
        const { socket, sockets, statuses } = setup();

        socket.connect();

        expect(sockets).toHaveLength(1);
        expect(sockets[0]?.url).toContain("/.proxy/ws");
        expect(statuses).toEqual(["connecting"]);
    });

    it("確立したら接続済みになる", () => {
        const { socket, sockets, statuses } = setup();
        socket.connect();

        sockets[0]?.handlers.onOpen();

        expect(statuses).toEqual(["connecting", "open"]);
    });

    it("受信した通知を解釈して渡す", () => {
        const { socket, sockets, messages } = setup();
        socket.connect();
        sockets[0]?.handlers.onOpen();

        sockets[0]?.handlers.onMessage(
            JSON.stringify({ type: "connected", userId: "u1", instanceId: "i1" }),
        );

        expect(messages).toEqual([{ type: "connected", userId: "u1", instanceId: "i1" }]);
    });

    it("解釈できない通知はエラーとして知らせる", () => {
        const { socket, sockets, messages, errors } = setup();
        socket.connect();
        sockets[0]?.handlers.onOpen();

        sockets[0]?.handlers.onMessage("{");

        expect(messages).toEqual([]);
        expect(errors).toHaveLength(1);
    });

    it("接続済みなら操作を送信する", () => {
        const { socket, sockets } = setup();
        socket.connect();
        sockets[0]?.handlers.onOpen();

        expect(socket.send({ type: "seat", seat: "black" })).toBe(true);
        expect(sockets[0]?.sent).toEqual([JSON.stringify({ type: "seat", seat: "black" })]);
    });

    it("未接続では送信せずエラーを知らせる", () => {
        const { socket, sockets, errors } = setup();
        socket.connect();

        expect(socket.send({ type: "leave" })).toBe(false);
        expect(sockets[0]?.sent).toEqual([]);
        expect(errors).toHaveLength(1);
    });

    it("切断されたら待ち時間を置いて再接続する", () => {
        const { socket, sockets, statuses } = setup();
        socket.connect();
        sockets[0]?.handlers.onOpen();

        disconnect(sockets);
        expect(statuses.at(-1)).toBe("reconnecting");
        expect(sockets).toHaveLength(1);

        vi.advanceTimersByTime(1_000);
        expect(sockets).toHaveLength(2);
    });

    it("再接続の試行を使い切ったら諦めて再読み込みを促す", () => {
        const { socket, sockets, statuses, errors } = setup();
        socket.connect();

        // 試行ごとに待ち時間が延びるため、十分な時間を進めて次の接続を起こす
        for (let attempt = 0; attempt < 5; attempt += 1) {
            disconnect(sockets);
            vi.advanceTimersByTime(60_000);
        }
        expect(sockets).toHaveLength(6);

        disconnect(sockets);

        expect(statuses.at(-1)).toBe("closed");
        expect(errors.at(-1)).toContain("開き直して");
    });

    it("閉じたあとは再接続しない", () => {
        const { socket, sockets } = setup();
        socket.connect();
        sockets[0]?.handlers.onOpen();

        socket.close();
        expect(sockets[0]?.closed).toBe(true);

        disconnect(sockets);
        vi.advanceTimersByTime(60_000);
        expect(sockets).toHaveLength(1);
    });
});

describe("parseServerMessage", () => {
    it("ルーム状態の通知を受け取る", () => {
        const message = { type: "state", state: { instanceId: "i1" } };

        expect(parseServerMessage(JSON.stringify(message))).toEqual(message);
    });

    it("JSON として読めない入力は拒否する", () => {
        expect(parseServerMessage("not json")).toBeNull();
    });

    it("知らない種別は拒否する", () => {
        expect(parseServerMessage(JSON.stringify({ type: "unknown" }))).toBeNull();
    });

    it("必須項目が欠けた通知は拒否する", () => {
        expect(parseServerMessage(JSON.stringify({ type: "connected", userId: "u1" }))).toBeNull();
        expect(parseServerMessage(JSON.stringify({ type: "game_started" }))).toBeNull();
        expect(
            parseServerMessage(JSON.stringify({ type: "passed", gameId: "g1", passedBy: ["red"] })),
        ).toBeNull();
    });

    it("配列や null は拒否する", () => {
        expect(parseServerMessage("[]")).toBeNull();
        expect(parseServerMessage("null")).toBeNull();
    });
});
