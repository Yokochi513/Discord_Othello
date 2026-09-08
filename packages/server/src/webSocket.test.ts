import type { AddressInfo } from "node:net";

import type { Participant, RoomState, ServerMessage } from "@othello/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { createStaticServer, type OthelloServer } from "./createServer.ts";

describe("WebSocket server", () => {
    let server: OthelloServer;
    let baseUrl: string;
    const clients: WebSocket[] = [];
    // 配信は接続と非同期に届くため、受信をすべて溜めてから 1 通ずつ取り出す
    const inboxes = new Map<WebSocket, ServerMessage[]>();
    const log = { log: vi.fn(), error: vi.fn() };

    beforeEach(async () => {
        server = createStaticServer({
            staticDir: process.cwd(),
            oauth: { clientId: "test", clientSecret: "test" },
            websocket: {
                authenticate: async (token) => {
                    if (!token.startsWith("token-")) throw new Error("invalid token");
                    const id = token.slice("token-".length);
                    return { id, displayName: participant(id).displayName };
                },
                log,
            },
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const { port } = server.address() as AddressInfo;
        baseUrl = `ws://127.0.0.1:${port}`;
    });

    afterEach(async () => {
        for (const client of clients) client.terminate();
        clients.length = 0;
        inboxes.clear();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        vi.clearAllMocks();
    });

    function participant(userId: string): Participant {
        return { userId, displayName: `${userId}の表示名` };
    }

    // 受信を溜め始めたクライアントを作る（まだ open は待たない）
    function open(query: string): WebSocket {
        const client = new WebSocket(`${baseUrl}/ws?${query}`);
        clients.push(client);
        const inbox: ServerMessage[] = [];
        inboxes.set(client, inbox);
        client.on("message", (data) => inbox.push(JSON.parse(data.toString()) as ServerMessage));
        return client;
    }

    // 接続し、自分宛の connected と直後のロビー配信を読み飛ばす
    async function connect(userId: string, instanceId: string): Promise<WebSocket> {
        const client = open(`access_token=token-${userId}&instance_id=${instanceId}`);
        await new Promise<void>((resolve, reject) => {
            client.once("open", () => resolve());
            client.once("error", reject);
        });
        expect(await receive(client)).toMatchObject({ type: "connected" });
        expect(await receive(client)).toMatchObject({ type: "state" });
        return client;
    }

    // 溜まっている受信の先頭を 1 通取り出す
    async function receive(client: WebSocket): Promise<ServerMessage> {
        const inbox = inboxes.get(client) ?? [];
        await vi.waitFor(() => {
            if (inbox.length === 0) throw new Error("メッセージが届いていません");
        });
        return inbox.shift() as ServerMessage;
    }

    // 溜まっている受信のうち、次の state のルーム状態を取り出す
    async function receiveState(client: WebSocket): Promise<RoomState> {
        const message = await receive(client);
        if (message.type !== "state") throw new Error(`state ではありません: ${message.type}`);
        return message.state;
    }

    // 配信が届いていないことを確かめる。
    // 不正なメッセージへの応答は同じソケット上で順序が保たれるため、
    // これが先頭で受け取れれば、それ以前の配信がなかったと言い切れる。
    async function expectNoBroadcast(client: WebSocket): Promise<void> {
        client.send("not-json");
        expect(await receive(client)).toMatchObject({ type: "error", code: "invalid_message" });
        expect(inboxes.get(client)).toEqual([]);
    }

    it("認証したユーザーとインスタンスを接続通知に含める", async () => {
        const client = open("access_token=token-user-1&instance_id=room-a");

        expect(await receive(client)).toEqual({
            type: "connected",
            userId: "user-1",
            instanceId: "room-a",
        });
        expect(server.webSocketHub.connectionCount("room-a")).toBe(1);
        expect(log.log).toHaveBeenCalledWith("WebSocket 接続: userId=user-1 instanceId=room-a");
    });

    it("接続した参加者を観戦者としてロビーへ加える", async () => {
        const client = open("access_token=token-user-1&instance_id=room-a");
        await receive(client);

        expect(await receiveState(client)).toEqual({
            instanceId: "room-a",
            seats: { black: null, white: null },
            spectators: [participant("user-1")],
            game: null,
        });
    });

    it("同一インスタンスの全接続だけに配信する", async () => {
        const roomA1 = await connect("user-1", "room-a");
        const roomA2 = await connect("user-2", "room-a");
        const roomB = await connect("user-3", "room-b");
        await receive(roomA1); // user-2 の参加によるロビー配信
        const state: ServerMessage = {
            type: "state",
            state: {
                instanceId: "room-a",
                seats: { black: null, white: null },
                spectators: [],
                game: null,
            },
        };

        server.webSocketHub.broadcast("room-a", state);

        expect(await receive(roomA1)).toEqual(state);
        expect(await receive(roomA2)).toEqual(state);
        await expectNoBroadcast(roomB);
    });

    it("認証情報がない接続を拒否する", async () => {
        const client = open("instance_id=room-a");
        client.on("error", () => undefined);
        const response = await new Promise<number>((resolve) =>
            client.once("unexpected-response", (_request, res) => resolve(res.statusCode ?? 0)),
        );
        expect(response).toBe(401);
    });

    it("メッセージ本文によるユーザー・インスタンス偽装を拒否する", async () => {
        const client = await connect("user-1", "room-a");

        client.send(JSON.stringify({ type: "seat", seat: "black", instanceId: "room-b" }));

        expect(await receive(client)).toMatchObject({ type: "error", code: "invalid_message" });
    });

    it("別の対局IDを指定した操作を拒否する", async () => {
        const client = await connect("user-1", "room-a");
        server.webSocketHub.broadcast("room-a", {
            type: "game_started",
            game: { id: "game-1", board: [], turn: "black" },
        });
        expect(await receive(client)).toMatchObject({ type: "game_started" });

        client.send(JSON.stringify({ type: "resign", gameId: "game-2" }));

        expect(await receive(client)).toMatchObject({ type: "error", code: "unauthorized" });
    });

    it("2 クライアントが黒席・白席へ着席し、双方へ同じ座席状況が届く", async () => {
        const black = await connect("user-1", "room-a");
        const white = await connect("user-2", "room-a");
        await receive(black); // user-2 の参加によるロビー配信

        black.send(JSON.stringify({ type: "seat", seat: "black" }));
        expect(await receiveState(black)).toMatchObject({
            seats: { black: participant("user-1"), white: null },
            spectators: [participant("user-2")],
        });
        await receiveState(white);

        white.send(JSON.stringify({ type: "seat", seat: "white" }));
        const seated = {
            instanceId: "room-a",
            seats: { black: participant("user-1"), white: participant("user-2") },
            spectators: [],
            game: null,
        };
        expect(await receiveState(black)).toEqual(seated);
        expect(await receiveState(white)).toEqual(seated);
    });

    it("埋まった席への着席を拒否する", async () => {
        const black = await connect("user-1", "room-a");
        const other = await connect("user-2", "room-a");
        await receive(black);
        black.send(JSON.stringify({ type: "seat", seat: "black" }));
        await receiveState(black);
        await receiveState(other);

        other.send(JSON.stringify({ type: "seat", seat: "black" }));

        expect(await receive(other)).toEqual({
            type: "error",
            code: "seat_unavailable",
            message: "その席は既に埋まっています",
        });
        expect(server.webSocketHub.lobby("room-a").seats.black).toEqual(participant("user-1"));
        await expectNoBroadcast(black);
    });

    it("退席した参加者を観戦者に戻して全員へ配信する", async () => {
        const black = await connect("user-1", "room-a");
        const spectator = await connect("user-2", "room-a");
        await receive(black);
        black.send(JSON.stringify({ type: "seat", seat: "black" }));
        await receiveState(black);
        await receiveState(spectator);

        black.send(JSON.stringify({ type: "leave" }));

        const left = {
            instanceId: "room-a",
            seats: { black: null, white: null },
            spectators: [participant("user-2"), participant("user-1")],
            game: null,
        };
        expect(await receiveState(black)).toEqual(left);
        expect(await receiveState(spectator)).toEqual(left);
    });

    it("着席していない参加者の退席では配信しない", async () => {
        const client = await connect("user-1", "room-a");

        client.send(JSON.stringify({ type: "leave" }));

        await expectNoBroadcast(client);
    });

    it("切断した参加者をロビーから外して残りの全員へ配信する", async () => {
        const leaving = await connect("user-1", "room-a");
        const staying = await connect("user-2", "room-a");
        leaving.send(JSON.stringify({ type: "seat", seat: "black" }));
        await receiveState(staying);

        leaving.close();

        expect(await receiveState(staying)).toEqual({
            instanceId: "room-a",
            seats: { black: null, white: null },
            spectators: [participant("user-2")],
            game: null,
        });
    });

    it("切断後にルームから除きログを残す", async () => {
        const client = await connect("user-1", "room-a");
        const closed = new Promise<void>((resolve) => client.once("close", () => resolve()));
        client.close();
        await closed;

        await vi.waitFor(() => {
            expect(server.webSocketHub.connectionCount("room-a")).toBe(0);
        });
        expect(log.log).toHaveBeenCalledWith("WebSocket 切断: userId=user-1 instanceId=room-a");
        expect(server.webSocketHub.lobby("room-a").spectators).toEqual([]);
    });
});
