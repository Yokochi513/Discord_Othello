import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "./env.ts";

describe("loadConfig", () => {
    const requiredEnv = {
        DISCORD_CLIENT_ID: "test-client-id",
        DISCORD_CLIENT_SECRET: "test-client-secret",
    };

    it("環境変数が未設定の場合はデフォルト値を使う", () => {
        const config = loadConfig({ ...requiredEnv });

        expect(config.port).toBe(3000);
        expect(config.host).toBe("0.0.0.0");
        expect(path.basename(config.staticDir)).toBe("dist");
        expect(path.basename(path.dirname(config.staticDir))).toBe("client");
        expect(config.discordClientId).toBe("test-client-id");
        expect(config.discordClientSecret).toBe("test-client-secret");
    });

    it("PORT / HOST / STATIC_DIR を環境変数から読み込む", () => {
        const config = loadConfig({
            ...requiredEnv,
            PORT: "8080",
            HOST: "127.0.0.1",
            STATIC_DIR: "./some/dir",
        });

        expect(config.port).toBe(8080);
        expect(config.host).toBe("127.0.0.1");
        expect(config.staticDir).toBe(path.resolve("./some/dir"));
    });

    it("PORT が数値でない場合は例外を投げる", () => {
        expect(() => loadConfig({ ...requiredEnv, PORT: "not-a-number" })).toThrow();
    });

    it("PORT が範囲外の場合は例外を投げる", () => {
        expect(() => loadConfig({ ...requiredEnv, PORT: "0" })).toThrow();
        expect(() => loadConfig({ ...requiredEnv, PORT: "65536" })).toThrow();
    });

    it("DISCORD_CLIENT_ID が未設定の場合は例外を投げる", () => {
        expect(() => loadConfig({ DISCORD_CLIENT_SECRET: "test-client-secret" })).toThrow();
    });

    it("DISCORD_CLIENT_SECRET が未設定の場合は例外を投げる", () => {
        expect(() => loadConfig({ DISCORD_CLIENT_ID: "test-client-id" })).toThrow();
    });
});
