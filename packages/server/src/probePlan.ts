/**
 * 本番環境の疎通確認プローブ（M3-10）の純粋部分。
 *
 * 要件定義 §14 の E-01〜E-05 は、対局画面が自分の手番の合法手しか押せない作りである以上、
 * 通常の操作では再現できない。§15 が求める「クライアントからの入力は一切信用しない」
 * ことを本番環境で確かめるには、改変クライアント相当の生のメッセージを送る必要がある
 * （要件定義 §17 異常系「§14 の各項目を手動で再現する」）。
 *
 * ここでは現在のルーム状態から「いま再現できる異常系」を選び、送るメッセージと
 * 期待するエラーを組み立てる。WebSocket の入出力と結果の表示は probe.ts が担う。
 */

import { formatSquare, listLegalMoves } from "@othello/core";
import type {
    ClientMessage,
    ErrorCode,
    GameState,
    RoomState,
    ServerMessage,
    Square,
} from "@othello/protocol";

/** 再現する異常系。要件定義 §14 の番号をそのまま用いる。 */
export type ProbeCheckId = "E-01" | "E-02" | "E-03" | "E-04" | "E-05";

/** 1 件の異常系を再現するために送るメッセージと、期待する拒否内容。 */
export type ProbeCheck = {
    readonly id: ProbeCheckId;
    /** 要件定義 §14 の事象名 */
    readonly title: string;
    /** サーバーへ送る生のクライアントメッセージ */
    readonly message: ClientMessage;
    /** 期待するエラー種別 */
    readonly expected: ErrorCode;
};

/** いまのルーム状態では再現できない異常系と、その理由。 */
export type SkippedCheck = {
    readonly id: ProbeCheckId;
    /** 要件定義 §14 の事象名 */
    readonly title: string;
    /** 再現するために必要な状態を日本語で示す */
    readonly reason: string;
};

/** 現在のルーム状態に対して組み立てた検査計画。 */
export type ProbePlan = {
    /** いま実行できる検査 */
    readonly checks: readonly ProbeCheck[];
    /** いまは再現できない検査 */
    readonly skipped: readonly SkippedCheck[];
};

/** 1 件の異常系を再現した結果。 */
export type CheckOutcome = {
    readonly id: ProbeCheckId;
    /** 要件定義 §14 の事象名 */
    readonly title: string;
    /** 期待どおり拒否され、配信も起きなかったか */
    readonly passed: boolean;
    /** 判定の根拠を日本語で示す */
    readonly detail: string;
};

/** プローブの動作モード。check は異常系の再現、measure は応答時間の実測。 */
export type ProbeMode = "check" | "measure";

/** コマンドラインと環境変数から解決したプローブの設定。 */
export type ProbeArgs = {
    /** 動作モード */
    readonly mode: ProbeMode;
    /** 接続先の WebSocket URL（例: wss://othello.example.com/ws） */
    readonly url: string;
    /** Activity インスタンス ID */
    readonly instanceId: string;
    /** Discord のアクセストークン */
    readonly token: string;
    /** 1 件ごとに応答を待つ時間（ミリ秒） */
    readonly waitMs: number;
    /** measure で手番が回ってくるのを待つ上限時間（ミリ秒） */
    readonly turnTimeoutMs: number;
    /** measure で計測する回数 */
    readonly repeat: number;
    /** 応答性の合格線（ミリ秒）。要件定義 §12 の 1 秒 */
    readonly limitMs: number;
};

/** 引数の解決結果。誤りは例外ではなく使い方の案内として返す。 */
export type ProbeArgsResult =
    | { readonly ok: true; readonly args: ProbeArgs }
    | { readonly ok: false; readonly message: string };

/** 存在しない対局 ID（E-05）。実在し得ない値であればよい。 */
export const MISSING_GAME_ID = "00000000-0000-0000-0000-000000000000";

// 要件定義 §14 の事象名。表示にそのまま使う
const TITLES: Readonly<Record<ProbeCheckId, string>> = {
    "E-01": "手番でない者が着手した",
    "E-02": "非合法手が送られた",
    "E-03": "観戦者が着手を送った",
    "E-04": "既に終局した対局への着手",
    "E-05": "存在しない対局 ID の指定",
};

// 検査の順序。要件定義 §14 の並びに合わせる
const CHECK_IDS: readonly ProbeCheckId[] = ["E-01", "E-02", "E-03", "E-04", "E-05"];

// 盤面を 1 文字に潰す（比較用。石の色が区別できればよい）
const CELL_MARKS: Readonly<Record<string, string>> = { black: "B", white: "W", empty: "." };

// 1 件ぶんの組み立て結果。再現できない場合は理由の文字列を返す
type CheckDraft = ProbeCheck | string;

/**
 * 現在のルーム状態から、いま再現できる異常系の検査計画を組み立てる。
 * 判定に使うのはサーバーが配ったルーム状態だけで、盤面の解釈は @othello/core に委ねる。
 * @param state 接続直後に受け取ったルーム状態
 * @param userId プローブが名乗っている Discord User ID
 * @returns 実行できる検査と、再現できない検査の一覧
 */
