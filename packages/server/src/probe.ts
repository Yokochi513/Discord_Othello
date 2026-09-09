/**
 * 本番環境の疎通確認プローブ（M3-10）。要件定義 §14 E-01〜E-05 / §12 応答性 / §17 に対応する。
 *
 * 対局画面は自分の手番の合法手しか押せないため、異常系は画面の操作では再現できない。
 * 改変クライアントを想定した検証（要件定義 §15）として、生の WebSocket メッセージを
 * 本番サーバーへ送り、いずれもサーバー側で拒否され盤面が変わらないことを確かめる。
 *
 * check  : いま再現できる異常系を実行し、拒否内容と盤面の不変を報告する
 * measure: 自分の手番で 1 手打ち、別接続へ盤面更新が届くまでの時間を測る（要件定義 §12）
 *
 * 使い方（手順と前提は docs/m3-10-two-player-playthrough.md を参照）:
 *   node dist/probe.js check   --url wss://othello.example.com/ws --instance <id> --token <token>
 *   node dist/probe.js measure --url wss://othello.example.com/ws --instance <id> --token <token>
 *
 * 対局者のトークンで実行する場合は、その人の Discord クライアントを開いたままにすること。
 * そのユーザーの接続がすべて閉じると、E-09 により対局が無効試合として終わる。
 */

import type { ClientMessage, GameState, RoomState, ServerMessage, Square } from "@othello/protocol";
import { WebSocket } from "ws";

import {
    boardDigest,
    evaluateResponses,
    parseProbeArgs,
    pickLegalSquare,
    planChecks,
    seatOfGame,
    type CheckOutcome,
    type ProbeArgs,
} from "./probePlan.ts";

/** 接続の確立と最初の通知を待つ上限時間（ミリ秒）。 */
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * 受信を溜めながら 1 本の接続を扱う。通知は接続と非同期に届くため、
 * すべて溜めたうえで条件に合うものを取り出す。
 */
class ProbeConnection {
    readonly #socket: WebSocket;
    readonly #queue: ServerMessage[] = [];
    #cursor = 0;
    #closed = false;
    #notify: (() => void) | null = null;

    /**
     * 受信を溜め始める。接続の確立そのものは open() が待つ。
     * @param socket 接続済み、または接続中の WebSocket
     */
    constructor(socket: WebSocket) {
        this.#socket = socket;
        socket.on("message", (data) => {
            const parsed = parseMessage(data.toString());
            if (parsed !== null) this.#queue.push(parsed);
            this.#notify?.();
        });
        socket.on("close", () => {
            this.#closed = true;
            this.#notify?.();
        });
    }

