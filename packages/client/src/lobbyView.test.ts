import type { GameState, Participant, RoomState } from "@othello/protocol";
import { describe, expect, it } from "vitest";

import { buildLobbyView } from "./lobbyView.ts";
import { initialClientState, type ClientState } from "./roomState.ts";

const alice: Participant = { userId: "u-alice", displayName: "アリス" };
const bob: Participant = { userId: "u-bob", displayName: "ボブ" };
const carol: Participant = { userId: "u-carol", displayName: "キャロル" };

const emptyBoard: readonly (readonly ("black" | "white" | "empty")[])[] = Array.from(
    { length: 8 },
    () => Array.from({ length: 8 }, () => "empty" as const),
);

function makeRoom(overrides: Partial<RoomState> = {}): RoomState {
    return {
        instanceId: "instance-1",
        seats: { black: null, white: null },
        spectators: [],
        game: null,
        ...overrides,
    };
}

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

// 接続済みで自分が alice として認識されている状態を作る
function makeState(room: RoomState | null, overrides: Partial<ClientState> = {}): ClientState {
    return {
        ...initialClientState,
        connection: "open",
        userId: alice.userId,
        instanceId: "instance-1",
        room,
        ...overrides,
    };
}

describe("buildLobbyView", () => {
    it("ルーム状態が届くまでは表示内容を作れない", () => {
        expect(buildLobbyView(makeState(null))).toBeNull();
    });

    it("空席は着席でき、退席はできない", () => {
        const view = buildLobbyView(makeState(makeRoom()));

        expect(view?.seats.map((seat) => seat.seat)).toEqual(["black", "white"]);
        expect(view?.seats.map((seat) => seat.label)).toEqual(["黒番", "白番"]);
        expect(view?.seats.every((seat) => seat.occupant === null)).toBe(true);
        expect(view?.seats.every((seat) => seat.canSit)).toBe(true);
        expect(view?.seats.every((seat) => seat.canLeave)).toBe(false);
    });

    it("埋まっている席には着席できない（F-03）", () => {
        const view = buildLobbyView(makeState(makeRoom({ seats: { black: bob, white: null } })));

        const [black, white] = view?.seats ?? [];
        expect(black?.occupant).toEqual(bob);
        expect(black?.canSit).toBe(false);
        expect(black?.mine).toBe(false);
        expect(white?.canSit).toBe(true);
    });

    it("自分が着いている席だけ退席できる", () => {
        const view = buildLobbyView(makeState(makeRoom({ seats: { black: alice, white: bob } })));

        const [black, white] = view?.seats ?? [];
        expect(black?.mine).toBe(true);
        expect(black?.canLeave).toBe(true);
        expect(white?.canLeave).toBe(false);
        expect(view?.mySeat).toBe("black");
    });

    it("着席していても空いている反対の席へは移れる", () => {
        const view = buildLobbyView(makeState(makeRoom({ seats: { black: alice, white: null } })));

        const [black, white] = view?.seats ?? [];
        expect(black?.canSit).toBe(false);
        expect(white?.canSit).toBe(true);
    });

    it("観戦者を並べ、自分自身には印を付ける（F-13）", () => {
        const view = buildLobbyView(
            makeState(makeRoom({ seats: { black: bob, white: null }, spectators: [alice, carol] })),
        );

        expect(view?.spectators).toEqual([
            { participant: alice, mine: true },
            { participant: carol, mine: false },
        ]);
        expect(view?.mySeat).toBeNull();
    });

    it("片方でも空いている間は対局を開始できない（F-05）", () => {
        const view = buildLobbyView(makeState(makeRoom({ seats: { black: alice, white: null } })));

        expect(view?.canStart).toBe(false);
        expect(view?.startHint).toBe("両席が埋まると押せます");
    });

    it("両席が埋まれば対局者は対局を開始できる（F-05）", () => {
        const view = buildLobbyView(makeState(makeRoom({ seats: { black: alice, white: bob } })));

        expect(view?.canStart).toBe(true);
        expect(view?.startHint).toBeNull();
    });

    it("観戦者は両席が埋まっていても開始できない", () => {
        const view = buildLobbyView(
            makeState(makeRoom({ seats: { black: bob, white: carol }, spectators: [alice] })),
        );

        expect(view?.canStart).toBe(false);
        expect(view?.startHint).toBe("対局を始められるのは対局者だけです");
    });

    it("接続が切れている間は操作を受け付けない", () => {
        const view = buildLobbyView(
            makeState(makeRoom({ seats: { black: alice, white: bob } }), {
                connection: "reconnecting",
            }),
        );

        expect(view?.canStart).toBe(false);
        expect(view?.seats.every((seat) => !seat.canSit && !seat.canLeave)).toBe(true);
    });

    it("終局した対局が残っていてもロビーの操作は続けられる", () => {
        const finished = makeGame({
            turn: null,
            result: { reason: "resign", outcome: "white_win" },
        });
        const view = buildLobbyView(
            makeState(makeRoom({ seats: { black: alice, white: bob }, game: finished })),
        );

        expect(view?.canStart).toBe(true);
    });
});
