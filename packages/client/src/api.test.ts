import { describe, expect, it } from "vitest";

import { resolveApiPath } from "./api.ts";

describe("resolveApiPath", () => {
    it("iframe 内では Discord のプロキシ接頭辞を付ける", () => {
        expect(resolveApiPath("/api/token", true)).toBe("/.proxy/api/token");
    });

    it("iframe 外ではパスをそのまま使う", () => {
        expect(resolveApiPath("/api/token", false)).toBe("/api/token");
    });

    it("先頭のスラッシュが無い入力を補正する", () => {
        expect(resolveApiPath("api/token", true)).toBe("/.proxy/api/token");
        expect(resolveApiPath("api/token", false)).toBe("/api/token");
    });

    it("連続するスラッシュをまとめる", () => {
        expect(resolveApiPath("//api//token", true)).toBe("/.proxy/api/token");
    });

    it("既に接頭辞が付いている場合は二重に付けない", () => {
        expect(resolveApiPath("/.proxy/api/token", true)).toBe("/.proxy/api/token");
    });

    it("接頭辞と紛らわしいパスには接頭辞を付ける", () => {
        expect(resolveApiPath("/.proxyfoo/api", true)).toBe("/.proxy/.proxyfoo/api");
    });
});
