import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "./env.ts";

describe("loadConfig", () => {
    it("環境変数が未設定の場合はデフォルト値を使う", () => {
        const config = loadConfig({});

        expect(config.port).toBe(3000);
        expect(config.host).toBe("0.0.0.0");
        expect(path.basename(config.staticDir)).toBe("dist");
        expect(path.basename(path.dirname(config.staticDir))).toBe("client");
    });

    it("PORT / HOST / STATIC_DIR を環境変数から読み込む", () => {
        const config = loadConfig({
            PORT: "8080",
            HOST: "127.0.0.1",
            STATIC_DIR: "./some/dir",
        });

        expect(config.port).toBe(8080);
        expect(config.host).toBe("127.0.0.1");
        expect(config.staticDir).toBe(path.resolve("./some/dir"));
    });

    it("PORT が数値でない場合は例外を投げる", () => {
        expect(() => loadConfig({ PORT: "not-a-number" })).toThrow();
    });

    it("PORT が範囲外の場合は例外を投げる", () => {
        expect(() => loadConfig({ PORT: "0" })).toThrow();
        expect(() => loadConfig({ PORT: "65536" })).toThrow();
    });
});