    /**
     * サーバーへ接続し、受信を溜め始める。
     * @param args プローブの設定
     * @returns 確立済みの接続
     */
    static async open(args: ProbeArgs): Promise<ProbeConnection> {
        const url = new URL(args.url);
        url.searchParams.set("access_token", args.token);
        url.searchParams.set("instance_id", args.instanceId);

        const socket = new WebSocket(url);
        const connection = new ProbeConnection(socket);
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error("接続が時間内に確立しませんでした")),
                CONNECT_TIMEOUT_MS,
            );
            socket.once("open", () => {
                clearTimeout(timer);
                resolve();
            });
            socket.once("error", (error: Error) => {
                clearTimeout(timer);
                reject(error);
            });
        });
        return connection;
    }

    /**
     * 操作をサーバーへ送る。
     * @param message 送信するクライアントメッセージ
     */
    send(message: ClientMessage): void {
        this.#socket.send(JSON.stringify(message));
    }

    /**
     * 条件に合う通知が届くまで待つ。合わない通知は読み飛ばす。
     * @param matches 取り出す通知の条件
     * @param timeoutMs 待つ上限時間（ミリ秒）
     * @returns 条件に合った通知。時間内に届かなければ null
     */
    async take(
        matches: (message: ServerMessage) => boolean,
        timeoutMs: number,
    ): Promise<ServerMessage | null> {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            while (this.#cursor < this.#queue.length) {
                const message = this.#queue[this.#cursor++]!;
                if (matches(message)) return message;
            }
            // 接続が切れたあとは新しい通知が来ないため、待たずに諦める
            if (this.#closed) return null;

            const remaining = deadline - Date.now();
            if (remaining <= 0) return null;
            await this.#waitForMessage(remaining);
        }
    }

    /**
     * 指定した時間だけ待ち、その間に届いた通知をすべて返す。
     * @param durationMs 待つ時間（ミリ秒）
     * @returns 届いた通知の一覧
     */
    async collect(durationMs: number): Promise<readonly ServerMessage[]> {
        await sleep(durationMs);
        return this.drain();
    }

    /**
     * まだ取り出していない通知を捨て、以後の待機に持ち越さないようにする。
     * @returns 捨てた通知の一覧
     */
    drain(): readonly ServerMessage[] {
        const pending = this.#queue.slice(this.#cursor);
        this.#cursor = this.#queue.length;
        return pending;
    }

    /** 接続を閉じる。 */
    close(): void {
        this.#socket.close();
    }

    // 次の通知が届くか、時間切れになるまで待つ。
    // 待ち時間そのものが終了を引き延ばさないよう、タイマーはイベントループに数えさせない
    #waitForMessage(timeoutMs: number): Promise<void> {
        return new Promise<void>((resolve) => {
            const timer = setTimeout(finish, timeoutMs);
            timer.unref();
            this.#notify = finish;

            function finish(): void {
                clearTimeout(timer);
                resolve();
            }
        }).finally(() => {
            this.#notify = null;
        });
    }
}

/** 接続直後に確定する、プローブ自身の立ち位置。 */
type ProbeIdentity = { readonly userId: string; readonly room: RoomState };

/**
 * プローブを実行する。異常系が 1 件でも期待どおりでなければ終了コード 1 で終わる。
 * @returns 実行の完了
 */
async function main(): Promise<void> {
    const parsed = parseProbeArgs(process.argv.slice(2), process.env);
    if (!parsed.ok) {
        console.error(`${parsed.message}\n`);
        console.error(
            "使い方: node dist/probe.js <check|measure> --url <wss://ホスト/ws> " +
                "--instance <インスタンスID> --token <アクセストークン>",
        );
        process.exitCode = 1;
        return;
    }

    const args = parsed.args;
    console.log(`接続先: ${args.url}`);
    console.log(`インスタンス: ${args.instanceId}`);

    const passed = args.mode === "check" ? await runChecks(args) : await runMeasure(args);
    if (!passed) process.exitCode = 1;
}

// 異常系 E-01〜E-05 のうち、いまのルーム状態で再現できるものを実行する
async function runChecks(args: ProbeArgs): Promise<boolean> {
    const connection = await ProbeConnection.open(args);
    try {
        const identity = await introduce(connection);
        const before = identity.room.game;
        report(identity);

        const plan = planChecks(identity.room, identity.userId);
        const outcomes: CheckOutcome[] = [];
        for (const check of plan.checks) {
            connection.drain();
            connection.send(check.message);
            const responses = await connection.collect(args.waitMs);
            const outcome = evaluateResponses(check, responses);
            outcomes.push(outcome);
            console.log(
                `[${outcome.passed ? "合格" : "不合格"}] ${outcome.id} ${outcome.title}: ${outcome.detail}`,
            );
            console.log(`  送信: ${JSON.stringify(check.message)}`);
        }
        for (const skipped of plan.skipped) {
            console.log(`[未実施] ${skipped.id} ${skipped.title}: ${skipped.reason}`);
        }

        const unchanged = await verifyBoardUnchanged(args, before);
        const failed = outcomes.filter((outcome) => !outcome.passed).length;
        console.log(
            `\n結果: 実施 ${outcomes.length} 件 / 不合格 ${failed} 件 / 未実施 ${plan.skipped.length} 件`,
        );
        return failed === 0 && unchanged;
    } finally {
        connection.close();
    }
}

