import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** 開発時に API を中継する先（packages/server の既定ポート） */
const API_TARGET = "http://localhost:3000";

export default defineConfig({
    plugins: [react()],
    build: {
        // packages/server の STATIC_DIR 既定値（../../client/dist）と一致させる
        outDir: "dist",
        target: "es2022",
        sourcemap: true,
    },
    server: {
        // Discord の開発用 URL Mapping はトンネル経由で開発サーバーに到達するため、
        // 外部からの接続を受け付ける必要がある（要件定義 §16.1）
        host: true,
        port: 5173,
        strictPort: true,
        // https のトンネル越しに HMR を張るためのポート
        hmr: { clientPort: 443 },
        // Vite は未知のホスト名からの接続を拒否する。実際のサブドメインは #20 / #22 で確定させる
        allowedHosts: [".trycloudflare.com"],
        proxy: {
            // Discord のプロキシは "/.proxy" を剥がして転送するが、開発サーバーには
            // 付いたまま届くため、両方の形を server パッケージへ中継する
            "/api": { target: API_TARGET, changeOrigin: true },
            "/.proxy/api": {
                target: API_TARGET,
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/\.proxy/, ""),
            },
        },
    },
});
