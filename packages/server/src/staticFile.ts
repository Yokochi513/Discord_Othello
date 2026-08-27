/**
 * リクエストパスを静的配信ルート配下の実ファイルへ解決する。
 *
 * ルート外を指すパス（`..` によるディレクトリトラバーサル等）は必ず拒否する。
 * クライアントからの入力は信用しない（要件定義 §15）。
 */

import { promises as fs } from "node:fs";
import path from "node:path";

/** 解決できた静的ファイルの情報 */
export type ResolvedStaticFile = {
    /** 実ファイルの絶対パス */
    readonly filePath: string;
    /** ファイルサイズ（バイト） */
    readonly size: number;
};

/**
 * リクエストの URL パスを rootDir 配下の実ファイルへ解決する。
 * ディレクトリを指す場合は配下の index.html を探す。
 * @param rootDir 静的配信のルートディレクトリ（絶対パス）
 * @param urlPath リクエストの URL パス（クエリを除いた、デコード前のパス部分）
 * @returns 解決できた場合はファイル情報、できない・ルート外を指す場合は null
 */
export async function resolveStaticFile(
    rootDir: string,
    urlPath: string,
): Promise<ResolvedStaticFile | null> {
    const decodedPath = decodeUrlPath(urlPath);
    if (decodedPath === null) return null;

    const resolvedPath = path.resolve(rootDir, decodedPath.replace(/^[/\\]+/, ""));
    if (!isInsideRoot(rootDir, resolvedPath)) return null;

    return (
        (await statAsFile(resolvedPath)) ??
        (await statAsFile(path.join(resolvedPath, "index.html")))
    );
}

// パーセントエンコーディングを含む URL パスをデコードする。不正な場合は null
function decodeUrlPath(urlPath: string): string | null {
    try {
        return decodeURIComponent(urlPath);
    } catch {
        return null;
    }
}

// resolvedPath が rootDir 自身、またはその配下を指しているか判定する
function isInsideRoot(rootDir: string, resolvedPath: string): boolean {
    if (resolvedPath === rootDir) return true;
    const rootWithSep = rootDir.endsWith(path.sep) ? rootDir : rootDir + path.sep;
    return resolvedPath.startsWith(rootWithSep);
}

// filePath が通常ファイルであれば、その情報を返す。存在しない・ディレクトリ等なら null
async function statAsFile(filePath: string): Promise<ResolvedStaticFile | null> {
    try {
        const stat = await fs.stat(filePath);
        return stat.isFile() ? { filePath, size: stat.size } : null;
    } catch {
        return null;
    }
}
