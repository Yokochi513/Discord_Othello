import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exchangeCodeForToken, fetchDiscordUser, type OAuthConfig } from "./oauth.ts";

describe("exchangeCodeForToken", () => {
    const config: OAuthConfig = { clientId: "test-client-id", clientSecret: "test-client-secret" };

    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("認可コードをアクセストークンに交換する", async () => {
        const tokenResponse = {
            access_token: "token-abc",
            token_type: "Bearer",
            expires_in: 604800,
            refresh_token: "refresh-abc",
            scope: "identify",
        };
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify(tokenResponse), { status: 200 }),
        );

        const result = await exchangeCodeForToken(config, "code-123");

        expect(result).toEqual(tokenResponse);
        const [url, init] = vi.mocked(fetch).mock.calls[0]!;
        expect(url).toBe("https://discord.com/api/oauth2/token");
        expect(init?.method).toBe("POST");
        const body = init?.body as URLSearchParams;
        expect(body.get("client_id")).toBe("test-client-id");
        expect(body.get("client_secret")).toBe("test-client-secret");
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(body.get("code")).toBe("code-123");
    });

    it("Discord が失敗応答を返した場合は例外を投げる", async () => {
        vi.mocked(fetch).mockResolvedValue(new Response("invalid_grant", { status: 400 }));

        await expect(exchangeCodeForToken(config, "bad-code")).rejects.toThrow(/400/);
    });
});

describe("fetchDiscordUser", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("アクセストークンでユーザー情報を取得する", async () => {
        const user = { id: "user-1", username: "yokochi", global_name: "よこち" };
        vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(user), { status: 200 }));

        const result = await fetchDiscordUser("token-abc");

        expect(result).toEqual(user);
        const [url, init] = vi.mocked(fetch).mock.calls[0]!;
        expect(url).toBe("https://discord.com/api/users/@me");
        expect(init?.headers).toEqual({ Authorization: "Bearer token-abc" });
    });

    it("Discord が失敗応答を返した場合は例外を投げる", async () => {
        vi.mocked(fetch).mockResolvedValue(new Response("unauthorized", { status: 401 }));

        await expect(fetchDiscordUser("invalid-token")).rejects.toThrow(/401/);
    });
});
