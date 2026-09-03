/** クライアントからサーバーへ送る対局操作。ユーザーとインスタンスは接続情報から確定する。 */
export type ClientMessage =
    | { readonly type: "seat"; readonly seat: "black" | "white" }
    | { readonly type: "leave" }
    | { readonly type: "start_game" }
    | { readonly type: "move"; readonly gameId: string; readonly square: Square }
    | { readonly type: "resign"; readonly gameId: string }
    | { readonly type: "abort"; readonly gameId: string };

/** サーバーからクライアントへ送る通知。 */
export type ServerMessage =
    | { readonly type: "connected"; readonly userId: string; readonly instanceId: string }
    | { readonly type: "state"; readonly state: RoomState }
    | { readonly type: "game_started"; readonly game: GameState }
    | { readonly type: "game_ended"; readonly game: GameState; readonly reason: GameEndReason }
    | { readonly type: "error"; readonly code: ErrorCode; readonly message: string };

/** 盤上の座標。 */
export type Square = `${"a" | "b" | "c" | "d" | "e" | "f" | "g" | "h"}${
    | "1"
    | "2"
    | "3"
    | "4"
    | "5"
    | "6"
    | "7"
    | "8"}`;

/** プレイヤーが着席している場合の公開情報。 */
export type Seat = { readonly userId: string; readonly displayName: string } | null;

/** Activity インスタンスに属するロビーと対局のスナップショット。 */
export type RoomState = {
    readonly instanceId: string;
    readonly seats: { readonly black: Seat; readonly white: Seat };
    readonly game: GameState | null;
};

/** クライアント表示に必要な対局状態。 */
export type GameState = {
    readonly id: string;
    readonly board: readonly (readonly ("black" | "white" | "empty")[])[];
    readonly turn: "black" | "white";
};

/** 対局の終了理由。 */
export type GameEndReason = "both_passed" | "board_full" | "resign" | "abort";

/** サーバーがクライアントへ通知するエラー種別。 */
export type ErrorCode =
    | "invalid_message"
    | "unauthorized"
    | "seat_unavailable"
    | "game_not_found"
    | "illegal_move"
    | "invalid_state";

/**
 * JSON 値が、現在サポートするクライアントメッセージかを検査する。
 * @param value 検査する値
 * @returns クライアントメッセージなら true
 */
export function isClientMessage(value: unknown): value is ClientMessage {
    if (!isRecord(value) || typeof value.type !== "string") return false;
    if ("userId" in value || "instanceId" in value) return false;

    switch (value.type) {
        case "seat":
            return value.seat === "black" || value.seat === "white";
        case "leave":
        case "start_game":
            return true;
        case "move":
            return isNonEmptyString(value.gameId) && isSquare(value.square);
        case "resign":
        case "abort":
            return isNonEmptyString(value.gameId);
        default:
            return false;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

function isSquare(value: unknown): value is Square {
    return typeof value === "string" && /^[a-h][1-8]$/.test(value);
}
