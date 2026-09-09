/**
 * Activity インスタンス単位のロビー状態（要件定義 §7.2 / F-02・F-03・F-13）。
 *
 * 状態遷移は副作用のない関数として実装し、配信は WebSocket 側に任せる。
 * 変化がない操作では引数の状態をそのまま返すため、呼び出し側は参照の同一性
 * （next === previous）で再配信の要否を判定できる。
 *
 * 保持するのは Discord User ID と表示名のみで、アバターはクライアントが
 * Discord SDK から解決する（要件定義 §11.5）。
 */

import type { ErrorCode, Participant, RoomState, Seat } from "@othello/protocol";

/** 着席できる座席の識別子。 */
export type SeatId = "black" | "white";

/** 1 つの Activity インスタンスのロビー状態。 */
export type LobbyState = {
    readonly instanceId: string;
    readonly seats: { readonly black: Seat; readonly white: Seat };
    /** 座席に着いていない参加者。着席すると自動的にこの一覧から外れる。 */
    readonly spectators: readonly Participant[];
};

/** ロビーの更新結果。changed が false のときは再配信しなくてよい。 */
export type LobbyChange = { readonly state: LobbyState; readonly changed: boolean };

/** ロビー操作の結果。拒否した場合はクライアントへ返すエラーを持つ。 */
export type LobbyResult =
    | ({ readonly ok: true } & LobbyChange)
    | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

/**
 * 空のロビーを作る。
 * @param instanceId Activity インスタンスID
 * @returns 両席が空席で観戦者のいないロビー
 */
export function createLobby(instanceId: string): LobbyState {
    return { instanceId, seats: { black: null, white: null }, spectators: [] };
}

/**
 * 参加者をロビーに加える。着席していない参加者は観戦者として扱う（F-13）。
 * 既に参加している場合は表示名だけを最新のものへ更新する。
 * @param state 現在のロビー状態
 * @param participant 参加者の User ID と表示名
 * @returns 参加者を含むロビー状態
 */
export function joinLobby(state: LobbyState, participant: Participant): LobbyState {
    const seatId = findSeat(state, participant.userId);
    if (seatId !== null) {
        return isSameParticipant(state.seats[seatId], participant)
            ? state
            : withSeat(state, seatId, participant);
    }

    const spectator = state.spectators.find((s) => s.userId === participant.userId);
    if (spectator === undefined) {
        return { ...state, spectators: [...state.spectators, participant] };
    }
    if (isSameParticipant(spectator, participant)) return state;
    return {
        ...state,
        spectators: state.spectators.map((s) =>
            s.userId === participant.userId ? participant : s,
        ),
    };
}

/**
 * 参加者を座席に着かせる（F-03）。
 * 既に他の参加者が着いている席は拒否し、同一ユーザーが両席に着かないよう
 * 反対側の席は空ける。
 * @param state 現在のロビー状態
 * @param participant 着席する参加者
 * @param seatId 着席先の座席
 * @returns 着席後のロビー状態、または拒否理由
 */
export function takeSeat(state: LobbyState, participant: Participant, seatId: SeatId): LobbyResult {
    const occupant = state.seats[seatId];
    if (occupant !== null && occupant.userId !== participant.userId) {
        return { ok: false, code: "seat_unavailable", message: "その席は既に埋まっています" };
    }
    if (isSameParticipant(occupant, participant)) return { ok: true, state, changed: false };

    const seated = withSeat(removeParticipant(state, participant.userId), seatId, participant);
    return { ok: true, state: seated, changed: true };
}

/**
 * 参加者を退席させ、観戦者に戻す（F-03）。着席していなければ何もしない。
 * @param state 現在のロビー状態
 * @param userId 退席する参加者の Discord User ID
 * @returns 退席後のロビー状態
 */
export function leaveSeat(state: LobbyState, userId: string): LobbyState {
    const seatId = findSeat(state, userId);
    if (seatId === null) return state;
    const seated = state.seats[seatId];
    if (seated === null) return state;
    const vacated = withSeat(state, seatId, null);
    return { ...vacated, spectators: [...vacated.spectators, seated] };
}

/**
 * 黒席と白席の着席者を入れ替える（要件定義 F-19 / §20 O-10）。
 * 再戦のたびに先手を交代させるために使う。両席が空なら何も変わらない。
 * @param state 現在のロビー状態
 * @returns 黒白を入れ替えたロビー状態。入れ替える相手がいなければ引数の状態
 */
export function swapSeats(state: LobbyState): LobbyState {
    const { black, white } = state.seats;
    if (black === null && white === null) return state;
    return { ...state, seats: { black: white, white: black } };
}

/**
 * 参加者をロビーから取り除く（切断時）。座席・観戦者一覧の双方から外す。
 * @param state 現在のロビー状態
 * @param userId 離脱する参加者の Discord User ID
 * @returns 離脱後のロビー状態
 */
export function leaveLobby(state: LobbyState, userId: string): LobbyState {
    return removeParticipant(state, userId);
}

