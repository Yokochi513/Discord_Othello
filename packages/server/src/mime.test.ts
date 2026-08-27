import { describe, expect, it } from "vitest";

import { lookupContentType } from "./mime.ts";

describe("lookupContentType", () => {
    it("既知の拡張子には対応する Content-Type を返す", () => {
        expect(lookupContentType("index.html")).toBe("text/html; charset=utf-8");
        expect(lookupContentType("app.js")).toBe("text/javascript; charset=utf-8");
        expect(lookupContentType("logo.svg")).toBe("image/svg+xml");
    });

    it("拡張子の大文字小文字を区別しない", () => {
        expect(lookupContentType("IMAGE.PNG")).toBe("image/png");
    });

    it("未知の拡張子は application/octet-stream を返す", () => {
        expect(lookupContentType("archive.unknown")).toBe("application/octet-stream");
    });

    it("拡張子が無いファイルは application/octet-stream を返す", () => {
        expect(lookupContentType("LICENSE")).toBe("application/octet-stream");
    });
});
