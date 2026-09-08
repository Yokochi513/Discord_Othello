import type {
    GameResult,
    GameState,
    Participant,
    RoomState,
    ServerMessage,
} from "@othello/protocol";
import { describe, expect, it } from "vitest";

import {
    initialClientState,
    reduceClientState,
    selectGame,
    selectIsPlayer,
    selectPhase,
    selectSeat,
    type ClientEvent,
    type ClientState,
} from "./roomState.ts";

const alice: Participant = { userId: "u-alice", displayName: "アリス" };
const bob: Participant = { userId: "u-bob", displayName: "ボブ" };
const carol: Participant = { userId: "u-carol", displayName: "キャロル" };

const emptyBoard: readonly (readonly ("black" | "white" | "empty")[])[] = Array.from(
    { length: 8 },
    () => Array.from({ length: 8 }, () => "empty" as const),
);

function makeGame(overrides: Partial<GameState> = {}): GameState {
    return {
        id: "game-1",
        board: emptyBoard,
        turn: "black",
        scores: { black: 2, white: 2 },
        moveCount: 0,
        lastMove: null,
        players: { black: alice, white: bob },
        result: null,
        ...overrides,
    };
}

function makeRoom(overrides: Partial<RoomState> = {}): RoomState {
    return {
        instanceId: "instance-1",
        seats: { black: null, white: null },
        spectators: [],
        game: null,
        ...overrides,
    };
}

// 一連の出来事をまとめて適用する
function reduceAll(events: readonly ClientEvent[], from = initialClientState): ClientState {
    return events.reduce(reduceClientState, from);
}

function received(message: ServerMessage): ClientEvent {
    return { type: "message_received", message };
}

const connected = received({
    type: "connected",
    userId: alice.userId,
    instanceId: "instance-1",
});

const seatedRoom = makeRoom({ seats: { black: alice, white: bob }, spectators: [carol] });
const resignResult: GameResult = { reason: "resign", outcome: "white_win" };

