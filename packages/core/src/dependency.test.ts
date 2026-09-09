/**
 * core が Discord / WebSocket や Node 固有 API に依存していないことを検証する。
 *
 * ソースの import 文そのものは eslint.config.js の no-restricted-imports
 * （packages/core 向けに node:* / discord* / ws / socket.io* 等を禁止）が
 * 静的に防いでいるため、ここでは package.json に宣言された依存が
 * 存在しないことのみを確認する。
 */

import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };

describe("core パッケージは Discord / WebSocket に依存しない", () => {
    it("package.json に dependencies を持たない", () => {
        expect("dependencies" in pkg).toBe(false);
    });
});
