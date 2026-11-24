import type { NewsItem, OfficialComment } from "./types.ts";

export function articleUrl(id: number): string {
  if (!Number.isSafeInteger(id) || id < 1 || id > 999999999)
    throw new Error("文章 ID 无效");
  const s = String(id).padStart(9, "0");
  return `https://www.ithome.com/${Number(s.slice(0, 3))}/${s.slice(3, 6)}/${s.slice(6)}.htm`;
}
export function articleId(raw: string): number | null {
  try {
    const url = new URL(raw, "https://www.ithome.com");
    if (!["www.ithome.com", "m.ithome.com"].includes(url.hostname)) return null;
    const pc = url.pathname.match(/^\/(\d{1,3})\/(\d{3})\/(\d{3})\.htm$/);
    const mobile = url.pathname.match(/^\/html\/(\d+)\.htm$/);
    const id = pc
      ? Number(pc.slice(1).join(""))
      : mobile
        ? Number(mobile[1])
        : null;
    return id && Number.isSafeInteger(id) && id <= 999999999 ? id : null;
  } catch {
    return null;
  }
}
export function mergeNews(
  current: NewsItem[],
  incoming: NewsItem[],
): NewsItem[] {
  const seen = new Set<number>();
  return [...current, ...incoming]
    .filter((item) => !seen.has(item.id) && !!seen.add(item.id))
    .slice(0, 500);
}
export function mergeComments(
  current: OfficialComment[],
  incoming: OfficialComment[],
): OfficialComment[] {
  const values = new Map(current.map((c) => [c.id, c]));
  for (const comment of incoming) values.set(comment.id, comment);
  return [...values.values()];
}
export function enrichCommentSources<T>(web: T, app: unknown): T {
  const sources = new Map<number, Record<string, unknown>>();
  function walk(value: unknown, apply: boolean) {
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, apply));
    } else if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      if (typeof object.id === "number") {
        if (apply) {
          const source = sources.get(object.id);
          if (source)
            for (const key of ["deviceTailModel", "tail", "tailClient", "pictures"])
              if (key in source) object[key] = source[key];
        } else sources.set(object.id, object);
      }
      for (const key of ["comments", "hotComments", "topComments", "children", "comment"])
        if (object[key]) walk(object[key], apply);
    }
  }
  walk(app, false);
  walk(web, true);
  return web;
}
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error)
    return String(error.message);
  return typeof error === "string" ? error : "操作未完成，请重试";
}

export function displayDate(raw: string, full = false): string {
  if (!raw) return "";
  const value = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : raw + "+08:00";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString(
    "zh-CN",
    full
      ? { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        },
  );
}
export function bytesLabel(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export function cursorFor(items: NewsItem[]): string | null {
  return items.filter((item) => !item.pinned).at(-1)?.orderDate || null;
}
