import { describe, expect, it } from "vitest";

import { avatarInitial, buildAvatarMap, resolveAvatarUrl } from "./participants.ts";

describe("resolveAvatarUrl", () => {
    it("アバターを設定している参加者は その画像を指す", () => {
        expect(resolveAvatarUrl({ id: "123", avatar: "abcdef" })).toBe(
            "https://cdn.discordapp.com/avatars/123/abcdef.png?size=64",
        );
    });

    it("アバターが無ければ User ID から決まる既定アバターを指す", () => {
        // (1234567890123456789 >> 22) % 6 = 1
        expect(resolveAvatarUrl({ id: "1234567890123456789", avatar: null })).toBe(
            "https://cdn.discordapp.com/embed/avatars/1.png",
        );
    });

    it("旧方式のアカウントはタグ番号から既定アバターを決める", () => {
        expect(resolveAvatarUrl({ id: "123", discriminator: "0007" })).toBe(
            "https://cdn.discordapp.com/embed/avatars/2.png",
        );
    });

    it("解釈できない User ID でも URL を返す", () => {
        expect(resolveAvatarUrl({ id: "not-a-number" })).toBe(
            "https://cdn.discordapp.com/embed/avatars/0.png",
        );
    });
});

describe("buildAvatarMap", () => {
    it("User ID から URL を引けるようにする", () => {
        const avatars = buildAvatarMap([
            { id: "1", avatar: "aaa" },
            { id: "2", avatar: "bbb" },
        ]);

        expect(avatars.get("1")).toBe("https://cdn.discordapp.com/avatars/1/aaa.png?size=64");
        expect(avatars.get("2")).toBe("https://cdn.discordapp.com/avatars/2/bbb.png?size=64");
        expect(avatars.get("3")).toBeUndefined();
    });
});

describe("avatarInitial", () => {
    it("表示名の先頭 1 文字を返す", () => {
        expect(avatarInitial("アリス")).toBe("ア");
        expect(avatarInitial("  よこち")).toBe("よ");
    });

    it("サロゲートペアを割らない", () => {
        expect(avatarInitial("🐈ねこ")).toBe("🐈");
    });

    it("表示名が空なら疑問符を返す", () => {
        expect(avatarInitial("   ")).toBe("?");
    });
});
