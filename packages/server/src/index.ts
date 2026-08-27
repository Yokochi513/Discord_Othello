/**
 * オセロサーバーの起動エントリポイント。
 * 環境変数から設定を読み込み、静的ファイル配信サーバーを起動する。
 */

import { createStaticServer } from "./createServer.ts";
import { loadConfig } from "./env.ts";

const config = loadConfig();
const server = createStaticServer({ staticDir: config.staticDir });

server.listen(config.port, config.host, () => {
    console.log(
        `オセロサーバーを起動しました: http://${config.host}:${config.port} （静的配信: ${config.staticDir}）`,
    );
});

// systemd からの停止要求（Restart=always 環境下の再起動を含む）に応じて安全に終了する
function shutdown(signal: NodeJS.Signals): void {
    console.log(`${signal} を受信したため、サーバーを停止します`);
    server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
