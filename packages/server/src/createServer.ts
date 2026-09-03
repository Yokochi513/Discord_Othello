/**
 * オセロサーバーの HTTP サーバー。
 *
 * `packages/client` のビルド成果物の静的配信に加え、Activity 向けの
 * OAuth2 トークン交換エンドポイント（`/api/token`）を提供する
 * （要件定義 §5.3 / §13 / §15）。同じ HTTP サーバー上で WebSocket も提供する。
 */

import { createReadStream } from "node:fs";
import {
    createServer as createHttpServer,
    type IncomingMessage,
    type Server,
    type ServerResponse,
} from "node:http";

import { lookupContentType } from "./mime.ts";
import { exchangeCodeForToken, fetchDiscordUser, type OAuthConfig } from "./oauth.ts";
import { resolveStaticFile } from "./staticFile.ts";
import {
    attachWebSocketServer,
    type WebSocketHub,
    type WebSocketOptions,
} from "./webSocket.ts";

/** createStaticServer に渡す設定 */
export type StaticServerOptions = {
    /** 静的配信のルートディレクトリ（絶対パス） */
    readonly staticDir: string;
    /** Discord OAuth2 のトークン交換に使う資格情報 */
    readonly oauth: OAuthConfig;
    /** WebSocket 認証・ログの差し替え（主にテスト用） */
    readonly websocket?: WebSocketOptions;
};

/** HTTP サーバーと、同じポートで動く WebSocket ルーム管理API。 */
export type OthelloServer = Server & { readonly webSocketHub: WebSocketHub };

/**
 * オセロサーバーの HTTP サーバーを作る。
 * `/api/token`（POST）以外は GET / HEAD のみを受け付け、それ以外のメソッドは 405 を返す。
 * @param options サーバーの設定
 * @returns 未 listen の http.Server
 */
export function createStaticServer(options: StaticServerOptions): OthelloServer {
    const { staticDir, oauth } = options;

    const server = createHttpServer((req, res) => {
        handleRequest(req, res, staticDir, oauth).catch((error: unknown) => {
            console.error("リクエスト処理中に例外が発生しました:", error);
            if (!res.headersSent) {
                res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            }
            res.end("Internal Server Error");
        });
    }) as OthelloServer;
    const webSocketHub = attachWebSocketServer(server, options.websocket);
    Object.defineProperty(server, "webSocketHub", { value: webSocketHub, enumerable: true });
    return server;
}

// 1 リクエストを処理する。/api/token → メソッド判定 → 静的ファイル解決 → 応答の順で行う
async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    staticDir: string,
    oauth: OAuthConfig,
): Promise<void> {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");

    if (pathname === "/api/token") {
        if (req.method !== "POST") {
            res.writeHead(405, { Allow: "POST", "Content-Type": "text/plain; charset=utf-8" });
            res.end("Method Not Allowed");
            return;
        }
        await handleTokenExchange(req, res, oauth);
        return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
        res.end("Method Not Allowed");
        return;
    }

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

// POST /api/token を処理する。認可コードをアクセストークンに交換し、
// クライアントには access_token のみ返す（client secret は返さない。要件定義 §15）
async function handleTokenExchange(
    req: IncomingMessage,
    res: ServerResponse,
    oauth: OAuthConfig,
): Promise<void> {
    let code: string;
    try {
        code = await readAuthorizationCode(req);
    } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: toMessage(error) }));
        return;
    }

    let token;
    try {
        token = await exchangeCodeForToken(oauth, code);
    } catch (error) {
        console.error("Discord のトークン交換に失敗しました:", error);
        res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "トークン交換に失敗しました" }));
        return;
    }

    try {
        const user = await fetchDiscordUser(token.access_token);
        console.log(`Discord ユーザーを認証しました: id=${user.id} username=${user.username}`);
    } catch (error) {
        // ユーザー情報のログ記録に失敗しても、クライアントは access_token で
        // sdk.commands.authenticate() を継続できるため致命的エラーにはしない
        console.error("Discord ユーザー情報の取得に失敗しました:", error);
    }

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ access_token: token.access_token }));
}

// リクエストボディの JSON から認可コード（code）を読み取る
async function readAuthorizationCode(req: IncomingMessage): Promise<string> {
    const rawBody = await readRequestBody(req);

    let parsed: unknown;
    try {
        parsed = JSON.parse(rawBody);
    } catch {
        throw new Error("リクエストボディが JSON として解釈できません");
    }

    const code = (parsed as { code?: unknown } | null)?.code;
    if (typeof code !== "string" || code === "") {
        throw new Error("code が指定されていません");
    }
    return code;
}

// リクエストボディを文字列として読み取る
function readRequestBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        req.on("error", reject);
    });
}

// 例外オブジェクトから応答用のメッセージを取り出す
function toMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
