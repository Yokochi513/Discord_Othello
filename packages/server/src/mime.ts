/**
 * 拡張子から Content-Type を引くための対応表。
 *
 * `packages/client` のビルド成果物（Vite）で使われる拡張子を中心に持ち、
 * 未知の拡張子は呼び出し側で application/octet-stream として扱う。
 */

import path from "node:path";

/** 拡張子（小文字・ドット付き）から Content-Type への対応表 */
const MIME_TYPES: ReadonlyMap<string, string> = new Map([
    [".html", "text/html; charset=utf-8"],
    [".js", "text/javascript; charset=utf-8"],
    [".mjs", "text/javascript; charset=utf-8"],
    [".css", "text/css; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".svg", "image/svg+xml"],
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".gif", "image/gif"],
    [".webp", "image/webp"],
    [".ico", "image/x-icon"],
    [".woff", "font/woff"],
    [".woff2", "font/woff2"],
    [".txt", "text/plain; charset=utf-8"],
    [".map", "application/json; charset=utf-8"],
    [".wasm", "application/wasm"],
]);

/** 拡張子が対応表に無い場合の既定の Content-Type */
const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/**
 * ファイルパスの拡張子から Content-Type を求める。
 * @param filePath Content-Type を求めるファイルパス
 * @returns 対応する Content-Type。未知の拡張子は application/octet-stream
 */
export function lookupContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_TYPES.get(ext) ?? DEFAULT_CONTENT_TYPE;
}