describe("reduceClientState", () => {
    it("接続前はどの画面も出さない", () => {
        expect(selectPhase(initialClientState)).toBe("connecting");
        expect(initialClientState.userId).toBeNull();
    });

    it("connected で自分の識別情報を確定する", () => {
        const state = reduceClientState(initialClientState, connected);

        expect(state.connection).toBe("open");
        expect(state.userId).toBe(alice.userId);
        expect(state.instanceId).toBe("instance-1");
    });

    it("state 通知でロビー画面へ遷移する", () => {
        const state = reduceAll([connected, received({ type: "state", state: seatedRoom })]);

        expect(selectPhase(state)).toBe("lobby");
        expect(state.room).toEqual(seatedRoom);
    });

    it("進行中の対局を含む state 通知で対局画面へ遷移する", () => {
        const state = reduceAll([
            connected,
            received({ type: "state", state: { ...seatedRoom, game: makeGame() } }),
        ]);

        expect(selectPhase(state)).toBe("playing");
        expect(selectGame(state)?.id).toBe("game-1");
    });

    it("game_started で対局画面へ遷移する", () => {
        const state = reduceAll([
            connected,
            received({ type: "state", state: seatedRoom }),
            received({ type: "game_started", game: makeGame() }),
        ]);

        expect(selectPhase(state)).toBe("playing");
        expect(state.room?.game?.id).toBe("game-1");
    });

    it("game_ended で終局画面へ遷移し、結果を保持する", () => {
        const ended = makeGame({ turn: null, result: resignResult });
        const state = reduceAll([
            connected,
            received({ type: "state", state: { ...seatedRoom, game: makeGame() } }),
            received({ type: "game_ended", game: ended, result: resignResult }),
        ]);

        expect(selectPhase(state)).toBe("finished");
        expect(state.finished).toEqual({ game: ended, result: resignResult });
        expect(selectGame(state)).toEqual(ended);
    });

    it("中断で対局が消えた state が届いても終局画面は残す", () => {
        const aborted = makeGame({ turn: null, result: { reason: "abort", outcome: null } });
        const state = reduceAll([
            connected,
            received({ type: "state", state: { ...seatedRoom, game: makeGame() } }),
            received({
                type: "game_ended",
                game: aborted,
                result: { reason: "abort", outcome: null },
            }),
            received({ type: "state", state: seatedRoom }),
        ]);

        expect(selectPhase(state)).toBe("finished");
    });

    it("ロビーへ戻ると終局画面を畳む", () => {
        const ended = makeGame({ turn: null, result: resignResult });
        const state = reduceAll([
            connected,
            received({ type: "state", state: { ...seatedRoom, game: makeGame() } }),
            received({ type: "game_ended", game: ended, result: resignResult }),
            { type: "returned_to_lobby" },
        ]);

        expect(selectPhase(state)).toBe("lobby");
        expect(state.finished).toBeNull();
    });

    it("次の対局が始まると終局画面を畳む", () => {
        const ended = makeGame({ turn: null, result: resignResult });
        const next = makeGame({ id: "game-2" });
        const state = reduceAll([
            connected,
            received({ type: "state", state: { ...seatedRoom, game: makeGame() } }),
            received({ type: "game_ended", game: ended, result: resignResult }),
            received({ type: "game_started", game: next }),
        ]);

        expect(selectPhase(state)).toBe("playing");
        expect(selectGame(state)?.id).toBe("game-2");
    });

    it("パス通知を保持し、次の盤面が届いたら消す", () => {
        const withPass = reduceAll([
            connected,
            received({ type: "state", state: { ...seatedRoom, game: makeGame() } }),
            received({ type: "passed", gameId: "game-1", passedBy: ["white"] }),
        ]);
        expect(withPass.passedBy).toEqual(["white"]);

        const afterMove = reduceClientState(
            withPass,
            received({ type: "state", state: { ...seatedRoom, game: makeGame({ moveCount: 2 }) } }),
        );
        expect(afterMove.passedBy).toEqual([]);
    });

    it("表示していない対局のパス通知は捨てる", () => {
        const state = reduceAll([
            connected,
            received({ type: "state", state: { ...seatedRoom, game: makeGame() } }),
            received({ type: "passed", gameId: "game-old", passedBy: ["black"] }),
        ]);

        expect(state.passedBy).toEqual([]);
    });

    it("エラー通知を表示し、閉じると消える", () => {
        const withError = reduceAll([
            connected,
            received({ type: "error", code: "illegal_move", message: "そのマスには打てません" }),
        ]);
        expect(withError.errorMessage).toBe("そのマスには打てません");

        expect(reduceClientState(withError, { type: "error_dismissed" }).errorMessage).toBeNull();
    });

    it("クライアント側のエラーも同じ場所へ出す", () => {
        const state = reduceClientState(initialClientState, {
            type: "local_error",
            message: "サーバーへ接続していないため操作を送信できませんでした",
        });

        expect(state.errorMessage).toBe("サーバーへ接続していないため操作を送信できませんでした");
    });

    it("接続が切れても直前の状態は保持する", () => {
        const playing = reduceAll([
            connected,
            received({ type: "state", state: { ...seatedRoom, game: makeGame() } }),
        ]);

        const disconnected = reduceClientState(playing, {
            type: "connection_changed",
            status: "reconnecting",
        });

        expect(disconnected.connection).toBe("reconnecting");
        expect(selectPhase(disconnected)).toBe("playing");
        expect(disconnected.room).toEqual(playing.room);
    });
});

describe("selectSeat", () => {
    it("着席していればその色を返す", () => {
        const state = reduceAll([connected, received({ type: "state", state: seatedRoom })]);

        expect(selectSeat(state)).toBe("black");
    });

    it("観戦者なら null を返す", () => {
        const state = reduceAll([
            received({ type: "connected", userId: carol.userId, instanceId: "instance-1" }),
            received({ type: "state", state: seatedRoom }),
        ]);

        expect(selectSeat(state)).toBeNull();
    });
});

describe("selectIsPlayer", () => {
    it("表示中の対局の対局者なら true を返す", () => {
        const state = reduceAll([
            connected,
            received({ type: "state", state: { ...seatedRoom, game: makeGame() } }),
        ]);

        expect(selectIsPlayer(state)).toBe(true);
    });

    it("観戦者なら false を返す", () => {
        const state = reduceAll([
            received({ type: "connected", userId: carol.userId, instanceId: "instance-1" }),
            received({ type: "state", state: { ...seatedRoom, game: makeGame() } }),
        ]);

        expect(selectIsPlayer(state)).toBe(false);
    });
});
