/**
 * Discord OAuth2 のトークン交換とユーザー情報取得。
 *
 * client secret はサーバー側にのみ保持し、クライアントへは渡さない（要件定義 §13 / §15）。
 */

const DISCORD_API_BASE = "https://discord.com/api";

/** トークン交換に必要な Discord アプリケーションの資格情報 */
export type OAuthConfig = {
    readonly clientId: string;
    readonly clientSecret: string;
};

/** Discord の /oauth2/token の応答 */
export type DiscordTokenResponse = {
    readonly access_token: string;
    readonly token_type: string;
    readonly expires_in: number;
    readonly refresh_token: string;
    readonly scope: string;
};

/** Discord の /users/@me の応答（必要な項目のみ） */
export type DiscordUser = {
    readonly id: string;
    readonly username: string;
    readonly global_name: string | null;
};

/**
 * 認可コードをアクセストークンに交換する。
 * @param config client_id / client_secret
 * @param code クライアントが sdk.commands.authorize() で取得した認可コード
 * @returns Discord のトークンレスポンス
 */
export async function exchangeCodeForToken(
    config: OAuthConfig,
    code: string,
): Promise<DiscordTokenResponse> {
    const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "authorization_code",
        code,
    });

    const response = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });

    if (!response.ok) {
        throw new Error(`Discord のトークン交換に失敗しました（HTTP ${response.status}）`);
    }

    return (await response.json()) as DiscordTokenResponse;
}

/**
 * アクセストークンで Discord ユーザー情報を取得する。
 * @param accessToken exchangeCodeForToken で取得したアクセストークン
 * @returns Discord ユーザー情報（User ID・表示名。要件定義 §11.5）
 */
export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
    const response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
        throw new Error(`Discord のユーザー情報取得に失敗しました（HTTP ${response.status}）`);
    }

    return (await response.json()) as DiscordUser;
}
