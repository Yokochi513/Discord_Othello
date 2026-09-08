/**
 * 対局画面に出す内容の組み立て（要件定義 §7.3 / F-06〜F-09・F-11〜F-13）。
 *
 * 盤面・石数・手番・直前の手はサーバーから届いた対局状態をそのまま採る（要件定義 §5.4）。
 * 例外は打てるマスの明示だけで、応答を待たずに印を出したいので @othello/core で判定する。
 * DOM にも React にも依存しない純粋な関数として実装し、画面（Game.tsx）は結果を描くだけにする。
 */

import { BOARD_SIZE, formatSquare, listLegalMoves } from "@othello/core";
import type { GameState, RoomState, Square } from "@othello/protocol";

import type { ClientState, SeatId } from "./roomState.ts";

/** 盤上のマス 1 つ分の表示内容。 */
export type CellView = {
    /** マスの座標表記（a1〜h8） */
    readonly square: Square;
    /** マスに置かれている石。空マスなら "empty" */
    readonly stone: "black" | "white" | "empty";
    /** 打てるマスの印を出すか（手番側にのみ出す。要件定義 §7.3） */
    readonly legal: boolean;
    /** 直前に打たれた手か */
    readonly last: boolean;
    /** クリック／タップで着手できるか（観戦者・手番でない側は常に false） */
    readonly playable: boolean;
};

/** 対局者 1 人分の表示内容。 */
export type PlayerView = {
    /** 座席の色 */
    readonly seat: SeatId;
    /** 座席の表示名（黒 / 白） */
    readonly label: string;
    /** 座席を表す石の記号 */
    readonly mark: string;
    /** Discord の表示名 */
    readonly displayName: string;
    /** 現在の石数 */
    readonly score: number;
    /** 自分自身か */
    readonly mine: boolean;
    /** この人の手番か */
    readonly inTurn: boolean;
    /** ルームに在室しているか（要件定義 §7.3 の接続状態） */
    readonly connected: boolean;
    /** 接続状態の表示名（接続中 / 切断） */
    readonly connectionLabel: string;
};

/** 対局画面全体の表示内容。 */
export type GameView = {
    /** a1 から h8 まで、行昇順・列昇順に並べた 64 マス */
    readonly cells: readonly CellView[];
    /** 黒番・白番の順に並べた対局者 */
    readonly players: readonly [PlayerView, PlayerView];
    /** 現在の手番を伝える文言 */
    readonly turnNotice: string;
    /** 経過手数。自動パスも 1 手として数える */
    readonly moveCount: number;
    /** 直前に打たれた手。まだ着手がなければ null */
    readonly lastMove: Square | null;
    /** 自分がこの対局の対局者か（観戦者なら false） */
    readonly isPlayer: boolean;
    /** 今このマスをクリックして着手できる状態か */
    readonly canPlay: boolean;
    /** 投了・中断を押せるか（要件定義 F-11・F-12） */
    readonly canControl: boolean;
    /** 直前にパスが起きた旨の文言。起きていなければ null（要件定義 F-09） */
    readonly passNotice: string | null;
};

// 座席の色の表示名と記号（要件定義 §7.2 の画面案に合わせる）
const SEAT_LABELS: Readonly<Record<SeatId, string>> = { black: "黒", white: "白" };
const SEAT_MARKS: Readonly<Record<SeatId, string>> = { black: "⚫", white: "⚪" };

/**
 * クライアント状態から対局画面の表示内容を組み立てる。
 * @param state 現在のクライアント状態
 * @returns 対局画面の表示内容。ルーム状態か対局が届いていなければ null
 */