export function planChecks(state: RoomState, userId: string): ProbePlan {
    const checks: ProbeCheck[] = [];
    const skipped: SkippedCheck[] = [];

    for (const id of CHECK_IDS) {
        const draft = draftCheck(id, state, userId);
        if (typeof draft === "string") skipped.push({ id, title: TITLES[id], reason: draft });
        else checks.push(draft);
    }

    return { checks, skipped };
}

/**
 * 異常系を再現して受け取った応答を判定する。
 * 期待どおりのエラーが返り、盤面の配信が起きていないことを合格とする
 * （要件定義 §14「盤面は変えない」）。
 * @param check 送った検査
 * @param responses 送信後の待ち時間に受け取ったサーバー通知
 * @returns 判定結果
 */
export function evaluateResponses(
    check: ProbeCheck,
    responses: readonly ServerMessage[],
): CheckOutcome {
    const broadcasts = responses.filter((message) => message.type !== "error");
    const errors = responses.flatMap((message) => (message.type === "error" ? [message] : []));
    const error = errors[0];

    if (error === undefined) {
        return outcome(check, false, `拒否されなかった（受信: ${describe(responses)}）`);
    }
    if (error.code !== check.expected) {
        return outcome(
            check,
            false,
            `エラー種別が違う（期待: ${check.expected} / 実際: ${error.code}）`,
        );
    }
    if (broadcasts.length > 0) {
        return outcome(
            check,
            false,
            `拒否と同時に配信が起きた（${describe(broadcasts)}）。` +
                "他の利用者の操作と重なった可能性があるため、操作を止めてやり直すこと",
        );
    }

    return outcome(check, true, `${error.code}「${error.message}」で拒否され、配信は起きなかった`);
}

/**
 * 盤面と手数を 1 行の文字列にまとめる。実行の前後で比べ、盤面が壊れていないことを確かめる。
 * @param game 対局状態。対局していなければ null
 * @returns 比較に使う文字列
 */
export function boardDigest(game: GameState | null): string {
    if (game === null) return "対局なし";

    const cells = game.board.flatMap((row) => row.map((cell) => CELL_MARKS[cell] ?? "?")).join("");
    return `${game.id}/手数${game.moveCount}/${cells}`;
}

/**
 * コマンドライン引数と環境変数からプローブの設定を組み立てる。
 * @param argv 実行時引数（process.argv の 3 番目以降）
 * @param env 環境変数
 * @returns 解決した設定、または使い方の案内
 */
export function parseProbeArgs(
    argv: readonly string[],
    env: Readonly<Partial<Record<string, string>>>,
): ProbeArgsResult {
    const options = new Map<string, string>();
    let mode: ProbeMode = "check";

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index]!;
        if (token === "check" || token === "measure") {
            mode = token;
            continue;
        }
        if (!token.startsWith("--"))
            return { ok: false, message: `解釈できない引数です: ${token}` };

        const [name, inlineValue] = splitOption(token.slice(2));
        const value = inlineValue ?? argv[++index];
        if (value === undefined) return { ok: false, message: `--${name} に値がありません` };
        options.set(name, value);
    }

    const url = options.get("url") ?? env.OTHELLO_PROBE_URL;
    const instanceId = options.get("instance") ?? env.OTHELLO_PROBE_INSTANCE;
    const token = options.get("token") ?? env.OTHELLO_PROBE_TOKEN;
    if (url === undefined || url === "") {
        return { ok: false, message: "接続先を --url か OTHELLO_PROBE_URL で指定してください" };
    }
    if (instanceId === undefined || instanceId === "") {
        return {
            ok: false,
            message: "インスタンス ID を --instance か OTHELLO_PROBE_INSTANCE で指定してください",
        };
    }
    if (token === undefined || token === "") {
        return {
            ok: false,
            message: "アクセストークンを --token か OTHELLO_PROBE_TOKEN で指定してください",
        };
    }

    const numbers = readNumbers(options);
    if (!numbers.ok) return numbers;

    return {
        ok: true,
        args: {
            mode,
            url,
            instanceId,
            token,
            waitMs: numbers.values.wait,
            turnTimeoutMs: numbers.values["turn-timeout"],
            repeat: numbers.values.repeat,
            limitMs: numbers.values.limit,
        },
    };
}

/**
 * 盤上で最初に見つかった合法手を返す。
 * @param board 現在の盤面
 * @param player 着手する側の色
 * @returns 合法手の座標表記。1 つも無ければ null
 */
export function pickLegalSquare(
    board: GameState["board"],
    player: "black" | "white",
): Square | null {
    for (const coord of listLegalMoves(board, player)) {
        const square = formatSquare(coord);
        if (square !== null) return square;
    }
    return null;
}

/**
 * 盤上で最初に見つかった石のあるマスを返す。石のあるマスは常に非合法手になる。
 * @param board 現在の盤面
 * @returns 石のあるマスの座標表記。空盤なら null
 */
