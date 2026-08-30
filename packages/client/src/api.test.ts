import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchApiJson, postApiJson, resolveApiPath } from "./api.ts";
import type { ClientConfig } from "./env.ts";

const config: ClientConfig = { discordClientId: "test-client-id", embedded: false };

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

describe("fetchApiJson", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("GET で応答の JSON を返す", async () => {
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );

        const result = await fetchApiJson<{ ok: boolean }>("/api/health", config);

        expect(result).toEqual({ ok: true });
        const [, init] = vi.mocked(fetch).mock.calls[0]!;
        expect(init?.method).toBeUndefined();
        expect(init?.body).toBeUndefined();
    });

    it("応答が失敗ステータスの場合は例外を投げる", async () => {
        vi.mocked(fetch).mockResolvedValue(new Response("error", { status: 500 }));

        await expect(fetchApiJson("/api/health", config)).rejects.toThrow(/500/);
    });
});

describe("postApiJson", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("JSON ボディを POST し、応答の JSON を返す", async () => {
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ access_token: "token-abc" }), { status: 200 }),
        );

        const result = await postApiJson<{ access_token: string }>("/api/token", config, {
            code: "code-123",
        });

        expect(result).toEqual({ access_token: "token-abc" });
        const [url, init] = vi.mocked(fetch).mock.calls[0]!;
        expect(url).toBe("/api/token");
        expect(init?.method).toBe("POST");
        expect(init?.headers).toEqual({
            Accept: "application/json",
            "Content-Type": "application/json",
        });
        expect(init?.body).toBe(JSON.stringify({ code: "code-123" }));
    });

    it("応答が失敗ステータスの場合は例外を投げる", async () => {
        vi.mocked(fetch).mockResolvedValue(new Response("error", { status: 400 }));

        await expect(postApiJson("/api/token", config, { code: "bad" })).rejects.toThrow(/400/);
    });
});