export function buildGameView(state: ClientState): GameView | null {
    const room = state.room;
    const game = room?.game ?? null;
    if (room === null || game === null) return null;

    const mySeat = findSeat(game, state.userId);
    // 接続が切れている間は送信できないため、操作そのものを受け付けない（要件定義 §14 E-15）
    const connected = state.connection === "open";
    const inPlay = game.result === null;
    const canPlay = connected && inPlay && mySeat !== null && game.turn === mySeat;
    const legalSquares = collectLegalSquares(game, mySeat);

    return {
        cells: buildCells(game, legalSquares, canPlay),
        players: [
            buildPlayerView("black", game, room, state.userId),
            buildPlayerView("white", game, room, state.userId),
        ],
        turnNotice: turnNotice(game.turn, mySeat),
        moveCount: game.moveCount,
        lastMove: game.lastMove,
        isPlayer: mySeat !== null,
        canPlay,
        canControl: connected && inPlay && mySeat !== null,
        passNotice: passNotice(state.passedBy),
    };
}

// 盤面を a1 から h8 まで（行昇順・列昇順）の 64 マスへ並べ直す
function buildCells(
    game: GameState,
    legalSquares: ReadonlySet<Square>,
    canPlay: boolean,
): readonly CellView[] {
    const cells: CellView[] = [];

    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const square = formatSquare({ row, col });
            // 盤上の座標しか作らないため null にはならない
            if (square === null) continue;

            const legal = legalSquares.has(square);
            cells.push({
                square,
                stone: game.board[row]?.[col] ?? "empty",
                legal,
                last: game.lastMove === square,
                playable: canPlay && legal,
            });
        }
    }

    return cells;
}

// 打てるマスは手番側にだけ示す（要件定義 §7.3）。観戦者と手番でない側には出さない
function collectLegalSquares(game: GameState, mySeat: SeatId | null): ReadonlySet<Square> {
    const turn = game.turn;
    if (turn === null || turn !== mySeat || game.result !== null) return new Set();

    const squares = new Set<Square>();
    for (const coord of listLegalMoves(game.board, turn)) {
        const square = formatSquare(coord);
        if (square !== null) squares.add(square);
    }
    return squares;
}

function buildPlayerView(
    seat: SeatId,
    game: GameState,
    room: RoomState,
    userId: string | null,
): PlayerView {
    const player = game.players[seat];
    // 対局者はルームに在室している間だけ座席か観戦者一覧に現れる（要件定義 §11.3）
    const connected = isInRoom(room, player.userId);

    return {
        seat,
        label: SEAT_LABELS[seat],
        mark: SEAT_MARKS[seat],
        displayName: player.displayName,
        score: game.scores[seat],
        mine: player.userId === userId,
        inTurn: game.turn === seat,
        connected,
        connectionLabel: connected ? "接続中" : "切断",
    };
}

// この対局で自分が着いている座席。対局開始時の顔ぶれで決まるため、ロビーの座席では判定しない
function findSeat(game: GameState, userId: string | null): SeatId | null {
    if (userId === null) return null;
    if (game.players.black.userId === userId) return "black";
    if (game.players.white.userId === userId) return "white";
    return null;
}

function isInRoom(room: RoomState, userId: string): boolean {
    if (room.seats.black?.userId === userId) return true;
    if (room.seats.white?.userId === userId) return true;
    return room.spectators.some((spectator) => spectator.userId === userId);
}

// 手番は対局者と観戦者で言い回しを変え、自分の番かどうかを一目で分かるようにする
function turnNotice(turn: SeatId | null, mySeat: SeatId | null): string {
    if (turn === null) return "手番はありません";
    if (mySeat === null) return `${SEAT_LABELS[turn]}の番です`;
    return turn === mySeat ? "あなたの番です" : "相手の番です";
}

// 直前の着手に続いて自動パスが起きた旨を伝える（要件定義 F-09）
function passNotice(passedBy: readonly SeatId[]): string | null {
    if (passedBy.length === 0) return null;
    const names = passedBy.map((seat) => SEAT_LABELS[seat]).join("・");
    return `${names}は打てるマスが無いためパスしました`;
}
