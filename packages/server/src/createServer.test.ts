import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createStaticServer } from "./createServer.ts";

describe("createStaticServer", () => {
    let rootDir: string;
    let server: Server;
    let baseUrl: string;

    beforeEach(async () => {
        rootDir = await mkdtemp(path.join(tmpdir(), "othello-server-"));
        await writeFile(path.join(rootDir, "index.html"), "<html>hello</html>");
        await writeFile(path.join(rootDir, "app.css"), "body{}");

        server = createStaticServer({ staticDir: rootDir });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
    });

    afterEach(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(rootDir, { recursive: true, force: true });
    });

    it("静的ファイルを 200 で返す", async () => {
        const res = await fetch(`${baseUrl}/app.css`);

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8");
        expect(await res.text()).toBe("body{}");
    });

    it("ルートは index.html を返す", async () => {
        const res = await fetch(`${baseUrl}/`);

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("<html>hello</html>");
    });

    it("存在しないパスは 404 を返す", async () => {
        const res = await fetch(`${baseUrl}/no-such-file`);

        expect(res.status).toBe(404);
    });

    it("GET / HEAD 以外のメソッドは 405 を返す", async () => {
        const res = await fetch(`${baseUrl}/`, { method: "POST" });

        expect(res.status).toBe(405);
        expect(res.headers.get("allow")).toBe("GET, HEAD");
    });

    it("HEAD はボディ無しでヘッダのみ返す", async () => {
        const res = await fetch(`${baseUrl}/app.css`, { method: "HEAD" });

        expect(res.status).toBe(200);
        expect(res.headers.get("content-length")).toBe("6");
        expect(await res.text()).toBe("");
    });
});
