/**
 * ロビー画面に出す内容の組み立て（要件定義 §7.2 / F-02・F-03・F-05・F-13）。
 *
 * 座席の並び、押せるボタン、対局を開始できるかは、サーバーから届いたルーム状態だけで決まる。
 * DOM にも React にも依存しない純粋な関数として実装し、画面（Lobby.tsx）は結果を描くだけにする。
 */

import type { Participant } from "@othello/protocol";

import { selectSeat, type ClientState, type SeatId } from "./roomState.ts";

/** 参加者 1 人分の表示内容。 */
export type ParticipantView = {
    /** 参加者の公開情報 */
    readonly participant: Participant;
    /** 自分自身か */
    readonly mine: boolean;
};

/** 座席 1 つ分の表示内容。 */
export type SeatView = {
    /** 座席の色 */
    readonly seat: SeatId;
    /** 座席の表示名（黒番 / 白番） */
    readonly label: string;
    /** 座席を表す石の記号 */
    readonly mark: string;
    /** 着席している参加者。空席なら null */
    readonly occupant: Participant | null;
    /** 自分が着いている座席か */
    readonly mine: boolean;
    /** この席に着けるか（F-03: 埋まっている席には着けない） */
    readonly canSit: boolean;
    /** この席から退席できるか */
    readonly canLeave: boolean;
};

/** ロビー画面全体の表示内容。 */
export type LobbyView = {
    /** 黒席・白席の順に並べた座席 */
    readonly seats: readonly [SeatView, SeatView];
    /** 座席に着いていない参加者（F-13） */
    readonly spectators: readonly ParticipantView[];
    /** 自分が着いている座席。観戦者なら null */
    readonly mySeat: SeatId | null;
    /** 対局を開始できるか（F-05: 両席が埋まっている対局者だけ） */
    readonly canStart: boolean;
    /** 対局を開始できない理由。開始できるときは null */
    readonly startHint: string | null;
};

// 座席の色の表示名と記号（要件定義 §7.2 の画面案に合わせる）
const SEAT_LABELS: Readonly<Record<SeatId, string>> = { black: "黒番", white: "白番" };
const SEAT_MARKS: Readonly<Record<SeatId, string>> = { black: "⚫", white: "⚪" };

/**
 * ルーム状態からロビー画面の表示内容を組み立てる。
 * @param state 現在のクライアント状態
 * @returns ロビー画面の表示内容。ルーム状態がまだ届いていなければ null
 */
export function buildLobbyView(state: ClientState): LobbyView | null {
    const room = state.room;
    if (room === null) return null;

    const mySeat = selectSeat(state);
    // 接続が切れている間は送信できないため、操作そのものを受け付けない（要件定義 §14 E-15）
    const connected = state.connection === "open";
    const seats = [
        buildSeatView("black", room.seats.black, mySeat, connected),
        buildSeatView("white", room.seats.white, mySeat, connected),
    ] as const;

    const bothSeated = room.seats.black !== null && room.seats.white !== null;

    return {
        seats,
        spectators: room.spectators.map((participant) => ({
            participant,
            mine: participant.userId === state.userId,
        })),
        mySeat,
        canStart: bothSeated && mySeat !== null && connected,
        startHint: startHint(bothSeated, mySeat),
    };
}

function buildSeatView(
    seat: SeatId,
    occupant: Participant | null,
    mySeat: SeatId | null,
    connected: boolean,
): SeatView {
    const mine = mySeat === seat;
    return {
        seat,
        label: SEAT_LABELS[seat],
        mark: SEAT_MARKS[seat],
        occupant,
        mine,
        // 空席なら着ける。既に反対の席に着いていても、席の移動はサーバーが受け付ける
        canSit: connected && occupant === null,
        canLeave: connected && mine,
    };
}

// 対局を開始できない理由を、押せないボタンの下に添える文言として返す
function startHint(bothSeated: boolean, mySeat: SeatId | null): string | null {
    if (!bothSeated) return "両席が埋まると押せます";
    if (mySeat === null) return "対局を始められるのは対局者だけです";
    return null;
}
