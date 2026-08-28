/// <reference types="vite/client" />

/** Vite がビルド時に注入する環境変数（VITE_ 接頭辞のものだけがクライアントへ露出する） */
interface ImportMetaEnv {
    /** Discord アプリケーションの Client ID。公開値であり、secret ではない */
    readonly VITE_DISCORD_CLIENT_ID?: string;
}
