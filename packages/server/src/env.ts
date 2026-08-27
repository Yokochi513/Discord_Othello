/**
 * 環境変数からのサーバー設定の読み込み。
 *
 * 要件定義 §16.2「設定（ポート、ドメイン、...）は環境変数で外部化する」に従い、
 * 待ち受けポート・アドレス・静的配信ディレクトリを process.env から解決する。
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/** サーバー起動時の設定 */
export type ServerConfig = {
    /** 待ち受けポート */
    readonly port: number;
    /** 待ち受けアドレス */
    readonly host: string;
    /** 静的配信のルートディレクトリ（絶対パス） */
    readonly staticDir: string;
};

/** PORT 未指定時のデフォルト値 */
const DEFAULT_PORT = 3000;

/** HOST 未指定時のデフォルト値。ラズパイ上のバインド対象は systemd / Tunnel 側の構成に委ねる */
const DEFAULT_HOST = "0.0.0.0";

/**
 * STATIC_DIR 未指定時のデフォルト値を求める。
 * このモジュール（packages/server/{src,dist}/env.*）からの相対位置で
 * packages/client/dist を指す。
 * @param moduleUrl 算出の基準とするモジュールの import.meta.url
 * @returns 静的配信ディレクトリの絶対パス
 */
function resolveDefaultStaticDir(moduleUrl: string): string {
    const moduleDir = path.dirname(fileURLToPath(moduleUrl));
    return path.resolve(moduleDir, "../../client/dist");
}

/**
 * PORT 環境変数を解釈する。
 * @param value PORT 環境変数の値
 * @returns 妥当なポート番号。未指定・空文字はデフォルト値
 */
function parsePort(value: string | undefined): number {
    if (value === undefined || value === "") return DEFAULT_PORT;

    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`PORT の値が不正です（1〜65535 の整数を指定してください）: ${value}`);
    }
    return port;
}

/**
 * 環境変数からサーバー設定を読み込む。
 * @param env 読み込み元の環境変数。省略時は process.env
 * @returns サーバー設定
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
    return {
        port: parsePort(env.PORT),
        host: env.HOST !== undefined && env.HOST !== "" ? env.HOST : DEFAULT_HOST,
        staticDir:
            env.STATIC_DIR !== undefined && env.STATIC_DIR !== ""
                ? path.resolve(env.STATIC_DIR)
                : resolveDefaultStaticDir(import.meta.url),
    };
}
