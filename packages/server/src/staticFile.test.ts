import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveStaticFile } from "./staticFile.ts";

describe("resolveStaticFile", () => {
    let rootDir: string;

    beforeEach(async () => {
        rootDir = await mkdtemp(path.join(tmpdir(), "othello-static-"));
        await writeFile(path.join(rootDir, "index.html"), "<html>root</html>");
        await mkdir(path.join(rootDir, "assets"));
        await writeFile(path.join(rootDir, "assets", "app.js"), "console.log(1)");
        await mkdir(path.join(rootDir, "sub"));
        await writeFile(path.join(rootDir, "sub", "index.html"), "<html>sub</html>");
    });

    afterEach(async () => {
        await rm(rootDir, { recursive: true, force: true });
    });

    it("ファイルを直接指すパスを解決する", async () => {
        const resolved = await resolveStaticFile(rootDir, "/assets/app.js");

        expect(resolved?.filePath).toBe(path.join(rootDir, "assets", "app.js"));
        expect(resolved?.size).toBeGreaterThan(0);
    });

    it("ルート直下は index.html を返す", async () => {
        const resolved = await resolveStaticFile(rootDir, "/");

        expect(resolved?.filePath).toBe(path.join(rootDir, "index.html"));
    });

    it("ディレクトリを指すパスは配下の index.html へフォールバックする", async () => {
        const resolved = await resolveStaticFile(rootDir, "/sub");

        expect(resolved?.filePath).toBe(path.join(rootDir, "sub", "index.html"));
    });

    it("存在しないパスは null を返す", async () => {
        expect(await resolveStaticFile(rootDir, "/no-such-file.txt")).toBeNull();
    });

    it("ディレクトリトラバーサルを拒否する", async () => {
        expect(await resolveStaticFile(rootDir, "/../../../../etc/passwd")).toBeNull();
        expect(await resolveStaticFile(rootDir, "/assets/../../outside")).toBeNull();
    });

    it("不正なパーセントエンコーディングは null を返す", async () => {
        expect(await resolveStaticFile(rootDir, "/%")).toBeNull();
    });
});
