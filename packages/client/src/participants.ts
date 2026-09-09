/**
 * Discord の参加者情報からアバターを解決する（要件定義 §7.2 / §11.5）。
 *
 * サーバーが保持するのは User ID と表示名だけなので、アバターはクライアントが
 * Discord SDK の参加者一覧から解決する。ここは SDK にも DOM にも依存しない変換だけを持ち、
 * SDK の呼び出しは useParticipants.ts が受け持つ。
 */

/** SDK の参加者一覧のうち、アバターの解決に使う項目。 */
export type SdkParticipant = {
    /** Discord User ID */
    readonly id: string;
    /** アバター画像のハッシュ。未設定なら null または undefined */
    readonly avatar?: string | null | undefined;
    /** 旧方式のタグ番号。新方式のアカウントでは "0" */
    readonly discriminator?: string | undefined;
};

/** User ID からアバター画像の URL を引く表。 */
export type AvatarMap = ReadonlyMap<string, string>;

// Discord の画像 CDN。iframe の CSP で画像の読み込みが許可されている
const CDN_ORIGIN = "https://cdn.discordapp.com";
// 表示は小さいため、転送量を抑えて最小サイズを要求する
const AVATAR_SIZE = 64;
// 既定アバターの種類数。新方式は 6 種、旧方式（タグ番号あり）は 5 種
const DEFAULT_AVATAR_COUNT = 6n;
const LEGACY_DEFAULT_AVATAR_COUNT = 5;

/**
 * 参加者のアバター画像の URL を求める。
 * アバターを設定していない参加者には Discord の既定アバターを充てる。
 * @param participant SDK が返した参加者
 * @returns アバター画像の URL
 */
export function resolveAvatarUrl(participant: SdkParticipant): string {
    const { id, avatar } = participant;
    if (avatar !== undefined && avatar !== null && avatar !== "") {
        return `${CDN_ORIGIN}/avatars/${id}/${avatar}.png?size=${AVATAR_SIZE}`;
    }
    return `${CDN_ORIGIN}/embed/avatars/${defaultAvatarIndex(participant)}.png`;
}

/**
 * 参加者一覧から User ID 引きのアバター表を作る。
 * @param participants SDK が返した参加者一覧
 * @returns User ID からアバター画像の URL を引く表
 */
export function buildAvatarMap(participants: readonly SdkParticipant[]): AvatarMap {
    return new Map(
        participants.map((participant) => [participant.id, resolveAvatarUrl(participant)]),
    );
}

/**
 * アバター画像を読み込めなかったときに代わりに出す 1 文字を求める。
 * @param displayName 参加者の表示名
 * @returns 表示名の先頭 1 文字。空の表示名なら "?"
 */
export function avatarInitial(displayName: string): string {
    // 絵文字などのサロゲートペアを割らないよう、コードポイント単位で先頭を取る
    const [first] = [...displayName.trim()];
    return first ?? "?";
}

// 既定アバターの番号。新方式は User ID から、旧方式はタグ番号から決まる（Discord の仕様）
function defaultAvatarIndex(participant: SdkParticipant): number {
    const { id, discriminator } = participant;
    if (discriminator !== undefined && discriminator !== "" && discriminator !== "0") {
        const tag = Number.parseInt(discriminator, 10);
        return Number.isNaN(tag) ? 0 : tag % LEGACY_DEFAULT_AVATAR_COUNT;
    }
    try {
        return Number((BigInt(id) >> 22n) % DEFAULT_AVATAR_COUNT);
    } catch {
        // 数値でない User ID は来ない想定だが、画面を落とさないよう既定へ寄せる
        return 0;
    }
}
