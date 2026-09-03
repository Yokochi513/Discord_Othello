import { describe, expect, it } from "vitest";

import { isClientMessage } from "./index.ts";

describe("isClientMessage", () => {
    it("定義済みメッセージを受け付ける", () => {
        expect(isClientMessage({ type: "seat", seat: "black" })).toBe(true);
        expect(isClientMessage({ type: "move", gameId: "game-1", square: "e6" })).toBe(true);
        expect(isClientMessage({ type: "resign", gameId: "game-1" })).toBe(true);
    });

    it("不正な入力を拒否する", () => {
        expect(isClientMessage({ type: "move", gameId: "game-1", square: "z9" })).toBe(false);
        expect(isClientMessage({ type: "seat", seat: "spectator" })).toBe(false);
        expect(
            isClientMessage({ type: "seat", seat: "black", instanceId: "spoofed-room" }),
        ).toBe(false);
        expect(isClientMessage({ type: "unknown" })).toBe(false);
    });
});
