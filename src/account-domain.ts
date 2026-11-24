import type { DeviceTail } from "./types";

export type AccountTab =
  | "home"
  | "comments"
  | "posts"
  | "favorites"
  | "starred-posts"
  | "following"
  | "drafts"
  | "blacklist";
export interface AccountRow {
  id: number | string;
  title: string;
  text: string;
  date: string;
  image?: string;
  newsId?: number;
  postId?: number;
  userId?: number;
  deleted?: boolean;
  tail?: DeviceTail | string;
}
type Raw = Record<string, unknown>;
const object = (value: unknown): Raw =>
  value && typeof value === "object" ? (value as Raw) : {};
const string = (value: unknown): string =>
  typeof value === "string" ? value : "";
export function avatarUrl(id: number): string {
  if (!Number.isSafeInteger(id) || id < 1 || id > 999999999) return "";
  const digits = String(id).padStart(9, "0");
  return `https://avatar.ithome.com/avatars/${digits.slice(0, 3)}/${digits.slice(3, 5)}/${digits.slice(5, 7)}/${digits.slice(7)}_60.jpg`;
}
function textElements(value: unknown): string {
  return Array.isArray(value)
    ? value.map((item) => string(object(item).content)).join("")
    : "";
}
export function accountRows(kind: AccountTab | "replies", value: unknown): AccountRow[] {
  const data = object(value);
  const rows = Array.isArray(value) ? value : data.list;
  if (!Array.isArray(rows)) throw new Error("账号列表响应格式已变化");
  return rows
    .flatMap<AccountRow>((item) => {
      const row = object(item);
      if (kind === "favorites")
        return [
          {
            id: Number(row.newsId),
            newsId: Number(row.newsId),
            title: string(row.title),
            text: "",
            date: string(row.newsPostDate || row.favoritetime),
            image: string(row.thumbnail),
            deleted: row.isNewsDeleted === true,
          },
        ];
      if (kind === "blacklist")
        return [
          {
            id: Number(row.UserID),
            userId: Number(row.UserID),
            title: string(row.UserNick),
            text: `用户 ${Number(row.UserID)}`,
            date: string(row.AddTime),
            image: avatarUrl(Number(row.UserID)),
          },
        ];
      if (kind === "comments") {
        const comment = object(row.comment);
        const news = object(row.news);
        return [
          {
            id: Number(comment.id),
            newsId: Number(news.id),
            title: string(news.title),
            text: textElements(comment.elements),
            date: string(comment.postTime),
            tail: comment.deviceTailModel as DeviceTail | undefined,
          },
        ];
      }
      if (kind === "drafts")
        return [
          {
            id: `draft:${row.newsId}:${row.replyId}`,
            newsId: Number(row.newsId),
            title: `文章 ${Number(row.newsId)}${row.replyId ? ` · 回复 ${Number(row.replyId)}` : ""}`,
            text: string(row.body),
            date: row.updated
              ? new Date(Number(row.updated) * 1000).toISOString()
              : "",
          },
        ];
      if (kind === "following") {
        const user = object(row.user || row.userInfo || row.feedContent || row);
        return [
          {
            id: Number(user.id),
            userId: Number(user.id),
            title: string(user.userNick),
            text: "已关注",
            date: "",
            image: string(user.userAvatar),
          },
        ];
      }
      // Account post feeds contain both structural headers and actual posts.
      if (row.feedType !== undefined && row.feedType !== 2) return [];
      const post = object(row.feedContent || row);
      const pictures = Array.isArray(post.pictures) ? post.pictures : [];
      return [
        {
          id: Number(post.id),
          postId: kind === "replies" ? Number(post.contentId) || undefined : Number(post.id),
          title: string(post.title),
          text: textElements(post.contents),
          date: string(post.createTime),
          image: string(
            object(pictures[0]).thumbSrc || object(pictures[0]).src,
          ),
          tail: post.deviceTailModel as DeviceTail | undefined,
        },
      ];
    })
    .filter(
      (row) =>
        typeof row.id === "string" ||
        (Number.isSafeInteger(row.id) && row.id > 0),
    );
}