// 自分の手番で 1 手打ち、別接続へ盤面更新が届くまでの時間を測る（要件定義 §12 応答性）
async function runMeasure(args: ProbeArgs): Promise<boolean> {
    const actor = await ProbeConnection.open(args);
    const observer = await ProbeConnection.open(args);
    try {
        const identity = await introduce(actor);
        await introduce(observer);
        report(identity);

        let room = identity.room;
        // 接続時の配信には古い局面が混じるため、進んだ手数だけを新しい状態として扱う
        let playedMoves = room.game?.moveCount ?? 0;
        const elapsed: number[] = [];
        for (let round = 0; round < args.repeat; round++) {
            const turn = await awaitMyTurn(
                actor,
                room,
                identity.userId,
                args.turnTimeoutMs,
                playedMoves,
            );
            if (turn === null) {
                console.log("自分の手番が回ってこなかったため、計測を打ち切ります");
                break;
            }

            const square = pickLegalSquare(turn.board, turn.seat);
            if (square === null) {
                console.log("合法手が見つからなかったため、計測を打ち切ります");
                break;
            }

            const observed = await playAndObserve(actor, observer, turn, square, args);
            if (observed.kind !== "applied") {
                console.log(
                    observed.kind === "rejected"
                        ? `着手 ${square} が拒否されました（${observed.detail}）`
                        : `着手 ${square} の盤面更新が届きませんでした`,
                );
                return false;
            }

            elapsed.push(observed.durationMs);
            console.log(
                `[${observed.durationMs <= args.limitMs ? "合格" : "不合格"}] ${round + 1} 回目: ` +
                    `着手 ${square} から別接続の盤面更新まで ${observed.durationMs.toFixed(0)} ミリ秒` +
                    `（上限 ${args.limitMs} ミリ秒）`,
            );

            const next = roomOf(observed.message);
            if (next === null) {
                console.log("対局が終局したため、計測を終えます");
                break;
            }
            room = next;
            playedMoves = next.game?.moveCount ?? playedMoves;
            if (next.game !== null && next.game.result !== null) {
                console.log("対局が終局したため、計測を終えます");
                break;
            }
        }

        if (elapsed.length === 0) {
            console.log("\n結果: 計測できませんでした");
            return false;
        }
        const worst = Math.max(...elapsed);
        console.log(
            `\n結果: ${elapsed.length} 回計測 / 最大 ${worst.toFixed(0)} ミリ秒 / ` +
                `平均 ${(elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length).toFixed(0)} ミリ秒`,
        );
        return worst <= args.limitMs;
    } finally {
        actor.close();
        observer.close();
    }
}

// 接続直後の connected と state を読み、自分の User ID と現在のルーム状態を確定する
async function introduce(connection: ProbeConnection): Promise<ProbeIdentity> {
    const connected = await connection.take(
        (message) => message.type === "connected",
        CONNECT_TIMEOUT_MS,
    );
    if (connected === null || connected.type !== "connected") {
        throw new Error("接続通知が届きませんでした（アクセストークンを確認してください）");
    }

    const state = await connection.take((message) => message.type === "state", CONNECT_TIMEOUT_MS);
    if (state === null || state.type !== "state") {
        throw new Error("ルーム状態が届きませんでした");
    }

    return { userId: connected.userId, room: state.state };
}

// 接続したプローブ自身の立ち位置と、いまの対局の状況を表示する
function report(identity: ProbeIdentity): void {
    const game = identity.room.game;
    const seat = game === null ? null : seatOfGame(game, identity.userId);
    console.log(`利用者: ${identity.userId}（${seat === null ? "観戦者" : `${seat} 番`}）`);
    console.log(
        game === null
            ? "対局: なし"
            : `対局: ${game.id} 手数 ${game.moveCount} 手番 ${game.turn ?? "終局"}` +
                  `（黒 ${game.scores.black} / 白 ${game.scores.white}）`,
    );
    console.log("");
}

