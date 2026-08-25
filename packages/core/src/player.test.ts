import { describe, expect, it } from "vitest";
import { FIRST_PLAYER, opponent } from "./player.js";

describe("手番", () => {
    it("先手は黒", () => {
        expect(FIRST_PLAYER).toBe("black");
    });

    it("opponent は手番を入れ替える", () => {
        expect(opponent("black")).toBe("white");
        expect(opponent("white")).toBe("black");
    });

    it("opponent を 2 回適用すると元に戻る", () => {
        expect(opponent(opponent("black"))).toBe("black");
        expect(opponent(opponent("white"))).toBe("white");
    });
});
