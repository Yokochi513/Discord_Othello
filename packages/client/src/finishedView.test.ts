import { createInitialBoard } from "@othello/core";
import type { GameResult, GameState, Participant, RoomState } from "@othello/protocol";
import { describe, expect, it } from "vitest";

import { buildFinishedView, type FinishedView } from "./finishedView.ts";
import { initialClientState, type ClientState } from "./roomState.ts";

const alice: Participant = { userId: "u-alice", displayName: "アリス" };
const bob: Participant = { userId: "u-bob", displayName: "ボブ" };
const carol: Participant = { userId: "u-carol", displayName: "キャロル" };

// 黒=アリス、白=ボブで終局した対局
function makeGame(overrides: Partial<GameState> = {}): GameState {
    return {
        id: "game-1",
        board: createInitialBoard(),
        turn: null,
        scores: { black: 40, white: 24 },
        moveCount: 60,
        lastMove: "h8",
        players: { black: alice, white: bob },
        result: { reason: "board_full", outcome: "black_win" },
        ...overrides,
    };
}

function makeRoom(overrides: Partial<RoomState> = {}): RoomState {
    return {
        instanceId: "instance-1",
        seats: { black: alice, white: bob },
        spectators: [carol],
        game: makeGame(),
        ...overrides,
    };
}

// 黒番のアリスとして、終局した対局を表示している状態を作る
function makeState(
    result: GameResult = { reason: "board_full", outcome: "black_win" },
    overrides: Partial<ClientState> = {},
): ClientState {
    return {
        ...initialClientState,
        connection: "open",
        userId: alice.userId,
        instanceId: "instance-1",
        room: makeRoom(),
        finished: { game: makeGame({ result }), result },
        ...overrides,
    };
}

// 表示内容を組み立てる。null は想定しない呼び出し側のためにここで弾く
function build(state: ClientState): FinishedView {
    const view = buildFinishedView(state);
    if (view === null) throw new Error("終局画面の表示内容を組み立てられませんでした");
    return view;
}

describe("buildFinishedView", () => {
    it("終局した対局が無ければ表示内容を作れない", () => {
        expect(buildFinishedView({ ...initialClientState, finished: null })).toBeNull();
    });

    it("勝った対局者には自分から見た勝ちを伝える", () => {
        expect(build(makeState()).outcomeLabel).toBe("あなたの勝ち");
    });

    it("負けた対局者には自分から見た負けを伝える", () => {
        const state = makeState(
            { reason: "board_full", outcome: "black_win" },
            {
                userId: bob.userId,
            },
        );

        expect(build(state).outcomeLabel).toBe("あなたの負け");
    });

    it("観戦者には勝った色を伝える", () => {
        const state = makeState(
            { reason: "board_full", outcome: "white_win" },
            {
                userId: carol.userId,
            },
        );
        expect(build(state).outcomeLabel).toBe("白の勝ち");
    });

    it("引き分けは勝ち負けを付けない", () => {
        const view = build(makeState({ reason: "board_full", outcome: "draw" }));

        expect(view.outcomeLabel).toBe("引き分け");
        expect(view.players.map((player) => player.winner)).toEqual([false, false]);
    });

    it("最終石数と最終盤面と手数を載せる", () => {
        const view = build(makeState());

        expect(
            view.players.map((player) => [player.label, player.displayName, player.score]),
        ).toEqual([
            ["黒", "アリス", 40],
            ["白", "ボブ", 24],
        ]);
        expect(view.moveCount).toBe(60);
        expect(view.cells).toHaveLength(64);
        // 終局後の盤面には打てるマスの印も着手の操作も出さない
        expect(view.cells.some((cell) => cell.legal || cell.playable)).toBe(false);
        expect(view.cells.find((cell) => cell.square === "h8")?.last).toBe(true);
    });

    it("勝った側だけに勝者の印を付ける", () => {
        const view = build(makeState({ reason: "resign", outcome: "white_win" }));

        expect(view.players.map((player) => player.winner)).toEqual([false, true]);
    });

    it("投了は投了した側を添えて伝える", () => {
        expect(build(makeState({ reason: "resign", outcome: "white_win" })).reasonLabel).toBe(
            "黒の投了で決着しました",
        );
    });

    it("中断・離脱は無効試合として出し分ける", () => {
        const aborted = build(makeState({ reason: "abort", outcome: null }));
        const disconnected = build(makeState({ reason: "disconnect", outcome: null }));

        expect(aborted.outcomeLabel).toBe("無効試合");
        expect(aborted.invalid).toBe(true);
        expect(aborted.reasonLabel).toBe("対局が中断されました。無効試合のため戦績には残りません");
        expect(disconnected.reasonLabel).toBe(
            "対局者が離脱しました。無効試合のため戦績には残りません",
        );
    });

    it("自然終局は理由ごとに文言を変える", () => {
        const labels = (["both_passed", "board_full", "shutout"] as const).map(
            (reason) => build(makeState({ reason, outcome: "black_win" })).reasonLabel,
        );

        expect(labels).toEqual([
            "両者が続けてパスしたため終局しました",
            "盤面が埋まったため終局しました",
            "一方の石が無くなったため終局しました",
        ]);
    });

    it("座席に着いている側だけに「もう一局」を出す（要件定義 §7.4）", () => {
        const player = build(makeState());
        const spectator = build(makeState(undefined, { userId: carol.userId }));

        expect(player.showRematch).toBe(true);
        expect(player.canRematch).toBe(true);
        expect(spectator.showRematch).toBe(false);
        expect(spectator.canRematch).toBe(false);
    });

    it("相手が退席している間は「もう一局」を押せない", () => {
        const state = makeState(undefined, {
            room: makeRoom({ seats: { black: alice, white: null }, spectators: [carol, bob] }),
        });
        const view = build(state);

        expect(view.showRematch).toBe(true);
        expect(view.canRematch).toBe(false);
        expect(view.rematchHint).toBe("相手が席に着くと押せます");
    });

    it("押せるときは黒白が入れ替わることを添える（O-10）", () => {
        expect(build(makeState()).rematchHint).toBe("もう一局では黒白が入れ替わります");
    });

    it("接続が切れている間は「もう一局」を受け付けない", () => {
        expect(build(makeState(undefined, { connection: "reconnecting" })).canRematch).toBe(false);
    });

    it("終局後に退席した対局者は「もう一局」を始められない", () => {
        const state = makeState(undefined, {
            room: makeRoom({ seats: { black: null, white: bob }, spectators: [carol, alice] }),
        });
        const view = build(state);

        // 勝ち負けは終局した対局の座席で決まり、再戦の可否は今の座席で決まる
        expect(view.outcomeLabel).toBe("あなたの勝ち");
        expect(view.showRematch).toBe(false);
    });
});
