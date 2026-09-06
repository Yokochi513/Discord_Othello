import type { Participant } from "@othello/protocol";
import { describe, expect, it } from "vitest";

import {
    createLobby,
    isEmptyLobby,
    joinLobby,
    leaveLobby,
    leaveSeat,
    LobbyStore,
    takeSeat,
    toRoomState,
    type LobbyState,
} from "./lobby.ts";

const yokochi: Participant = { userId: "user-1", displayName: "よこち" };
const harima: Participant = { userId: "user-2", displayName: "はりま" };
const ojosama: Participant = { userId: "user-3", displayName: "お嬢様" };

// 着席済みのロビーを組み立てる（黒=よこち、白=はりま、観戦=お嬢様）
function seatedLobby(): LobbyState {
    let state = createLobby("room-a");
    for (const participant of [yokochi, harima, ojosama]) {
        state = joinLobby(state, participant);
    }
    const black = takeSeat(state, yokochi, "black");
    if (!black.ok) throw new Error("黒席への着席に失敗しました");
    const white = takeSeat(black.state, harima, "white");
    if (!white.ok) throw new Error("白席への着席に失敗しました");
    return white.state;
}

describe("createLobby", () => {
    it("両席が空席で観戦者のいないロビーを作る", () => {
        expect(createLobby("room-a")).toEqual({
            instanceId: "room-a",
            seats: { black: null, white: null },
            spectators: [],
        });
        expect(isEmptyLobby(createLobby("room-a"))).toBe(true);
    });
});

describe("joinLobby", () => {
    it("着席していない参加者を観戦者として扱う", () => {
        const state = joinLobby(joinLobby(createLobby("room-a"), yokochi), harima);

        expect(state.spectators).toEqual([yokochi, harima]);
        expect(state.seats).toEqual({ black: null, white: null });
    });

    it("同じ参加者が再参加しても重複させない", () => {
        const state = joinLobby(createLobby("room-a"), yokochi);

        expect(joinLobby(state, yokochi)).toBe(state);
    });

    it("表示名の変更を反映する", () => {
        const renamed = { userId: yokochi.userId, displayName: "よこち（改名）" };

        expect(joinLobby(joinLobby(createLobby("room-a"), yokochi), renamed).spectators).toEqual([
            renamed,
        ]);
        expect(joinLobby(seatedLobby(), renamed).seats.black).toEqual(renamed);
    });
});

describe("takeSeat", () => {
    it("着席すると観戦者一覧から外れる", () => {
        const result = takeSeat(joinLobby(createLobby("room-a"), yokochi), yokochi, "black");

        expect(result).toMatchObject({ ok: true, changed: true });
        if (!result.ok) return;
        expect(result.state.seats).toEqual({ black: yokochi, white: null });
        expect(result.state.spectators).toEqual([]);
    });

    it("埋まった席への着席を拒否する", () => {
        const result = takeSeat(seatedLobby(), ojosama, "black");

        expect(result).toEqual({
            ok: false,
            code: "seat_unavailable",
            message: "その席は既に埋まっています",
        });
    });

    it("既に自分が着いている席への着席は状態を変えない", () => {
        const state = seatedLobby();
        const result = takeSeat(state, yokochi, "black");

        expect(result).toEqual({ ok: true, state, changed: false });
    });

    it("同一ユーザーが両席に着かないよう、移動元の席を空ける", () => {
        const vacant = leaveSeat(seatedLobby(), harima.userId);
        const result = takeSeat(vacant, yokochi, "white");

        expect(result).toMatchObject({ ok: true, changed: true });
        if (!result.ok) return;
        expect(result.state.seats).toEqual({ black: null, white: yokochi });
        expect(result.state.spectators).toEqual([ojosama, harima]);
    });
});

