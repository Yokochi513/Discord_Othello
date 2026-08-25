import { describe, expect, it } from "vitest";
import { BOARD_SIZE, formatSquare, isOnBoard, isSquare, parseSquare } from "./coord.js";
import type { Square } from "./type.js";

/**
 * 全 64 マスの座標表記を列挙するテスト用ヘルパー。
 * 検証対象の formatSquare を使わず、テスト側で独立に組み立てる。
 */
function everySquare(): Square[] {
    return [..."12345678"].flatMap((rank) =>
        [..."abcdefgh"].map((file) => `${file}${rank}` as Square),
    );
}

describe("盤面の定数", () => {
    it("盤面は 8*8", () => {
        expect(BOARD_SIZE).toBe(8);
        expect(BOARD_SIZE * BOARD_SIZE).toBe(64);
    });
});

describe("parseSquare", () => {
    it("左上が a1、右下が h8", () => {
        expect(parseSquare("a1")).toEqual({ row: 0, col: 0 });
        expect(parseSquare("h8")).toEqual({ row: 7, col: 7 });
    });

    it("列が col、行が row に対応する", () => {
        // h1 は右上（列 h = col 7、行 1 = row 0）
        expect(parseSquare("h1")).toEqual({ row: 0, col: 7 });
        // a8 は左下（列 a = col 0、行 8 = row 7）
        expect(parseSquare("a8")).toEqual({ row: 7, col: 0 });
        // 初期配置の 4 マス
        expect(parseSquare("d4")).toEqual({ row: 3, col: 3 });
        expect(parseSquare("e5")).toEqual({ row: 4, col: 4 });
    });

    it.each([
        ["", "空文字"],
        ["a", "1 文字"],
        ["a12", "3 文字"],
        ["a0", "行が小さすぎる"],
        ["a9", "行が大きすぎる"],
        ["i1", "列が範囲外"],
        ["`1", "列の 1 つ手前の文字"],
        ["1a", "列と行が逆"],
        ["aa", "行が数字でない"],
        ["11", "列が英字でない"],
        ["A1", "大文字"],
        ["D4", "大文字"],
        [" a1", "前後の空白"],
        ["a1 ", "前後の空白"],
        ["ａ１", "全角"],
    ])("不正な表記 %s（%s）は null を返す", (input) => {
        expect(parseSquare(input)).toBeNull();
    });
});

describe("formatSquare", () => {
    it("左上が a1、右下が h8", () => {
        expect(formatSquare({ row: 0, col: 0 })).toBe("a1");
        expect(formatSquare({ row: 7, col: 7 })).toBe("h8");
    });

    it("列が col、行が row に対応する", () => {
        expect(formatSquare({ row: 0, col: 7 })).toBe("h1");
        expect(formatSquare({ row: 7, col: 0 })).toBe("a8");
        expect(formatSquare({ row: 3, col: 3 })).toBe("d4");
        expect(formatSquare({ row: 4, col: 4 })).toBe("e5");
    });

    it.each([
        [{ row: -1, col: 0 }, "row が負"],
        [{ row: 0, col: -1 }, "col が負"],
        [{ row: BOARD_SIZE, col: 0 }, "row が範囲外"],
        [{ row: 0, col: BOARD_SIZE }, "col が範囲外"],
        [{ row: 0.5, col: 0 }, "row が小数"],
        [{ row: 0, col: 0.5 }, "col が小数"],
        [{ row: Number.NaN, col: 0 }, "NaN"],
        [{ row: Number.POSITIVE_INFINITY, col: 0 }, "Infinity"],
    ])("盤外の座標 %o（%s）は null を返す", (coord) => {
        expect(formatSquare(coord)).toBeNull();
    });
});

describe("座標変換の往復一致", () => {
    it("全 64 マスで 表記 → インデックス → 表記 が一致する", () => {
        const squares = everySquare();
        expect(squares).toHaveLength(64);
        expect(new Set(squares).size).toBe(64);

        for (const square of squares) {
            const coord = parseSquare(square);
            expect(coord, `${square} は盤上のマス`).not.toBeNull();
            expect(formatSquare(coord!), `${square} の往復`).toBe(square);
        }
    });

    it("全 64 マスで インデックス → 表記 → インデックス が一致する", () => {
        for (let row = 0; row < BOARD_SIZE; row++) {
            for (let col = 0; col < BOARD_SIZE; col++) {
                const square = formatSquare({ row, col });
                expect(square, `(${row}, ${col}) は盤上のマス`).not.toBeNull();
                expect(parseSquare(square!), `(${row}, ${col}) の往復`).toEqual({ row, col });
            }
        }
    });
});

describe("isOnBoard", () => {
    it("盤上の全 64 マスで true", () => {
        for (let row = 0; row < BOARD_SIZE; row++) {
            for (let col = 0; col < BOARD_SIZE; col++) {
                expect(isOnBoard({ row, col }), `(${row}, ${col})`).toBe(true);
            }
        }
    });

    it("盤外の座標で false", () => {
        expect(isOnBoard({ row: -1, col: 0 })).toBe(false);
        expect(isOnBoard({ row: 0, col: -1 })).toBe(false);
        expect(isOnBoard({ row: BOARD_SIZE, col: 0 })).toBe(false);
        expect(isOnBoard({ row: 0, col: BOARD_SIZE })).toBe(false);
        expect(isOnBoard({ row: 1.5, col: 0 })).toBe(false);
        expect(isOnBoard({ row: Number.NaN, col: Number.NaN })).toBe(false);
    });
});

describe("isSquare", () => {
    it("盤上の全 64 マスで true", () => {
        for (const square of everySquare()) {
            expect(isSquare(square), square).toBe(true);
        }
    });

    it("不正な表記で false", () => {
        expect(isSquare("a0")).toBe(false);
        expect(isSquare("i1")).toBe(false);
        expect(isSquare("A1")).toBe(false);
        expect(isSquare("")).toBe(false);
    });
});