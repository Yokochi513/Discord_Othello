/**
 * unknown の例外値を画面表示用のメッセージへ変換する。
 * Discord Embedded App SDK は Error ではなく { code, message } を reject するため、
 * String(error) だけでは `[object Object]` になって原因を確認できない。
 * @param error 捕捉した例外値
 * @returns ユーザーが原因を確認できる文字列
 */
export function toErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;

    if (isRecord(error)) {
        const message = typeof error.message === "string" ? error.message : undefined;
        const code =
            typeof error.code === "string" || typeof error.code === "number"
                ? String(error.code)
                : undefined;

        if (message !== undefined && code !== undefined) return `${message}（コード: ${code}）`;
        if (message !== undefined) return message;
        if (code !== undefined) return `Discord SDK エラー（コード: ${code}）`;

        try {
            return JSON.stringify(error);
        } catch {
            return "詳細を文字列に変換できないエラーが発生しました";
        }
    }

    return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
