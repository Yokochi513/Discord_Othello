/**
 * 静的ファイル配信サーバー。
 *
 * 本 Issue（M2-1）では `packages/client` のビルド成果物を配信する
 * 最小 HTTP サーバーのみを実装する。OAuth・WebSocket・REST API は
 * 後続 Issue で追加する（要件定義 §5.3）。
 */

import { createReadStream } from "node:fs";
import {
    createServer as createHttpServer,
    type IncomingMessage,
    type Server,
    type ServerResponse,
} from "node:http";

import { lookupContentType } from "./mime.ts";
import { resolveStaticFile } from "./staticFile.ts";

/** createStaticServer に渡す設定 */
export type StaticServerOptions = {
    /** 静的配信のルートディレクトリ（絶対パス） */
    readonly staticDir: string;
};

/**
 * 静的ファイル配信専用の HTTP サーバーを作る。
 * GET / HEAD のみを受け付け、それ以外のメソッドは 405 を返す。
 * @param options サーバーの設定
 * @returns 未 listen の http.Server
 */
export function createStaticServer(options: StaticServerOptions): Server {
    const { staticDir } = options;

    return createHttpServer((req, res) => {
        handleRequest(req, res, staticDir).catch((error: unknown) => {
            console.error("リクエスト処理中に例外が発生しました:", error);
            if (!res.headersSent) {
                res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            }
            res.end("Internal Server Error");
        });
    });
}

// 1 リクエストを処理する。メソッド判定 → 静的ファイル解決 → 応答の順で行う
async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    staticDir: string,
): Promise<void> {
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
        res.end("Method Not Allowed");
        return;
    }

    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const resolved = await resolveStaticFile(staticDir, pathname);

    if (resolved === null) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not Found");
        return;
    }

    res.writeHead(200, {
        "Content-Type": lookupContentType(resolved.filePath),
        "Content-Length": resolved.size,
    });

    if (req.method === "HEAD") {
        res.end();
        return;
    }

    await streamFile(resolved.filePath, res);
}

// ファイルをレスポンスへストリーミングする
function streamFile(filePath: string, res: ServerResponse): Promise<void> {
    return new Promise((resolve, reject) => {
        const stream = createReadStream(filePath);
        stream.on("error", reject);
        stream.on("close", resolve);
        stream.pipe(res);
    });
}