/**
 * ロビーに誰も残っていないかを検査する。
 * @param state ロビー状態
 * @returns 座席も観戦者も空なら true
 */
export function isEmptyLobby(state: LobbyState): boolean {
    return (
        state.seats.black === null && state.seats.white === null && state.spectators.length === 0
    );
}

/**
 * ロビー状態を、クライアントへ配信するルーム状態へ変換する。
 * @param state ロビー状態
 * @param game 進行中の対局。ロビーだけの段階では null
 * @returns 配信用のルーム状態
 */
export function toRoomState(state: LobbyState, game: RoomState["game"] = null): RoomState {
    return {
        instanceId: state.instanceId,
        seats: state.seats,
        spectators: state.spectators,
        game,
    };
}

/**
 * Activity インスタンスごとのロビー状態を保持する。
 * 返り値の changed が true のときだけ、呼び出し側はルーム全員へ配信すればよい（F-02）。
 */
export class LobbyStore {
    readonly #lobbies = new Map<string, LobbyState>();

    /** 指定インスタンスの現在のロビー状態を返す。
     * @param instanceId Activity インスタンスID
     * @returns ロビー状態（未作成なら空のロビー）
     */
    get(instanceId: string): LobbyState {
        return this.#lobbies.get(instanceId) ?? createLobby(instanceId);
    }

    /** 参加者をロビーへ加える。
     * @param instanceId Activity インスタンスID
     * @param participant 参加者
     * @returns 更新後の状態と変化の有無
     */
    join(instanceId: string, participant: Participant): LobbyChange {
        return this.#store(instanceId, joinLobby(this.get(instanceId), participant));
    }

    /** 参加者を座席に着かせる。
     * @param instanceId Activity インスタンスID
     * @param participant 着席する参加者
     * @param seatId 着席先の座席
     * @returns 更新後の状態、または拒否理由
     */
    takeSeat(instanceId: string, participant: Participant, seatId: SeatId): LobbyResult {
        const result = takeSeat(this.get(instanceId), participant, seatId);
        if (!result.ok) return result;
        return { ok: true, ...this.#store(instanceId, result.state) };
    }

    /** 参加者を退席させ、観戦者に戻す。
     * @param instanceId Activity インスタンスID
     * @param userId 退席する参加者の Discord User ID
     * @returns 更新後の状態と変化の有無
     */
    leaveSeat(instanceId: string, userId: string): LobbyChange {
        return this.#store(instanceId, leaveSeat(this.get(instanceId), userId));
    }

    /** 黒席と白席の着席者を入れ替える（再戦時。要件定義 F-19 / §20 O-10）。
     * @param instanceId Activity インスタンスID
     * @returns 更新後の状態と変化の有無
     */
    swapSeats(instanceId: string): LobbyChange {
        return this.#store(instanceId, swapSeats(this.get(instanceId)));
    }

    /** 参加者をロビーから取り除く。誰もいなくなったロビーは破棄する。
     * @param instanceId Activity インスタンスID
     * @param userId 離脱する参加者の Discord User ID
     * @returns 更新後の状態と変化の有無
     */
    leave(instanceId: string, userId: string): LobbyChange {
        const change = this.#store(instanceId, leaveLobby(this.get(instanceId), userId));
        if (isEmptyLobby(change.state)) this.#lobbies.delete(instanceId);
        return change;
    }

    // 変化があった場合だけ保持中の状態を差し替える。
    // 未作成のロビーは「空のロビー」と同じ意味なので、空のままなら変化なしとして扱う。
    #store(instanceId: string, next: LobbyState): LobbyChange {
        const previous = this.#lobbies.get(instanceId);
        if (previous === next || (previous === undefined && isEmptyLobby(next))) {
            return { state: next, changed: false };
        }
        this.#lobbies.set(instanceId, next);
        return { state: next, changed: true };
    }
}

// 指定ユーザーが着いている座席を返す。着席していなければ null
function findSeat(state: LobbyState, userId: string): SeatId | null {
    if (state.seats.black?.userId === userId) return "black";
    if (state.seats.white?.userId === userId) return "white";
    return null;
}

// 片方の座席だけを差し替えた状態を作る
function withSeat(state: LobbyState, seatId: SeatId, occupant: Seat): LobbyState {
    const seats =
        seatId === "black"
            ? { black: occupant, white: state.seats.white }
            : { black: state.seats.black, white: occupant };
    return { ...state, seats };
}

// 座席と観戦者一覧の双方から指定ユーザーを取り除く
function removeParticipant(state: LobbyState, userId: string): LobbyState {
    const seatId = findSeat(state, userId);
    const seatRemoved = seatId === null ? state : withSeat(state, seatId, null);
    if (!seatRemoved.spectators.some((s) => s.userId === userId)) return seatRemoved;
    return {
        ...seatRemoved,
        spectators: seatRemoved.spectators.filter((s) => s.userId !== userId),
    };
}

// User ID と表示名がともに等しいかを検査する
function isSameParticipant(left: Seat, right: Participant): boolean {
    return left !== null && left.userId === right.userId && left.displayName === right.displayName;
}
