/**
 * クライアントの実行環境の解決。
 *
 * 要件定義 §16.2「設定は環境変数で外部化する」に従い Client ID を環境変数から読み、
 * あわせて Discord Activity の iframe 内で動作しているかを判定する。
 * DOM に触れずに済むよう、環境変数と URL はすべて引数で受け取る。
 */

/** loadClientConfig が読み取る環境変数の形 */
export type ClientEnv = {
    /** Discord アプリケーションの Client ID */
    readonly VITE_DISCORD_CLIENT_ID?: string | undefined;
};

/** クライアントの実行時設定 */
export type ClientConfig = {
    /** Discord アプリケーションの Client ID */
    readonly discordClientId: string;
    /** Discord Activity の iframe 内で動作しているか */
    readonly embedded: boolean;
};

/**
 * Discord Activity の iframe 内で動作しているかを判定する。
 * Discord は Activity の起動時に frame_id をクエリへ付与する。
 * instance_id は付かない場合があるため判定条件には含めない。
 * @param search location.search 相当の文字列
 * @returns iframe 内で動作していれば true
 */
export function isEmbedded(search: string): boolean {
    const frameId = new URLSearchParams(search).get("frame_id");
    return frameId !== null && frameId !== "";
}

/**
 * 環境変数と URL からクライアントの実行時設定を組み立てる。
 * @param env 読み込み元の環境変数
 * @param search location.search 相当の文字列
 * @returns クライアントの実行時設定
 */
export function loadClientConfig(env: ClientEnv, search: string): ClientConfig {
    const discordClientId = env.VITE_DISCORD_CLIENT_ID;
    if (discordClientId === undefined || discordClientId === "") {
        throw new Error(
            "VITE_DISCORD_CLIENT_ID が未設定です（.env に Discord アプリケーションの Client ID を設定してください）",
        );
    }

    return {
        discordClientId,
        embedded: isEmbedded(search),
    };
}
