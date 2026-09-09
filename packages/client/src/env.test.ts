import { describe, expect, it } from "vitest";

import { isEmbedded, loadClientConfig } from "./env.ts";

describe("isEmbedded", () => {
    it("frame_id があれば iframe 内と判定する", () => {
        expect(isEmbedded("?frame_id=abc123&instance_id=xyz")).toBe(true);
    });

    it("先頭の ? がなくても判定できる", () => {
        expect(isEmbedded("frame_id=abc123")).toBe(true);
    });

    it("クエリが空なら iframe 外と判定する", () => {
        expect(isEmbedded("")).toBe(false);
        expect(isEmbedded("?")).toBe(false);
    });

    it("frame_id 以外のクエリだけなら iframe 外と判定する", () => {
        expect(isEmbedded("?instance_id=xyz")).toBe(false);
    });

    it("frame_id が空文字なら iframe 外と判定する", () => {
        expect(isEmbedded("?frame_id=")).toBe(false);
    });
});

describe("loadClientConfig", () => {
    it("環境変数から Client ID を読み込む", () => {
        const config = loadClientConfig({ VITE_DISCORD_CLIENT_ID: "1234567890" }, "?frame_id=abc");

        expect(config.discordClientId).toBe("1234567890");
        expect(config.embedded).toBe(true);
    });

    it("iframe 外での起動も設定として成立する", () => {
        const config = loadClientConfig({ VITE_DISCORD_CLIENT_ID: "1234567890" }, "");

        expect(config.embedded).toBe(false);
    });

    it("Client ID が未設定の場合は例外を投げる", () => {
        expect(() => loadClientConfig({}, "")).toThrow();
    });

    it("Client ID が空文字の場合は例外を投げる", () => {
        expect(() => loadClientConfig({ VITE_DISCORD_CLIENT_ID: "" }, "")).toThrow();
    });
});
