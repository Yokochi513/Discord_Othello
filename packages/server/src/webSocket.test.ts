import type { AddressInfo } from "node:net";

import type { GameState, Participant, RoomState, ServerMessage } from "@othello/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { createStaticServer, type OthelloServer } from "./createServer.ts";

/** 対局に必要な 3 接続（黒番・白番・観戦者） */
type Players = { black: WebSocket; white: WebSocket; spectator: WebSocket };

describe("WebSocket server", () => {
    let server: OthelloServer;
    let baseUrl: string;
    const clients: WebSocket[] = [];
    // 配信は接続と非同期に届くため、受信をすべて溜めてから 1 通ずつ取り出す
    const inboxes = new Map<WebSocket, ServerMessage[]>();
    const log = { log: vi.fn(), error: vi.fn() };
    let gameCount = 0;

    beforeEach(async () => {
        gameCount = 0;
        server = createStaticServer({
            staticDir: process.cwd(),
            oauth: { clientId: "test", clientSecret: "test" },
            websocket: {
                authenticate: async (token) => {
                    if (!token.startsWith("token-")) throw new Error("invalid token");
                    const id = token.slice("token-".length);
                    return { id, displayName: participant(id).displayName };
                },
                createGameId: () => `game-${++gameCount}`,
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

    // 3 人を接続し、黒席・白席へ着席させる。観戦者は 1 名
    async function seatBoth(instanceId: string): Promise<Players> {
        const black = await connect("user-1", instanceId);
        const white = await connect("user-2", instanceId);
        await receiveState(black);
        const spectator = await connect("user-3", instanceId);
        await receiveState(black);
        await receiveState(white);

        const everyone = [black, white, spectator];
        black.send(JSON.stringify({ type: "seat", seat: "black" }));
        for (const client of everyone) await receiveState(client);
        white.send(JSON.stringify({ type: "seat", seat: "white" }));
        for (const client of everyone) await receiveState(client);
        return { black, white, spectator };
    }

    // 黒番の要求で対局を開始し、全員が game_started を受け取るまで読み進める
    async function startGame(players: Players): Promise<GameState> {
        players.black.send(JSON.stringify({ type: "start_game" }));
        let started: GameState | null = null;
        for (const client of [players.black, players.white, players.spectator]) {
            const message = await receive(client);
            if (message.type !== "game_started") {
                throw new Error(`game_started ではありません: ${message.type}`);
            }
            started = message.game;
        }
        return started as GameState;
    }

    // 次の state に載っている対局状態を取り出す
    async function receiveGame(client: WebSocket): Promise<GameState> {
        const state = await receiveState(client);
        if (state.game === null) throw new Error("対局が載っていません");
        return state.game;
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

    it("E-05: 別の対局IDを指定した操作を拒否する", async () => {
        const players = await seatBoth("room-a");
        await startGame(players);

        players.black.send(JSON.stringify({ type: "resign", gameId: "game-9" }));

        expect(await receive(players.black)).toEqual({
            type: "error",
            code: "game_not_found",
            message: "対局が見つかりません",
        });
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

    it("両席が埋まった状態で対局を開始し、全員へ配信する", async () => {
        const players = await seatBoth("room-a");

        const game = await startGame(players);

        expect(game).toMatchObject({
            id: "game-1",
            turn: "black",
            scores: { black: 2, white: 2 },
            moveCount: 0,
            lastMove: null,
            players: { black: participant("user-1"), white: participant("user-2") },
        });
        expect(game.board[3]).toEqual([
            "empty",
            "empty",
            "empty",
            "white",
            "black",
            ...Array(3).fill("empty"),
        ]);
        expect(log.log).toHaveBeenCalledWith(
            "対局開始: gameId=game-1 instanceId=room-a black=user-1 white=user-2",
        );
    });

    it("着手を観戦者を含む全員へ配信する", async () => {
        const players = await seatBoth("room-a");
        await startGame(players);

        players.black.send(JSON.stringify({ type: "move", gameId: "game-1", square: "d3" }));

        for (const client of [players.black, players.white, players.spectator]) {
            expect(await receiveGame(client)).toMatchObject({
                id: "game-1",
                turn: "white",
                scores: { black: 4, white: 1 },
                moveCount: 1,
                lastMove: "d3",
            });
        }
    });

    it("E-01: 手番でない側の着手を拒否し、盤面を変えない", async () => {
        const players = await seatBoth("room-a");
        await startGame(players);

        players.white.send(JSON.stringify({ type: "move", gameId: "game-1", square: "e6" }));

        expect(await receive(players.white)).toEqual({
            type: "error",
            code: "invalid_state",
            message: "手番ではありません",
        });
        expect(server.webSocketHub.game("room-a")?.state.moveCount).toBe(0);
        await expectNoBroadcast(players.black);
    });

    it("E-02: 非合法手を拒否する", async () => {
        const players = await seatBoth("room-a");
        await startGame(players);

        players.black.send(JSON.stringify({ type: "move", gameId: "game-1", square: "a1" }));

        expect(await receive(players.black)).toEqual({
            type: "error",
            code: "illegal_move",
            message: "そのマスには打てません",
        });
        expect(server.webSocketHub.game("room-a")?.state.moveCount).toBe(0);
        await expectNoBroadcast(players.white);
    });

    it("E-03: 観戦者の着手を拒否する", async () => {
        const players = await seatBoth("room-a");
        await startGame(players);

        players.spectator.send(JSON.stringify({ type: "move", gameId: "game-1", square: "d3" }));

        expect(await receive(players.spectator)).toEqual({
            type: "error",
            code: "unauthorized",
            message: "観戦者は着手できません",
        });
        await expectNoBroadcast(players.black);
    });

    it("両席が埋まる前の対局開始を拒否する", async () => {
        const client = await connect("user-1", "room-a");
        client.send(JSON.stringify({ type: "seat", seat: "black" }));
        await receiveState(client);

        client.send(JSON.stringify({ type: "start_game" }));

        expect(await receive(client)).toEqual({
            type: "error",
            code: "invalid_state",
            message: "両席が埋まるまで対局を開始できません",
        });
        expect(server.webSocketHub.game("room-a")).toBeNull();
    });

    it("進行中の対局があるうちは新しい対局を始めない", async () => {
        const players = await seatBoth("room-a");
        await startGame(players);

        players.white.send(JSON.stringify({ type: "start_game" }));

        expect(await receive(players.white)).toEqual({
            type: "error",
            code: "invalid_state",
            message: "対局が既に進行中です",
        });
    });

    it("観戦者からの対局開始を拒否する", async () => {
        const players = await seatBoth("room-a");

        players.spectator.send(JSON.stringify({ type: "start_game" }));

        expect(await receive(players.spectator)).toEqual({
            type: "error",
            code: "unauthorized",
            message: "対局者だけが開始できます",
        });
        expect(server.webSocketHub.game("room-a")).toBeNull();
    });

    it("接続直後の状態に進行中の対局を載せる", async () => {
        const players = await seatBoth("room-a");
        await startGame(players);

        const late = open("access_token=token-user-4&instance_id=room-a");
        expect(await receive(late)).toMatchObject({ type: "connected" });

        expect((await receiveState(late)).game).toMatchObject({ id: "game-1", turn: "black" });
    });

    it("同時に進む対局は互いに影響しない", async () => {
        const roomA = await seatBoth("room-a");
        await startGame(roomA);
        const roomB = await seatBoth("room-b");
        await startGame(roomB);

        roomA.black.send(JSON.stringify({ type: "move", gameId: "game-1", square: "d3" }));

        for (const client of [roomA.black, roomA.white, roomA.spectator]) {
            expect((await receiveGame(client)).moveCount).toBe(1);
        }
        expect(server.webSocketHub.game("room-b")?.id).toBe("game-2");
        expect(server.webSocketHub.game("room-b")?.state.moveCount).toBe(0);
        await expectNoBroadcast(roomB.black);
    });
});
