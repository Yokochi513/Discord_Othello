import type { AddressInfo } from "node:net";

import type { ServerMessage } from "@othello/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { createStaticServer, type OthelloServer } from "./createServer.ts";

describe("WebSocket server", () => {
    let server: OthelloServer;
    let baseUrl: string;
    const clients: WebSocket[] = [];
    const log = { log: vi.fn(), error: vi.fn() };

    beforeEach(async () => {
        server = createStaticServer({
            staticDir: process.cwd(),
            oauth: { clientId: "test", clientSecret: "test" },
            websocket: {
                authenticate: async (token) => {
                    if (!token.startsWith("token-")) throw new Error("invalid token");
                    return { id: token.slice("token-".length) };
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
        await new Promise<void>((resolve) => server.close(() => resolve()));
        vi.clearAllMocks();
    });

    async function connect(userId: string, instanceId: string): Promise<WebSocket> {
        const client = new WebSocket(
            `${baseUrl}/ws?access_token=token-${userId}&instance_id=${instanceId}`,
        );
        clients.push(client);
        const connected = nextMessage(client);
        await new Promise<void>((resolve, reject) => {
            client.once("open", () => resolve());
            client.once("error", reject);
        });
        await connected;
        return client;
    }

    async function nextMessage(client: WebSocket): Promise<ServerMessage> {
        return new Promise((resolve) =>
            client.once("message", (data) => resolve(JSON.parse(data.toString()) as ServerMessage)),
        );
    }

    it("認証したユーザーとインスタンスを接続通知に含める", async () => {
        const client = new WebSocket(`${baseUrl}/ws?access_token=token-user-1&instance_id=room-a`);
        clients.push(client);
        const messagePromise = nextMessage(client);

        expect(await messagePromise).toEqual({
            type: "connected",
            userId: "user-1",
            instanceId: "room-a",
        });
        expect(server.webSocketHub.connectionCount("room-a")).toBe(1);
        expect(log.log).toHaveBeenCalledWith(
            "WebSocket 接続: userId=user-1 instanceId=room-a",
        );
    });

    it("同一インスタンスの全接続だけに配信する", async () => {
        const roomA1 = await connect("user-1", "room-a");
        const roomA2 = await connect("user-2", "room-a");
        const roomB = await connect("user-3", "room-b");
        const receivedA1 = nextMessage(roomA1);
        const receivedA2 = nextMessage(roomA2);
        const roomBMessages: string[] = [];
        roomB.on("message", (data) => roomBMessages.push(data.toString()));
        const state: ServerMessage = {
            type: "state",
            state: {
                instanceId: "room-a",
                seats: { black: null, white: null },
                game: null,
            },
        };

        server.webSocketHub.broadcast("room-a", state);

        expect(await Promise.all([receivedA1, receivedA2])).toEqual([state, state]);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(roomBMessages).toEqual([]);
    });

    it("認証情報がない接続を拒否する", async () => {
        const client = new WebSocket(`${baseUrl}/ws?instance_id=room-a`);
        client.on("error", () => undefined);
        clients.push(client);
        const response = await new Promise<number>((resolve) =>
            client.once("unexpected-response", (_request, res) => resolve(res.statusCode ?? 0)),
        );
        expect(response).toBe(401);
    });

    it("メッセージ本文によるユーザー・インスタンス偽装を拒否する", async () => {
        const client = await connect("user-1", "room-a");
        const response = nextMessage(client);

        client.send(JSON.stringify({ type: "seat", seat: "black", instanceId: "room-b" }));

        expect(await response).toMatchObject({ type: "error", code: "invalid_message" });
    });

    it("別の対局IDを指定した操作を拒否する", async () => {
        const client = await connect("user-1", "room-a");
        server.webSocketHub.broadcast("room-a", {
            type: "game_started",
            game: { id: "game-1", board: [], turn: "black" },
        });
        await nextMessage(client);
        const response = nextMessage(client);

        client.send(JSON.stringify({ type: "resign", gameId: "game-2" }));

        expect(await response).toMatchObject({ type: "error", code: "unauthorized" });
    });

    it("切断後にルームから除きログを残す", async () => {
        const client = await connect("user-1", "room-a");
        const closed = new Promise<void>((resolve) => client.once("close", () => resolve()));
        client.close();
        await closed;

        await vi.waitFor(() => {
            expect(server.webSocketHub.connectionCount("room-a")).toBe(0);
        });
        expect(log.log).toHaveBeenCalledWith(
            "WebSocket 切断: userId=user-1 instanceId=room-a",
        );
    });
});