// 異常系を試したあとに接続し直し、盤面が実行前と同じであることを確かめる
async function verifyBoardUnchanged(args: ProbeArgs, before: GameState | null): Promise<boolean> {
    const connection = await ProbeConnection.open(args);
    try {
        const { room } = await introduce(connection);
        const unchanged = boardDigest(room.game) === boardDigest(before);
        console.log(
            unchanged
                ? "[合格] 盤面は実行前と同じ（拒否によって盤面は壊れていない）"
                : "[不合格] 盤面が実行前と変わっている（他の利用者の操作と重なっていないか確認すること）",
        );
        return unchanged;
    } finally {
        connection.close();
    }
}

// 1 手打った結果。拒否された場合と、盤面更新が届かなかった場合を区別する
type MoveObservation =
    | { readonly kind: "applied"; readonly message: ServerMessage; readonly durationMs: number }
    | { readonly kind: "rejected"; readonly detail: string }
    | { readonly kind: "timeout" };

// 1 手打ち、その手が別接続へ配信されるまでの時間を測る。
// 自分の手が届いたことを確かめるため、直前の手が送った座標である盤面だけを待つ
async function playAndObserve(
    actor: ProbeConnection,
    observer: ProbeConnection,
    game: GameState,
    square: Square,
    args: ProbeArgs,
): Promise<MoveObservation> {
    actor.drain();
    observer.drain();

    const startedAt = performance.now();
    actor.send({ type: "move", gameId: game.id, square });

    const applied = observer.take(
        (message) => isAppliedMove(message, game.moveCount, square),
        args.turnTimeoutMs,
    );
    const rejected = actor.take((message) => message.type === "error", args.turnTimeoutMs);
    const first = await Promise.race([
        applied.then((message) => ({ role: "applied", message }) as const),
        rejected.then((message) => ({ role: "rejected", message }) as const),
    ]);

    if (first.role === "rejected" && first.message !== null && first.message.type === "error") {
        return { kind: "rejected", detail: `${first.message.code}: ${first.message.message}` };
    }
    const message = first.role === "applied" ? first.message : await applied;
    if (message === null) return { kind: "timeout" };

    return { kind: "applied", message, durationMs: performance.now() - startedAt };
}

// 自分の手番になるまで待つ。すでに手番であればそのまま返す。
// 接続時の配信には古い局面が混じるため、minimumMoveCount より前の状態は読み飛ばす
async function awaitMyTurn(
    connection: ProbeConnection,
    current: RoomState,
    userId: string,
    timeoutMs: number,
    minimumMoveCount: number,
): Promise<(GameState & { readonly seat: "black" | "white" }) | null> {
    const deadline = Date.now() + timeoutMs;
    let room: RoomState | null = current;

    for (;;) {
        const game = room?.game ?? null;
        const seat = game === null ? null : seatOfGame(game, userId);
        if (
            game !== null &&
            seat !== null &&
            game.result === null &&
            game.turn === seat &&
            game.moveCount >= minimumMoveCount
        ) {
            return { ...game, seat };
        }

        const remaining = deadline - Date.now();
        if (remaining <= 0) return null;
        const next = await connection.take((message) => roomOf(message) !== null, remaining);
        if (next === null) return null;
        room = roomOf(next);
    }
}

// 盤面を伴う通知から、対局の載ったルーム状態を取り出す
function roomOf(message: ServerMessage): RoomState | null {
    if (message.type === "state") return message.state;
    return null;
}

// 送った手が適用された盤面かを判定する。自動パスで手数が 2 つ進むこともある（F-09）
function isAppliedMove(message: ServerMessage, moveCount: number, square: Square): boolean {
    const game = message.type === "state" ? message.state.game : null;
    const applied = message.type === "game_ended" ? message.game : game;
    if (applied === null) return false;

    return applied.moveCount > moveCount && applied.lastMove === square;
}

function parseMessage(text: string): ServerMessage | null {
    try {
        return JSON.parse(text) as ServerMessage;
    } catch {
        return null;
    }
}

function sleep(durationMs: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, durationMs));
}

// 接続や通信の失敗は、原因の分かる 1 行にまとめて終了コードで伝える（要件定義 §14 E-15）
await main().catch((error: unknown) => {
    console.error(
        `プローブの実行に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
});
