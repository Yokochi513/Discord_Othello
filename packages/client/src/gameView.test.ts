import { createInitialBoard } from "@othello/core";
import type { GameState, Participant, RoomState, Square } from "@othello/protocol";
import { describe, expect, it } from "vitest";

import { buildGameView } from "./gameView.ts";
import { initialClientState, type ClientState } from "./roomState.ts";

const alice: Participant = { userId: "u-alice", displayName: "アリス" };
const bob: Participant = { userId: "u-bob", displayName: "ボブ" };
const carol: Participant = { userId: "u-carol", displayName: "キャロル" };

function makeGame(overrides: Partial<GameState> = {}): GameState {
    return {
        id: "game-1",
        board: createInitialBoard(),
        turn: "black",
        scores: { black: 2, white: 2 },
        moveCount: 0,
        lastMove: null,
        players: { black: alice, white: bob },
        result: null,
        ...overrides,
    };
}

function makeRoom(game: GameState, overrides: Partial<RoomState> = {}): RoomState {
    return {
        instanceId: "instance-1",
        seats: { black: alice, white: bob },
        spectators: [],
        game,
        ...overrides,
    };
}

// 黒番の alice として、両席が埋まった対局中の状態を作る
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

// 印が付いているマスの座標だけを取り出す
function legalSquares(state: ClientState): readonly Square[] {
    return (buildGameView(state)?.cells ?? []).filter((cell) => cell.legal).map((c) => c.square);
}

describe("buildGameView", () => {
    it("ルーム状態が届くまでは表示内容を作れない", () => {
        expect(buildGameView(makeState(null))).toBeNull();
    });

    it("対局が始まっていなければ表示内容を作れない", () => {
        expect(buildGameView(makeState(makeRoom(makeGame(), { game: null })))).toBeNull();
    });

    it("盤面を a1 から h8 まで行昇順・列昇順に並べる", () => {
        const view = buildGameView(makeState(makeRoom(makeGame())));

        expect(view?.cells).toHaveLength(64);
        expect(view?.cells[0]?.square).toBe("a1");
        expect(view?.cells[63]?.square).toBe("h8");
        // 初期配置は d4=白, e4=黒, d5=黒, e5=白（core の createInitialBoard と同じ）
        const stoneOf = (square: string): string =>
            view?.cells.find((cell) => cell.square === square)?.stone ?? "";
        expect([stoneOf("d4"), stoneOf("e4"), stoneOf("d5"), stoneOf("e5")]).toEqual([
            "white",
            "black",
            "black",
            "white",
        ]);
        expect(stoneOf("a1")).toBe("empty");
    });

    it("手番側には打てるマスの印を出す（F-06）", () => {
        expect(legalSquares(makeState(makeRoom(makeGame())))).toEqual(["d3", "c4", "f5", "e6"]);
    });

    it("手番でない側には打てるマスの印を出さない（要件定義 §7.3）", () => {
        const state = makeState(makeRoom(makeGame({ turn: "white" })));

        expect(legalSquares(state)).toEqual([]);
        expect(buildGameView(state)?.canPlay).toBe(false);
    });

    it("観戦者には打てるマスの印を出さず、マスも押せない（F-13）", () => {
        // 対局しているのは bob と carol で、alice は観戦者
        const game = makeGame({ players: { black: bob, white: carol } });
        const room = makeRoom(game, { seats: { black: bob, white: carol }, spectators: [alice] });
        const view = buildGameView(makeState(room));

        expect(view?.isPlayer).toBe(false);
        expect(view?.canPlay).toBe(false);
        expect(view?.cells.some((cell) => cell.legal)).toBe(false);
        expect(view?.cells.some((cell) => cell.playable)).toBe(false);
    });

    it("手番側の合法手だけがクリックで着手できる", () => {
        const view = buildGameView(makeState(makeRoom(makeGame())));
        const playable = view?.cells.filter((cell) => cell.playable).map((cell) => cell.square);

        expect(view?.canPlay).toBe(true);
        expect(playable).toEqual(["d3", "c4", "f5", "e6"]);
    });

    it("接続が切れている間は着手も投了・中断もできない（§14 E-15）", () => {
        const view = buildGameView(makeState(makeRoom(makeGame()), { connection: "reconnecting" }));

        expect(view?.canPlay).toBe(false);
        expect(view?.canControl).toBe(false);
        expect(view?.cells.some((cell) => cell.playable)).toBe(false);
        // 印そのものは残し、盤面の見え方は変えない
        expect(view?.cells.some((cell) => cell.legal)).toBe(true);
    });

    it("直前に打たれた手を示す（要件定義 §7.3）", () => {
        const view = buildGameView(makeState(makeRoom(makeGame({ lastMove: "d3" }))));

        expect(view?.lastMove).toBe("d3");
        expect(view?.cells.filter((cell) => cell.last).map((cell) => cell.square)).toEqual(["d3"]);
    });

    it("両対局者の表示名・石数・手番・接続状態を常に出す（要件定義 §7.3）", () => {
        const game = makeGame({ scores: { black: 4, white: 1 }, moveCount: 3 });
        const view = buildGameView(makeState(makeRoom(game)));
        const [black, white] = view?.players ?? [];

        expect(black?.displayName).toBe("アリス");
        expect(black?.mine).toBe(true);
        expect(black?.score).toBe(4);
        expect(black?.inTurn).toBe(true);
        expect(black?.connectionLabel).toBe("接続中");
        expect(white?.displayName).toBe("ボブ");
        expect(white?.mine).toBe(false);
        expect(white?.score).toBe(1);
        expect(white?.inTurn).toBe(false);
        expect(view?.moveCount).toBe(3);
    });

    it("ルームから居なくなった対局者は切断として示す（§11.3）", () => {
        const room = makeRoom(makeGame(), { seats: { black: alice, white: null } });
        const [, white] = buildGameView(makeState(room))?.players ?? [];

        expect(white?.connected).toBe(false);
        expect(white?.connectionLabel).toBe("切断");
    });

    it("観戦者として在室している対局者は接続中として示す", () => {
        const room = makeRoom(makeGame(), {
            seats: { black: alice, white: null },
            spectators: [bob],
        });
        const [, white] = buildGameView(makeState(room))?.players ?? [];

        expect(white?.connected).toBe(true);
    });

    it("手番は対局者と観戦者で言い回しを変える", () => {
        const room = makeRoom(makeGame());

        expect(buildGameView(makeState(room))?.turnNotice).toBe("あなたの番です");
        expect(buildGameView(makeState(room, { userId: bob.userId }))?.turnNotice).toBe(
            "相手の番です",
        );
        expect(buildGameView(makeState(room, { userId: carol.userId }))?.turnNotice).toBe(
            "黒の番です",
        );
    });

    it("投了・中断は対局者だけが押せる（F-11・F-12）", () => {
        const room = makeRoom(makeGame());

        expect(buildGameView(makeState(room))?.canControl).toBe(true);
        expect(buildGameView(makeState(room, { userId: carol.userId }))?.canControl).toBe(false);
    });

    it("パスが起きた旨を表示する（F-09）", () => {
        const room = makeRoom(makeGame());

        expect(buildGameView(makeState(room))?.passNotice).toBeNull();
        expect(buildGameView(makeState(room, { passedBy: ["white"] }))?.passNotice).toBe(
            "白は打てるマスが無いためパスしました",
        );
        expect(buildGameView(makeState(room, { passedBy: ["white", "black"] }))?.passNotice).toBe(
            "白・黒は打てるマスが無いためパスしました",
        );
    });
});
