import { invoke, isTauri, convertFileSrc } from "@tauri-apps/api/core";
import type {
  Article,
  Bootstrap,
  Cached,
  CommentsPage,
  NewsItem,
  Profile,
  Settings,
  Stats,
} from "./types";
import { defaultSettings } from "./types";
import { articleUrl, enrichCommentSources } from "./domain";

export const native = isTauri();
type Raw = Record<string, unknown>;
const browserKey = "ithome-desktop-preview";
function localPreview(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(browserKey) || "{}");
  } catch {
    return {};
  }
}
function previewWrite(key: string, value: unknown): void {
  const state = localPreview();
  state[key] = value;
  localStorage.setItem(browserKey, JSON.stringify(state));
}
function mapNews(value: Raw): NewsItem {
  const id = Number(value.newsid);
  return {
    id,
    title: String(value.title || ""),
    date: String(value.postdate || ""),
    orderDate: String(value.orderdate || value.postdate || ""),
    summary: String(value.description || ""),
    image: String(value.image || ""),
    url: articleUrl(id),
    comments: Number(value.commentcount || 0),
    forbidComment: !!value.forbidcomment,
    advertisement: Number(value.aid || 0) > 0 || value.NewsTips === "广告",
    video: !!value.v && value.v !== "0",
  };
}
async function read(url: string, timeout?: number): Promise<Raw> {
  const response = await fetch(url, timeout ? { signal: AbortSignal.timeout(timeout) } : undefined);
  if (!response.ok) throw new Error(`网络请求失败（HTTP ${response.status}）`);
  return response.json();
}
function cached<T>(data: T): Cached<T> {
  return { data, savedAt: Date.now() / 1000, stale: false };
}
export const backend = {
  async badges(): Promise<{ comments: number; posts: number; messages: number }> {
    return native ? invoke("badge_counts") : { comments: 0, posts: 0, messages: 0 };
  },
  async noticeSync(): Promise<{ badges: { comments: number; posts: number; messages: number }; notificationError: string }> {
    const now = new Date();
    const date = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    return native ? invoke("notice_sync", { date }) : { badges: { comments: 0, posts: 0, messages: 0 }, notificationError: "" };
  },
  async testNotification(): Promise<void> {
    if (!native) throw new Error("请在桌面客户端测试 Windows 通知");
    return invoke("test_notification");
  },
  async messageRead(kind: "news-replies" | "circle-replies" | "conversation", id = 0): Promise<void> {
    if (!native) return;
    return invoke("message_read", { kind, id });
  },
  async messages<T>(kind: "conversations" | "unread" | "conversation" | "news-replies" | "circle-replies", id = 0, page = 1, cursor = 0, stamp = ""): Promise<T> {
    if (!native) throw new Error("请在桌面客户端登录后查看消息");
    return invoke("message_data", { kind, id, page, cursor, stamp });
  },
  async circleAction(kind: "post" | "reply" | "vote-post" | "vote-comment" | "favorite", id: number, reply = 0, topic = 0, body = "", enabled = true): Promise<Record<string, unknown>> {
    if (!native) throw new Error("请在桌面客户端登录后操作");
    return invoke("circle_action", { kind, id, reply, topic, body, enabled });
  },
  async deviceTail(mode: Settings["deviceTailMode"] = "official"): Promise<{ official: { deviceName?: string }; detectedModel?: string; submittedDevice?: string }> {
    if (!native) throw new Error("请在桌面客户端读取官方机型小尾巴");
    return invoke("device_tail", { mode });
  },
  async circleDraft(id: number, reply: number, topic: number): Promise<string> {
    if (!native) return "";
    return invoke("get_circle_draft", { id, reply, topic });
  },
  async saveCircleDraft(id: number, reply: number, topic: number, body: string, account: number): Promise<void> {
    if (!native) throw new Error("请在桌面客户端保存圈子草稿");
    return invoke("save_circle_draft", { id, reply, topic, body, account });
  },
  async user<T = Record<string, unknown>>(kind: "profile" | "comments" | "posts" | "replies", id: number, page = 1, cursor = 0): Promise<T> {
    if (!native) throw new Error("请在桌面客户端查看用户主页");
    return invoke("user_data", { kind, id, page, cursor });
  },
  async account<T = Record<string, unknown>>(kind: string, page = 1, cursor = 0): Promise<T> {
    if (!native) throw new Error("请在桌面客户端登录后读取官方账号内容");
    return invoke("account_data", { kind, page, cursor });
  },
  async accountAction(kind: "favorite-add" | "favorite-remove" | "block" | "unblock", id: number): Promise<void> {
    if (!native) throw new Error("请在桌面客户端登录后操作");
    return invoke("account_action", { kind, id });
  },
  async validate(): Promise<Profile> {
    if (!native) return { id: 0, nick: "" };
    return invoke("validate_session");
  },
  async bootstrap(): Promise<Bootstrap> {
    return native
      ? invoke("bootstrap")
      : {
          settings: { ...defaultSettings, ...(localPreview().settings as Partial<Settings>) },
          profile: { id: 0, nick: "" },
          channel: "preview",
          version: "0.1.6",
          warnings: [],
        };
  },
  async news(
    channel: string,
    cursor: string | null,
    refresh = false,
  ): Promise<Cached<NewsItem[]>> {
    if (native) return invoke("get_news", { channel, cursor, refresh });
    const data = await read(
      cursor
        ? `/__more/api/news/newslistpageget?${new URLSearchParams({ Tag: channel, ot: cursor, page: "1", hitCountAuthority: "false" })}`
        : `/__news/json/newslist/${channel}?r=${refresh ? Date.now() : 0}`,
    );
    const rows = data.newslist || data.Result;
    if (!Array.isArray(rows)) throw new Error("资讯响应格式已变化");
    const isArticle = (value: Raw) => Number.isSafeInteger(Number(value.newsid)) && Number(value.newsid) > 0 && Number(value.newsid) <= 999999999;
    const pinned = Array.isArray(data.toplist) ? data.toplist.filter(isArticle).map((value) => ({ ...mapNews(value), pinned: true })) : [];
    const seen = new Set<number>();
    return cached(
      [...pinned, ...rows
        .filter((v) => typeof v === "object" && v && "newsid" in v && isArticle(v))
        .map(mapNews)].filter((item) => !seen.has(item.id) && !!seen.add(item.id)),
    );
  },
  async deals(refresh = false): Promise<Cached<NewsItem[]>> {
    if (native) return invoke("get_deals", { refresh });
    const html = await fetch("/__page/").then((response) => {
      if (!response.ok) throw new Error(`网络请求失败（HTTP ${response.status}）`);
      return response.text();
    });
    const document = new DOMParser().parseFromString(html, "text/html");
    const seen = new Set<number>();
    const values: NewsItem[] = [];
    document
      .querySelectorAll<HTMLAnchorElement>('a[href*="lapin.ithome.com/html/"]')
      .forEach((anchor) => {
        const match = anchor.href.match(/\/(\d+)\.htm(?:$|[?#])/);
        const title = anchor.textContent?.trim() || "";
        if (!match || !title) return;
        const id = Number(match[1]);
        if (!id || seen.has(id)) return;
        seen.add(id);
        const image = anchor.parentElement?.querySelector<HTMLImageElement>(
          "img",
        );
        values.push({
          id,
          title,
          date: "",
          orderDate: "",
          summary: "",
          image: image?.dataset.src || image?.src || "",
          url: anchor.href,
          comments: 0,
          forbidComment: false,
        });
      });
    if (!values.length) throw new Error("好物页面未返回可识别内容");
    return cached(values);
  },
  async circle<T>(kind: import("./types").CircleKind, id = 0, page = 1, menu = 2000000002, stamp = "", refresh = false): Promise<Cached<T>> {
    if (native) return invoke("get_circle", { kind, id, page, menu, stamp, refresh });
    const query = new URLSearchParams({ page: String(page), pageSize: "20" });
    let path: string;
    if (kind === "latest" || kind === "recommend") {
      path = kind === "latest" ? "home/getnewmenufeeds" : "home/getrecommendedmenufeeds";
      query.set("pageId", kind === "latest" ? "2000000004" : "2000000002");
      query.set("flowType", "0"); query.set("menuId", String(menu));
      query.set("appver", "933"); query.set("rawappver", "9.33"); query.set("platform", "ithome_android");
    } else {
      query.set("appver", "799"); query.set("platform", "ithome_uwp");
      if (kind === "topic") {
        path = "topic/gettopicfeeds";
        query.set("topicId", String(id)); query.set("pid", "0"); query.set("menuId", "2000000002");
      } else if (kind === "comments") {
        path = "comment/getcomments";
        query.set("contentId", String(id)); query.set("current", String(page)); query.set("sortType", String(menu));
      } else if (kind === "floor") {
        path = "comment/getsinglefloorcomment";
        query.set("floorCommentId", String(id)); query.set("contentId", String(menu));
      } else { path = "content/getcontentdetail"; query.set("id", String(id)); }
    }
    if (stamp) query.set("stamp", stamp);
    const value = await read(`/__circle/api/${path}?${query}`);
    if (!value.success || !value.data) throw new Error(String(value.errorMessage || "圈子读取失败"));
    return cached(value.data as T);
  },
  async article(id: number, refresh = false): Promise<Cached<Article>> {
    if (native) return invoke("get_article", { id, refresh });
    const value = await read(`/__news/json/newscontent/${id}`);
    const page = await fetch(`/__page${new URL(articleUrl(id)).pathname}`).then(
      (r) => r.text(),
    );
    const sn =
      new DOMParser()
        .parseFromString(page, "text/html")
        .querySelector("#post_comm")
        ?.getAttribute("data-id") || "";
    const item = mapNews(value);
    const history = ((localPreview().history as NewsItem[]) || []).filter(
      (v) => v.id !== id,
    );
    previewWrite("history", [item, ...history].slice(0, 2000));
    return cached({
      item,
      html: String(value.detail || ""),
      author: String(value.newsauthor || ""),
      source: String(value.newssource || ""),
      sn,
    });
  },
  async comments(
    id: number,
    sn: string,
    cursor = 0,
    earliest = false,
  ): Promise<CommentsPage> {
    if (native) return invoke("get_comments", { id, cursor, earliest });
    const value = await read(
      `/__comments/api/webcomment/getnewscomment?${new URLSearchParams({ sn, cid: String(cursor), isInit: String(cursor === 0), appver: "900", ...(earliest ? { latest: "1" } : {}) })}`,
    );
    if (!value.success)
      throw new Error(String(value.message || "评论读取失败"));
    try {
      const source = await read(
        `/__appcomments/apiv2/comment/getnewscomment?${new URLSearchParams({ id: String(id), cid: String(cursor), appver: "933", ...(earliest ? { latest: "1" } : {}) })}`, 4000,
      );
      if (source.success) enrichCommentSources(value.content, source.content);
    } catch {
      // Device-source retrieval must not hide otherwise readable comments.
    }
    return value.content as CommentsPage;
  },
  async children(
    id: number,
    sn: string,
    comment: number,
  ): Promise<OfficialChildren> {
    if (native) return invoke("get_children", { id, comment });
    const value = await read(
      `/__comments/api/webcomment/getcommentcontent?${new URLSearchParams({ sn, commentId: String(comment), appver: "900" })}`,
    );
    if (!value.success)
      throw new Error(String(value.message || "回复读取失败"));
    try {
      const source = await read(
        `/__appcomments/apiv2/comment/getcommentcontent?${new URLSearchParams({ id: String(comment), appver: "933" })}`, 4000,
      );
      if (source.success) enrichCommentSources(value.content, source.content);
    } catch {
      // Preserve the web reply content when source metadata is unavailable.
    }
    return value.content as OfficialChildren;
  },
  async submit(
    id: number,
    reply: number,
    body: string,
  ): Promise<{ success: boolean; message?: string; content?: unknown }> {
    if (!native) throw new Error("请在桌面客户端登录后评论");
    return invoke("submit_comment", { id, reply, body });
  },
  async vote(id: number, cancel: boolean, type = 1): Promise<Raw> {
    if (!native) throw new Error("请在桌面客户端登录后操作");
    return invoke("vote_comment", { id, cancel, type });
  },
  async search(keyword: string): Promise<NewsItem[]> {
    if (!native) throw new Error("全站搜索需要在桌面客户端登录");
    return invoke("search_news", { keyword });
  },
  async items(kind: "favorite" | "history"): Promise<NewsItem[]> {
    return native
      ? invoke("local_items", { kind })
      : (localPreview()[
          kind === "favorite" ? "favorites" : "history"
        ] as NewsItem[]) || [];
  },
  async favorite(item: NewsItem, enabled: boolean): Promise<void> {
    if (native) return invoke("toggle_favorite", { item, enabled });
    const items = ((localPreview().favorites as NewsItem[]) || []).filter(
      (v) => v.id !== item.id,
    );
    previewWrite("favorites", enabled ? [item, ...items] : items);
  },
  async draft(id: number, reply: number): Promise<string> {
    return native
      ? invoke("get_draft", { id, reply })
      : String(localPreview()[`draft:${id}:${reply}`] || "");
  },
  async drafts(): Promise<{ newsId: number; replyId: number; body: string; updated: number }[]> {
    if (native) return invoke("get_drafts");
    return Object.entries(localPreview()).filter(([key, value]) => /^draft:\d+:\d+$/.test(key) && value).map(([key, value]) => {
      const [, news, reply] = key.split(":");
      return { newsId: Number(news), replyId: Number(reply), body: String(value), updated: 0 };
    });
  },
  async saveDraft(
    id: number,
    reply: number,
    body: string,
    account: number,
  ): Promise<void> {
    if (native) return invoke("save_draft", { id, reply, body, account });
    previewWrite(`draft:${id}:${reply}`, body);
  },
  async settings(settings: Settings): Promise<Settings> {
    if (native) return invoke("save_settings", { settings });
    previewWrite("settings", settings);
    return settings;
  },
  async resetSettings(): Promise<Settings> {
    if (native) return invoke("reset_settings");
    previewWrite("settings", defaultSettings);
    return defaultSettings;
  },
  async stats(): Promise<Stats> {
    if (native) return invoke("get_stats");
    return {
      cacheBytes: 0,
      historyCount: (await this.items("history")).length,
      favoritesCount: (await this.items("favorite")).length,
    };
  },
  async clear(kind: "cache" | "history" | "draft"): Promise<void> {
    if (native) return invoke("clear_data", { kind });
    if (kind === "history") previewWrite("history", []);
    if (kind === "draft") {
      const state = localPreview();
      for (const key of Object.keys(state)) {
        if (key.startsWith("draft:")) delete state[key];
      }
      localStorage.setItem(browserKey, JSON.stringify(state));
    }
  },
  async official(kind: string, id?: number, query?: string): Promise<void> {
    if (native)
      return invoke("open_official", {
        kind,
        id: id ?? null,
        query: query ?? null,
      });
    const links: Record<string, string> = {
      login: "https://www.ithome.com/user-login/index.htm",
      "login-wechat": "https://my.ruanmei.com/user-login/index.htm?forsid=https%3A%2F%2Fwww.ithome.com%2F&cliextra=ithome",
      "login-app": "https://my.ruanmei.com/user-login/index.htm?forsid=https%3A%2F%2Fwww.ithome.com%2F&cliextra=ithome",
      circle: "https://quan.ithome.com/",
      deals: "https://lapin.ithome.com/",
      profile: "https://my.ruanmei.com/",
      messages: "https://my.ruanmei.com/",
      mall: "https://mall.ithome.com/",
      assets: "https://m.ithome.com/fund/my?hidemenu=1",
      tasks: "https://img.ithome.com/app/newmy/apppage/user/signin.html?hidemenu=1",
      contributions: "https://img.ithome.com/app/commonlist/index.html?page=home&title=我的投稿&hidemenu=1",
      "edit-profile": "https://img.ithome.com/app/myprofiles/index.html?hidemenu=1",
      feedback: "https://img.ithome.com/app/errorfeedback/index.html?hidemenu=1",
    };
    const url =
      kind === "article" && id
        ? articleUrl(id)
        : kind === "search"
          ? `https://www.ithome.com/search/${encodeURIComponent(query || "")}.html`
          : links[kind];
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  },
  async sync(remember: boolean, id: number): Promise<Profile> {
    if (!native) throw new Error("请在桌面客户端同步登录");
    return invoke("sync_login", { remember, id });
  },
  async logout(): Promise<void> {
    if (native) return invoke("logout");
  },
  async external(url: string): Promise<void> {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol))
      throw new Error("只允许打开 HTTP/HTTPS 链接");
    if (native) return invoke("open_external", { url });
    window.open(url, "_blank", "noopener,noreferrer");
  },
  async image(url: string): Promise<string> {
    if (!native) return url;
    return convertFileSrc(await invoke<string>("cache_image", { url }));
  },
  async saveImage(url: string): Promise<boolean> {
    if (!native) {
      await this.external(url);
      return false;
    }
    return invoke("save_image", { url });
  },
};
type OfficialChildren =
  | import("./types").OfficialComment
  | import("./types").OfficialComment[];