export function pickOccupiedSquare(board: GameState["board"]): Square | null {
    for (let row = 0; row < board.length; row++) {
        const cells = board[row]!;
        for (let col = 0; col < cells.length; col++) {
            if (cells[col] !== "empty") return formatSquare({ row, col });
        }
    }
    return null;
}

/**
 * 対局状態から、指定ユーザーが着いている席を返す。
 * @param game 対局状態
 * @param userId Discord User ID
 * @returns 着いている席。対局者でなければ null
 */
export function seatOfGame(game: GameState, userId: string): "black" | "white" | null {
    if (game.players.black.userId === userId) return "black";
    if (game.players.white.userId === userId) return "white";
    return null;
}

// 数値の設定をまとめて読む。既定値は手作業の速さに合わせた値
type NumberResult =
    | { readonly ok: true; readonly values: Readonly<Record<NumberOption, number>> }
    | { readonly ok: false; readonly message: string };

type NumberOption = "wait" | "turn-timeout" | "repeat" | "limit";

const NUMBER_DEFAULTS: Readonly<Record<NumberOption, number>> = {
    wait: 2_000,
    "turn-timeout": 180_000,
    repeat: 3,
    // 要件定義 §12 の応答性（着手から盤面更新まで 1 秒以内）
    limit: 1_000,
};

function readNumbers(options: ReadonlyMap<string, string>): NumberResult {
    const values: Record<NumberOption, number> = { ...NUMBER_DEFAULTS };

    for (const name of Object.keys(NUMBER_DEFAULTS) as NumberOption[]) {
        const raw = options.get(name);
        if (raw === undefined) continue;

        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return { ok: false, message: `--${name} には正の数を指定してください: ${raw}` };
        }
        values[name] = parsed;
    }

    return { ok: true, values };
}

// 1 件ぶんの検査を組み立てる。再現できない場合は、必要な状態を日本語で返す
function draftCheck(id: ProbeCheckId, state: RoomState, userId: string): CheckDraft {
    // E-05 は対局の有無によらず、常に再現できる
    if (id === "E-05") {
        return check(id, { type: "move", gameId: MISSING_GAME_ID, square: "d3" }, "game_not_found");
    }

    const game = state.game;
    if (game === null) {
        return "対局がルーム状態に無い（対局を開始してから実行する。中断した対局は破棄される）";
    }

    const seat = seatOfGame(game, userId);
    const finished = game.result !== null;

    if (id === "E-04") {
        if (!finished) return "対局が進行中（投了か自然終局で終えたあと、再戦の前に実行する）";

        const square = pickOccupiedSquare(game.board);
        if (square === null) return "盤上に石が無く、送る座標を決められない";
        return check(id, { type: "move", gameId: game.id, square }, "invalid_state");
    }

    if (finished) return "対局が終局済み（対局中に実行する）";

    const turn = game.turn;
    if (turn === null) return "手番が確定していない";

    if (id === "E-03") {
        if (seat !== null) return "このトークンの利用者が対局者（観戦者のトークンで実行する）";

        // 観戦者であること以外に問題の無い手を送り、席の判定で拒否されることを確かめる
        const square = pickLegalSquare(game.board, turn);
        if (square === null) return "手番の側に合法手が無く、送る座標を決められない";
        return check(id, { type: "move", gameId: game.id, square }, "unauthorized");
    }

    if (seat === null) return "このトークンの利用者が対局者でない（対局者のトークンで実行する）";

    if (id === "E-01") {
        if (seat === turn) return "このトークンの利用者が手番（手番でない側のトークンで実行する）";

        // 手番の側にとっての合法手を送り、非合法だからではなく手番違いで拒否されることを確かめる
        const square = pickLegalSquare(game.board, turn);
        if (square === null) return "手番の側に合法手が無く、送る座標を決められない";
        return check(id, { type: "move", gameId: game.id, square }, "invalid_state");
    }

    // E-02: 石のあるマスは常に非合法手になる
    if (seat !== turn) return "このトークンの利用者が手番でない（手番側のトークンで実行する）";

    const square = pickOccupiedSquare(game.board);
    if (square === null) return "盤上に石が無く、非合法手を作れない";
    return check(id, { type: "move", gameId: game.id, square }, "illegal_move");
}

function check(id: ProbeCheckId, message: ClientMessage, expected: ErrorCode): ProbeCheck {
    return { id, title: TITLES[id], message, expected };
}

function outcome(check: ProbeCheck, passed: boolean, detail: string): CheckOutcome {
    return { id: check.id, title: check.title, passed, detail };
}

function describe(messages: readonly ServerMessage[]): string {
    if (messages.length === 0) return "何も届かなかった";
    return messages.map((message) => message.type).join(", ");
}

function splitOption(text: string): readonly [string, string | undefined] {
    const separator = text.indexOf("=");
    if (separator < 0) return [text, undefined];
    return [text.slice(0, separator), text.slice(separator + 1)];
}
