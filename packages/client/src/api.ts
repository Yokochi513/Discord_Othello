/**
 * サーバー API への到達経路の解決。
 *
 * 要件定義 §13 のとおり、Activity からの外部通信は Discord のプロキシ（`/.proxy/`）を
 * 経由する必要がある。アプリ内では常に `/api/...` という論理パスで API を指し、
 * 実際のリクエスト直前にここで実行環境に応じた経路へ変換する。
 */

import type { ClientConfig } from "./env.ts";

/** Discord のプロキシを示すパス接頭辞（要件定義 §13） */
const PROXY_PREFIX = "/.proxy";

/**
 * API の論理パスを、実行環境に応じた実際のリクエストパスへ変換する。
 * iframe 内では Discord のプロキシを経由させるため接頭辞を付ける。
 * 絶対 URL は組み立てず、開発サーバー・プロキシ・本番で同じコードが動くようにする。
 * @param path アプリ内の API パス（例: /api/token）
 * @param embedded Discord Activity の iframe 内で動作しているか
 * @returns fetch に渡すパス
 */
export function resolveApiPath(path: string, embedded: boolean): string {
    const normalized = normalizePath(path);
    if (!embedded) return normalized;
    if (normalized === PROXY_PREFIX || normalized.startsWith(`${PROXY_PREFIX}/`)) return normalized;
    return `${PROXY_PREFIX}${normalized}`;
}

/**
 * サーバー API へ GET し、応答を JSON として読み取る。
 * @param path アプリ内の API パス（例: /api/token）
 * @param config クライアントの実行時設定
 * @returns 応答の JSON
 */
export async function fetchApiJson<T>(path: string, config: ClientConfig): Promise<T> {
    const response = await fetch(resolveApiPath(path, config.embedded), {
        headers: { Accept: "application/json" },
    });

    if (!response.ok) {
        throw new Error(`API の呼び出しに失敗しました（HTTP ${response.status}）: ${path}`);
    }

    return (await response.json()) as T;
}

// 先頭のスラッシュを補い、連続するスラッシュを 1 つにまとめる
function normalizePath(path: string): string {
    const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
    return withLeadingSlash.replace(/\/{2,}/g, "/");
}
