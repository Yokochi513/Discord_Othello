import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStaticServer } from "./createServer.ts";
import type { OAuthConfig } from "./oauth.ts";

const oauth: OAuthConfig = { clientId: "test-client-id", clientSecret: "test-client-secret" };

describe("createStaticServer", () => {
    let rootDir: string;
    let server: Server;
    let baseUrl: string;

    beforeEach(async () => {
        rootDir = await mkdtemp(path.join(tmpdir(), "othello-server-"));
        await writeFile(path.join(rootDir, "index.html"), "<html>hello</html>");
        await writeFile(path.join(rootDir, "app.css"), "body{}");

        server = createStaticServer({ staticDir: rootDir, oauth });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
    });

    afterEach(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(rootDir, { recursive: true, force: true });
    });

    it("静的ファイルを 200 で返す", async () => {
        const res = await fetch(`${baseUrl}/app.css`);

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8");
        expect(await res.text()).toBe("body{}");
    });

    it("ルートは index.html を返す", async () => {
        const res = await fetch(`${baseUrl}/`);

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("<html>hello</html>");
    });

    it("存在しないパスは 404 を返す", async () => {
        const res = await fetch(`${baseUrl}/no-such-file`);

        expect(res.status).toBe(404);
    });

    it("GET / HEAD 以外のメソッドは 405 を返す", async () => {
        const res = await fetch(`${baseUrl}/`, { method: "POST" });

        expect(res.status).toBe(405);
        expect(res.headers.get("allow")).toBe("GET, HEAD");
    });

    it("HEAD はボディ無しでヘッダのみ返す", async () => {
        const res = await fetch(`${baseUrl}/app.css`, { method: "HEAD" });

        expect(res.status).toBe(200);
        expect(res.headers.get("content-length")).toBe("6");
        expect(await res.text()).toBe("");
    });

    describe("POST /api/token", () => {
        const realFetch = globalThis.fetch;

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        // discord.com 宛のみモックし、それ以外（テストからサーバーへの呼び出し）は実 fetch に委譲する
        function stubDiscordFetch(handler: (url: string) => Response): void {
            vi.stubGlobal(
                "fetch",
                vi.fn((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
                    const url = typeof input === "string" ? input : input.toString();
                    if (url.startsWith("https://discord.com/")) {
                        return Promise.resolve(handler(url));
                    }
                    return realFetch(input, init);
                }),
            );
        }

        it("認可コードをアクセストークンに交換し access_token を返す", async () => {
            stubDiscordFetch((url) => {
                if (url === "https://discord.com/api/oauth2/token") {
                    return new Response(
                        JSON.stringify({
                            access_token: "token-abc",
                            token_type: "Bearer",
                            expires_in: 604800,
                            refresh_token: "refresh-abc",
                            scope: "identify",
                        }),
                        { status: 200 },
                    );
                }
                if (url === "https://discord.com/api/users/@me") {
                    return new Response(
                        JSON.stringify({ id: "user-1", username: "yokochi", global_name: null }),
                        { status: 200 },
                    );
                }
                throw new Error(`unexpected fetch: ${url}`);
            });

            const res = await fetch(`${baseUrl}/api/token`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: "code-123" }),
            });

            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ access_token: "token-abc" });
        });

        it("Discord ユーザー情報の取得に失敗しても access_token は返す", async () => {
            stubDiscordFetch((url) => {
                if (url === "https://discord.com/api/oauth2/token") {
                    return new Response(
                        JSON.stringify({
                            access_token: "token-abc",
                            token_type: "Bearer",
                            expires_in: 604800,
                            refresh_token: "refresh-abc",
                            scope: "identify",
                        }),
                        { status: 200 },
                    );
                }
                return new Response("unauthorized", { status: 401 });
            });

            const res = await fetch(`${baseUrl}/api/token`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: "code-123" }),
            });

            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ access_token: "token-abc" });
        });

        it("code が無い場合は 400 を返す", async () => {
            const res = await fetch(`${baseUrl}/api/token`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(400);
        });

        it("トークン交換に失敗した場合は 502 を返す", async () => {
            stubDiscordFetch(() => new Response("invalid_grant", { status: 400 }));

            const res = await fetch(`${baseUrl}/api/token`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: "bad-code" }),
            });

            expect(res.status).toBe(502);
        });

        it("GET は 405 を返す", async () => {
            const res = await fetch(`${baseUrl}/api/token`);

            expect(res.status).toBe(405);
            expect(res.headers.get("allow")).toBe("POST");
        });
    });
});
