import { describe, expect, it } from "vitest";
import { BOARD_SIZE } from "./index.js";

describe("core パッケージ", () => {
    it("盤面は 8*8", () => {
        expect(BOARD_SIZE).toBe(8);
        expect(BOARD_SIZE * BOARD_SIZE).toBe(64);
    });
});