describe("leaveSeat", () => {
    it("退席した参加者を観戦者に戻す", () => {
        const state = leaveSeat(seatedLobby(), yokochi.userId);

        expect(state.seats).toEqual({ black: null, white: harima });
        expect(state.spectators).toEqual([ojosama, yokochi]);
    });

    it("着席していない参加者の退席では状態を変えない", () => {
        const state = seatedLobby();

        expect(leaveSeat(state, ojosama.userId)).toBe(state);
        expect(leaveSeat(state, "unknown-user")).toBe(state);
    });
});

describe("leaveLobby", () => {
    it("座席と観戦者一覧の双方から取り除く", () => {
        const state = leaveLobby(leaveLobby(seatedLobby(), yokochi.userId), ojosama.userId);

        expect(state.seats).toEqual({ black: null, white: harima });
        expect(state.spectators).toEqual([]);
    });

    it("参加していないユーザーでは状態を変えない", () => {
        const state = seatedLobby();

        expect(leaveLobby(state, "unknown-user")).toBe(state);
    });

    it("全員が離脱すると空のロビーになる", () => {
        let state = seatedLobby();
        for (const participant of [yokochi, harima, ojosama]) {
            state = leaveLobby(state, participant.userId);
        }

        expect(isEmptyLobby(state)).toBe(true);
    });
});

describe("toRoomState", () => {
    it("配信用のルーム状態へ変換する", () => {
        expect(toRoomState(seatedLobby())).toEqual({
            instanceId: "room-a",
            seats: { black: yokochi, white: harima },
            spectators: [ojosama],
            game: null,
        });
    });
});

describe("LobbyStore", () => {
    it("インスタンスごとに状態を分けて保持する", () => {
        const store = new LobbyStore();

        store.join("room-a", yokochi);
        store.join("room-b", harima);

        expect(store.get("room-a").spectators).toEqual([yokochi]);
        expect(store.get("room-b").spectators).toEqual([harima]);
    });

    it("変化のない操作では changed を false にする", () => {
        const store = new LobbyStore();

        expect(store.join("room-a", yokochi).changed).toBe(true);
        expect(store.join("room-a", yokochi).changed).toBe(false);
        expect(store.leaveSeat("room-a", yokochi.userId).changed).toBe(false);
        expect(store.takeSeat("room-a", yokochi, "black")).toMatchObject({ changed: true });
        expect(store.takeSeat("room-a", yokochi, "black")).toMatchObject({ changed: false });
    });

    it("着席と退席の結果を保持する", () => {
        const store = new LobbyStore();
        store.join("room-a", yokochi);
        store.join("room-a", harima);

        store.takeSeat("room-a", yokochi, "black");
        store.takeSeat("room-a", harima, "white");
        expect(store.get("room-a").seats).toEqual({ black: yokochi, white: harima });

        store.leaveSeat("room-a", yokochi.userId);
        expect(store.get("room-a").seats).toEqual({ black: null, white: harima });
        expect(store.get("room-a").spectators).toEqual([yokochi]);
    });

    it("埋まった席への着席を拒否し、状態を変えない", () => {
        const store = new LobbyStore();
        store.join("room-a", yokochi);
        store.join("room-a", harima);
        store.takeSeat("room-a", yokochi, "black");

        expect(store.takeSeat("room-a", harima, "black")).toEqual({
            ok: false,
            code: "seat_unavailable",
            message: "その席は既に埋まっています",
        });
        expect(store.get("room-a").seats.black).toEqual(yokochi);
        expect(store.get("room-a").spectators).toEqual([harima]);
    });

    it("誰もいなくなったロビーを破棄する", () => {
        const store = new LobbyStore();
        store.join("room-a", yokochi);
        store.takeSeat("room-a", yokochi, "black");

        expect(store.leave("room-a", yokochi.userId).changed).toBe(true);
        expect(store.get("room-a")).toEqual(createLobby("room-a"));
        expect(store.leave("room-a", yokochi.userId).changed).toBe(false);
    });
});
