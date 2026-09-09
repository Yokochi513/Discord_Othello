import { describe, expect, it } from "vitest";

import { toErrorMessage } from "./errorMessage.ts";

describe("toErrorMessage", () => {
    it("Error のメッセージを返す", () => {
        expect(toErrorMessage(new Error("接続に失敗しました"))).toBe("接続に失敗しました");
    });

    it("Discord SDK のエラーコードとメッセージを返す", () => {
        expect(toErrorMessage({ code: 4008, message: "Invalid origin" })).toBe(
            "Invalid origin（コード: 4008）",
        );
    });

    it("メッセージがない Discord SDK エラーもコードを表示する", () => {
        expect(toErrorMessage({ code: "INVALID_TOKEN" })).toBe(
            "Discord SDK エラー（コード: INVALID_TOKEN）",
        );
    });

    it("その他のオブジェクトは JSON として表示する", () => {
        expect(toErrorMessage({ reason: "denied" })).toBe('{"reason":"denied"}');
    });

    it("循環参照を含むオブジェクトにも失敗しない", () => {
        const error: Record<string, unknown> = {};
        error.self = error;

        expect(toErrorMessage(error)).toBe("詳細を文字列に変換できないエラーが発生しました");
    });
});
