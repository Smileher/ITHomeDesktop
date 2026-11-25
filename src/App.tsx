import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Avatar,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  FluentProvider,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  Tooltip,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";
import {
  ArrowLeftRegular,
  ArrowSyncRegular,
  ArrowUpRightRegular,
  StarRegular,
  StarFilled,
  CheckmarkRegular,
  DismissRegular,
  HistoryRegular,
  NewsRegular,
  PersonRegular,
  SearchRegular,
  SettingsRegular,
  ShoppingBagRegular,
  ChatMultipleRegular,
  AlertRegular,
  WeatherMoonRegular,
  WeatherSunnyRegular,
  PanelLeftContractRegular,
  PanelLeftExpandRegular,
  CommentRegular,
  ZoomInRegular,
  ArrowDownloadRegular,
} from "@fluentui/react-icons";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { backend, native } from "./bridge";
import {
  articleId,
  bytesLabel,
  cursorFor,
  displayDate,
  errorText,
  mergeNews,
} from "./domain";
import { channels, defaultSettings } from "./types";
import type { Article, Cached, NewsItem, Profile, Settings } from "./types";
import CachedImage from "./components/CachedImage";
import { loadDisplayImage, releaseDisplayImage } from "./components/CachedImage";
import ArticleBody from "./components/ArticleBody";
import Comments from "./components/Comments";
import SettingsView from "./components/SettingsView";
import CircleView from "./components/CircleView";
import AccountCenter from "./components/AccountCenter";
import MessageCenter from "./components/MessageCenter";
import UserProfile from "./components/UserProfile";
import { avatarUrl } from "./account-domain";
import type { AccountTab } from "./account-domain";
import appLogo from "./assets/app.svg";

type View =
  | "news"
  | "history"
  | "settings"
  | "circle"
  | "deals"
  | "messages"
  | "profile";
const names: Record<View, string> = {
  news: "资讯",
  history: "浏览记录",
  settings: "设置",
  circle: "圈子",
  deals: "好物",
  messages: "消息",
  profile: "账号中心",
};

export default function App() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [systemDark, setSystemDark] = useState(
    matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [profile, setProfile] = useState<Profile>({ id: 0, nick: "" });
  const [channel, setChannel] = useState("news");
  const [buildChannel, setBuildChannel] = useState("standalone");
  const [version, setVersion] = useState("0.1.6");
  const [view, setView] = useState<View>("news");
  const [accountTab, setAccountTab] = useState<AccountTab>("home");
  const [userTarget, setUserTarget] = useState<{ id: number; name: string } | null>(null);
  const [circleTarget, setCircleTarget] = useState(0);
  const [blockedIds, setBlockedIds] = useState(new Set<number>());
  const [blacklistKey, setBlacklistKey] = useState(0);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [article, setArticle] = useState<Cached<Article> | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [officialFavoriteIds, setOfficialFavoriteIds] = useState(new Set<number>());
  const [favoritesReady, setFavoritesReady] = useState(false);
  const [favoritesRefresh, setFavoritesRefresh] = useState(0);
  const [unreadBadges, setUnreadBadges] = useState({ comments: 0, posts: 0, messages: 0 });
  const [notificationStatus, setNotificationStatus] = useState("");
  const [messageTab, setMessageTab] = useState<"conversations" | "news-replies" | "circle-replies">("conversations");
  const markViewed = useCallback((kind: "news-replies" | "circle-replies" | "conversation") => {
    setUnreadBadges((value) => ({ ...value, ...(kind === "news-replies" ? { comments: 0 } : kind === "circle-replies" ? { posts: 0 } : {}) }));
  }, []);
  const [loading, setLoading] = useState(true);
  const [articleLoading, setArticleLoading] = useState(false);
  const [cloudSaving, setCloudSaving] = useState(false);
  const [more, setMore] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("正在连接 IT之家…");
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [ready, setReady] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState("");
  const [login, setLogin] = useState(false);
  const [loginOpened, setLoginOpened] = useState(false);
  const [remember, setRemember] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const syncInFlight = useRef(false);
  const [loginError, setLoginError] = useState("");
  const [commentsKey, setCommentsKey] = useState(0);
  const [commentComposeRequest, setCommentComposeRequest] = useState({ id: 0, sequence: 0 });
  const [inComments, setInComments] = useState(false);
  const [liveCommentCount, setLiveCommentCount] = useState({ id: 0, count: 0 });
  const updateCommentCount = useCallback((id: number, count: number) => setLiveCommentCount((old) => old.id === id && old.count === count ? old : { id, count }), []);
  const [image, setImage] = useState<{
    source: string;
    display: string;
  } | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [zoom, setZoom] = useState(false);
  const imageGeneration = useRef(0);
  const viewerImage = useRef("");
  const [listWidth, setListWidth] = useState(360);
  const draggingSplit = useRef(false);
  const [confirm, setConfirm] = useState<{
    title: string;
    action: () => Promise<void>;
  } | null>(null);
  const feedGeneration = useRef(0);
  const articleGeneration = useRef(0);
  const selectedRef = useRef(selected);
  const readerCleared = useRef(false);
  selectedRef.current = selected;
  const flush = useRef<() => Promise<void>>(async () => {});
  const settingsQueue = useRef<Promise<unknown>>(Promise.resolve());
  const settingsGeneration = useRef(0);
  const articleScroll = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<number, number>());
  const searchInput = useRef<HTMLInputElement>(null);
  const closing = useRef(false);
  const registerFlush = useCallback((value: () => Promise<void>) => {
    flush.current = value;
  }, []);
  const notificationOpen = useRef<(target: string) => void>(() => {});
  notificationOpen.current = (target) => {
    if (/^news:\d+$/.test(target)) { void navigate("news").then(() => openArticle(Number(target.slice(5)))); }
    else {
      const tab = target.slice(9);
      if (["conversations", "news-replies", "circle-replies"].includes(tab)) setMessageTab(tab as typeof messageTab);
      void navigate("messages");
    }
  };
  const dark =
    settings.theme === "dark" || (settings.theme === "system" && systemDark);
  const showError = useCallback((text: string) => setError(text), []);
  const openLogin = useCallback(() => {
    setLogin(true);
    setLoginOpened(false);
    setLoginError("");
  }, []);
  const loginSync = useRef<() => Promise<void>>(async () => {});
  loginSync.current = syncLogin;
  useEffect(() => {
    if (!native || !loginOpened) return;
    const subscription = listen("official-login-ready", () => { void loginSync.current(); });
    return () => { void subscription.then((unlisten) => unlisten()); };
  }, [loginOpened]);
  const closeImage = useCallback(() => {
    imageGeneration.current += 1;
    releaseDisplayImage(viewerImage.current);
    viewerImage.current = "";
    setImage(null);
    setImageLoading(false);
    setImageError(false);
    setZoom(false);
  }, []);
  const showImage = useCallback((source: string, display = source) => {
    const token = ++imageGeneration.current;
    releaseDisplayImage(viewerImage.current);
    viewerImage.current = "";
    const normalized = source.startsWith("//") ? `https:${source}` : source;
    setImage({ source: normalized, display });
    setImageLoading(display === normalized);
    setImageError(false);
    setZoom(false);
    {
      void loadDisplayImage(normalized)
        .then((value) => {
          if (token !== imageGeneration.current) {
            releaseDisplayImage(value);
            return;
          }
          viewerImage.current = value;
          setImage((current) =>
            token === imageGeneration.current && current?.source === normalized
              ? { source: normalized, display: value }
              : current,
          );
        })
        .catch(() => {})
        .finally(() => {
          if (token === imageGeneration.current) setImageLoading(false);
        });
    }
  }, []);

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id: number; name: string }>).detail;
      if (Number.isSafeInteger(detail.id) && detail.id > 0) setUserTarget(detail);
    };
    window.addEventListener("ithome-user", handler);
    return () => window.removeEventListener("ithome-user", handler);
  }, []);
  useEffect(() => {
    let live = true;
    setOfficialFavoriteIds(new Set());
    setFavoritesReady(false);
    if (profile.id) void (async () => {
      const ids = new Set<number>();
      // Retain only IDs, not account payloads/thumbnails. Do not infer absence from page one.
      for (let page = 1; live && page <= 500; page += 1) {
        const rows = await backend.account<{ newsId: number }[]>("favorites", page);
        if (!live) return;
        const before = ids.size;
        rows.forEach((row) => ids.add(row.newsId));
        if (rows.length < 20 || ids.size === before) {
          setOfficialFavoriteIds(ids);
          setFavoritesReady(true);
          return;
        }
      }
      if (live) setStatus("收藏数量较多，请在收藏页面核对状态");
    })().catch(() => { if (live) setStatus("收藏状态暂未同步，可在账号中心刷新收藏列表"); });
    return () => { live = false; };
  }, [profile.id, favoritesRefresh]);
  useEffect(() => {
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);
  useEffect(() => {
    let live = true;
    setBlockedIds(new Set());
    if (profile.id) void backend.account<{ UserID: number }[]>("blacklist").then((rows) => {
      if (live) setBlockedIds(new Set(rows.map((row) => row.UserID)));
    }).catch(() => { if (live) setStatus("黑名单暂未同步，可在账号中心重试"); });
    return () => { live = false; };
  }, [profile.id, blacklistKey]);
  useEffect(() => {
    if (!ready) return;
    setUnreadBadges({ comments: 0, posts: 0, messages: 0 });
    let live = true;
    let busy = false;
    const sync = async () => {
      if (busy) return;
      busy = true;
      try {
        const value = await backend.noticeSync();
        if (!live) return;
        setUnreadBadges(value.badges);
        setNotificationStatus(value.notificationError || (settingsRef.current.notificationsEnabled ? "运行期间约每两分钟同步；首次开启不推送历史内容" : "通知已关闭，未读红点仍会同步"));
      } catch (e) { if (live) setNotificationStatus(errorText(e)); }
      finally { busy = false; }
    };
    void sync();
    const timer = setInterval(() => void sync(), 120_000);
    window.addEventListener("focus", sync);
    return () => { live = false; clearInterval(timer); window.removeEventListener("focus", sync); };
  }, [ready, profile.id, settings.notificationsEnabled, settings.notifyNews, settings.notifyReplies, settings.notifyMessages]);
  useEffect(() => {
    if (!native) return;
    const subscription = listen<string>("notification-open", (event) => {
      notificationOpen.current(event.payload);
    });
    return () => { void subscription.then((unlisten) => unlisten()); };
  }, []);
  useEffect(() => {
    const preventShortcuts = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (
        key === "f12" ||
        (event.ctrlKey && ["u", "s"].includes(key)) ||
        (event.ctrlKey && event.shiftKey && ["i", "j", "c"].includes(key))
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const preventContext = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("keydown", preventShortcuts, true);
    window.addEventListener("contextmenu", preventContext, true);
    return () => {
      window.removeEventListener("keydown", preventShortcuts, true);
      window.removeEventListener("contextmenu", preventContext, true);
    };
  }, []);
  useEffect(() => {
    let live = true;
    void backend
      .bootstrap()
      .then((value) => {
        if (!live) return;
        setSettings(value.settings);
        settingsRef.current = value.settings;
        setRemember(value.settings.rememberLogin);
        setProfile(value.profile);
        setBuildChannel(value.channel);
        setVersion(value.version);
        if (value.warnings.length) setError(value.warnings.join("；"));
        setReady(true);
        if (value.profile.id && value.settings.validateSessionOnStart) {
          void backend.validate().then((profile) => { if (live) setProfile(profile); })
            .catch((e) => { if (live) setStatus(`登录验证暂未完成 · ${errorText(e)}`); });
        }
      })
      .catch((e) => {
        if (live) {
          setError(errorText(e));
          setReady(true);
        }
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (!native) return;
    let dispose: (() => void) | undefined;
    let live = true;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (closing.current) return;
        closing.current = true;
        try {
          await flush.current();
          await settingsQueue.current;
          await getCurrentWindow().destroy();
        } catch (e) {
          setError("关闭前保存失败：" + errorText(e));
          closing.current = false;
        }
      })
      .then((fn) => {
        if (live) dispose = fn;
        else fn();
      });
    return () => {
      live = false;
      dispose?.();
    };
  }, []);

  async function openArticle(id: number) {
    try {
      await flush.current();
    } catch (e) {
      setError(errorText(e));
      return;
    }
    if (selectedRef.current === id && article) {
      articleGeneration.current += 1;
      setSelected(null);
      selectedRef.current = null;
      setArticle(null);
      setArticleLoading(false);
      return;
    }
    if (selectedRef.current && articleScroll.current)
      positions.current.set(
        selectedRef.current,
        articleScroll.current.scrollTop,
      );
    const token = ++articleGeneration.current;
    setSelected(id);
    selectedRef.current = id;
    setArticleLoading(true);
    setError("");
    try {
      const value = await backend.article(id);
      if (token !== articleGeneration.current) return;
      setArticle(value);
      requestAnimationFrame(() => {
        if (articleScroll.current)
          articleScroll.current.scrollTop = positions.current.get(id) || 0;
      });
      setStatus(
        value.stale
          ? "离线缓存 · " +
              new Date(value.savedAt * 1000).toLocaleString("zh-CN")
          : "文章已缓存",
      );
    } catch (e) {
      if (token === articleGeneration.current) {
        setError(errorText(e));
        setArticle(null);
      }
    } finally {
      if (token === articleGeneration.current) setArticleLoading(false);
    }
  }
  async function loadFeed(append = false, refresh = false) {
    const token = ++feedGeneration.current;
    setLoading(true);
    setError("");
    try {
      let values: NewsItem[];
      let offline = false;
      if (view === "history") {
        values = await backend.items(view);
        setMore(false);
      } else if (view === "deals") {
        const response = await backend.deals(refresh);
        values = response.data;
        offline = response.stale;
        setMore(false);
      } else {
        const cursor = append ? cursorFor(items) : null;
        const response = await backend.news(channel, cursor, refresh);
        values = response.data;
        offline = response.stale;
        setMore(
          values.length > 0 &&
            !(
              append &&
              values.every((item) => items.some((old) => old.id === item.id))
            ),
        );
      }
      if (token !== feedGeneration.current) return;
      setItems((current) => (append ? mergeNews(current, values) : values));
      setStatus(
        offline
          ? "离线资讯 · 已显示上次缓存"
          : `已更新 · ${values.length} 条资讯`,
      );
      if (
        !append &&
        !selectedRef.current &&
        !readerCleared.current &&
        settingsRef.current.autoOpenArticle &&
        values.length &&
        window.innerWidth >= 900
      )
        void openArticle((values.find((item) => !item.pinned && !item.advertisement) || values[0]).id);
    } catch (e) {
      if (token === feedGeneration.current) setError(errorText(e));
    } finally {
      if (token === feedGeneration.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (!ready) return;
    if (["news", "history", "deals"].includes(view)) {
      setItems([]);
      setQuery("");
      void loadFeed();
    } else {
      feedGeneration.current += 1;
      setLoading(false);
    }
    return () => {
      feedGeneration.current += 1;
    };
  }, [ready, view, channel]);
  async function navigate(next: View) {
    try {
      await flush.current();
      if (next === "news" && view === "news") {
        readerCleared.current = true;
        articleGeneration.current += 1;
        setSelected(null);
        selectedRef.current = null;
        setArticle(null);
        setArticleLoading(false);
      }
      setView(next);
      setFocused(false);
      setError("");
      if (
        window.innerWidth <= 600 &&
        ["news", "history", "deals"].includes(next)
      ) {
        setSelected(null);
        selectedRef.current = null;
      }
      if (!["news", "history", "deals"].includes(next))
        setQuery("");
      if (!["news", "history", "deals"].includes(next)) {
        articleGeneration.current += 1;
        setSelected(null);
        selectedRef.current = null;
        setArticle(null);
        setArticleLoading(false);
      }
    } catch (e) {
      setError(errorText(e));
    }
  }
  function patchSettings(patch: Partial<Settings>) {
    const generation = ++settingsGeneration.current;
    const candidate = { ...settingsRef.current, ...patch };
    settingsRef.current = candidate;
    setSettings(candidate);
    setSettingsStatus("正在保存…");
    const task = settingsQueue.current
      .catch(() => {})
      .then(async () => {
        const saved = await backend.settings(candidate);
        settingsRef.current = saved;
        setSettings(saved);
        if (generation === settingsGeneration.current)
          setSettingsStatus("设置已保存");
      });
    settingsQueue.current = task;
    void task.catch((e) => {
      setSettingsStatus("保存失败");
      setError(errorText(e));
    });
  }
  async function resetSettings() {
    const task = settingsQueue.current
      .catch(() => {})
      .then(async () => {
        const value = await backend.resetSettings();
        settingsRef.current = value;
        setSettings(value);
        setSettingsStatus("已恢复默认设置，原配置已备份");
      });
    settingsQueue.current = task;
    await task;
  }
  async function toggleOfficialFavorite() {
    if (!article) return;
    const id = article.data.item.id;
    const enabled = !officialFavoriteIds.has(id);
    if (!profile.id) {
      openLogin();
      return;
    }
    try {
      setCloudSaving(true);
      await backend.accountAction(enabled ? "favorite-add" : "favorite-remove", id);
      setOfficialFavoriteIds((current) => {
        const next = new Set(current);
        if (enabled) next.add(id); else next.delete(id);
        return next;
      });
      setStatus(enabled ? "已加入收藏" : "已取消收藏");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setCloudSaving(false);
    }
  }
  async function search() {
    const keyword = query.trim();
    if (!keyword) return;
    const id = articleId(keyword);
    if (id) {
      await openArticle(id);
      return;
    }
    const token = ++feedGeneration.current;
    setLoading(true);
    try {
      const values = await backend.search(keyword);
      if (token !== feedGeneration.current) return;
      setItems(values);
      setMore(false);
      setStatus(`搜索“${keyword}” · ${values.length} 条结果`);
    } catch (e) {
      if (token === feedGeneration.current) setError(errorText(e));
    } finally {
      if (token === feedGeneration.current) setLoading(false);
    }
  }
  async function syncLogin() {
    if (syncInFlight.current) return;
    syncInFlight.current = true;
    setSyncing(true);
    setLoginError("");
    try {
      await flush.current();
      const id =
        article?.data.item.id ||
        items[0]?.id ||
        (await backend.news("news", null)).data[0]?.id;
      if (!id) throw new Error("暂时无法读取资讯，请恢复网络后同步登录");
      const value = await backend.sync(remember, id);
      setProfile(value);
      setLogin(false);
      setLoginOpened(false);
      setCommentsKey((v) => v + 1);
      setSettings((current) => ({ ...current, rememberLogin: remember }));
      setStatus("已登录 " + value.nick);
    } catch (e) {
      setLoginError(errorText(e));
    } finally {
      setSyncing(false);
      syncInFlight.current = false;
    }
  }
  async function logout() {
    await flush.current();
    await backend.logout();
    setProfile({ id: 0, nick: "" });
    setCommentsKey((v) => v + 1);
    setStatus("已退出登录");
  }
  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const keyword = query.toLocaleLowerCase();
    return items.filter((item) =>
      item.title.toLocaleLowerCase().includes(keyword),
    );
  }, [items, query]);
  const officialView = ["messages", "profile"].includes(
    view,
  );
  const selectedFavorite = article && officialFavoriteIds.has(article.data.item.id);
  const articleForComments = useMemo(() => {
    if (!article) return null;
    const feedCount = items.find((item) => item.id === article.data.item.id)?.comments || 0;
    return { ...article.data, item: { ...article.data.item, comments: liveCommentCount.id === article.data.item.id ? liveCommentCount.count : Math.max(article.data.item.comments, feedCount) } };
  }, [article, items, liveCommentCount]);
  const theme = useMemo(
    () => ({
      ...(dark ? webDarkTheme : webLightTheme),
      fontFamilyBase: settings.uiFont === "system" ? webLightTheme.fontFamilyBase : `"${settings.uiFont}", sans-serif`,
      colorBrandBackground: dark ? "#d6535b" : "#bd2530",
      colorBrandBackgroundHover: dark ? "#df6971" : "#a71f29",
      colorBrandBackgroundPressed: "#8e1923",
      colorBrandForeground1: dark ? "#ff949b" : "#b3222d",
      colorBrandForegroundLink: dark ? "#ff949b" : "#b3222d",
      colorBrandStroke1: dark ? "#ff949b" : "#bd2530",
      colorNeutralForeground2BrandHover: dark ? "#ff7890" : "#f42548",
      colorNeutralForeground2BrandPressed: dark ? "#ff7890" : "#f42548",
      colorNeutralForeground2BrandSelected: dark ? "#ff7890" : "#f42548",
    }),
    [dark, settings.uiFont],
  );

  return (
    <FluentProvider
      theme={theme}
      className={`theme-root ${dark ? "theme-dark" : ""}`}
    >
      <div
      className={`app ${dark ? "dark" : "light"} ${settings.compact ? "compact" : ""} ${selected ? "has-article" : ""} ${focused ? "focus-reading" : ""} ${settings.articleImages ? "" : "hide-article-images"} ${settings.showCommentComposer ? "" : "hide-composer"} ${settings.pinnedCard ? "pinned-cards" : ""} ${settings.circleGrid ? "" : "circle-large-images"}`}
        style={
        { "--reader-font": `${settings.fontSize}px`, "--reader-line-height": settings.lineHeight,
          "--feed-width": `${listWidth}px`,
          "--ui-font": settings.uiFont === "system" ? '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif' : `"${settings.uiFont}", sans-serif`,
          "--body-font": settings.bodyFont === "system" ? "inherit" : `"${settings.bodyFont}", serif`,
        } as React.CSSProperties
      }
    >
      <header className="topbar">
        <div className="brand">
          <img src={appLogo} alt="" />
          <div>
            <strong>IT之家第三方客户端</strong>
            <span>非官方 · 科技与生活</span>
          </div>
        </div>
        <form
          className="global-search"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <Input
            ref={searchInput}
            contentBefore={<SearchRegular />}
            contentAfter={<kbd>Ctrl K</kbd>}
            value={query}
            onChange={(_, data) => setQuery(data.value)}
            placeholder="搜索资讯，或粘贴文章链接"
            aria-label="搜索资讯"
          />
          <Button type="submit" appearance="subtle">
            搜索
          </Button>
        </form>
        <div className="top-actions">
          <Tooltip
            content={dark ? "切换浅色" : "切换深色"}
            relationship="label"
          >
            <Button
              appearance="subtle"
              icon={dark ? <WeatherSunnyRegular /> : <WeatherMoonRegular />}
              onClick={() => patchSettings({ theme: dark ? "light" : "dark" })}
            />
          </Tooltip>
          <Button
            className="account-button"
            appearance="subtle"
            icon={<PersonRegular />}
            onClick={() =>
              profile.id ? void navigate("profile") : openLogin()
            }
          >
            {profile.nick || "登录"}
          </Button>
        </div>
      </header>
      {error && (
        <MessageBar intent="error" className="error-bar">
          <MessageBarBody>
            <MessageBarTitle>操作未完成</MessageBarTitle>
            {error}
          </MessageBarBody>
          <Button
            appearance="subtle"
            icon={<DismissRegular />}
            aria-label="关闭错误提示"
            onClick={() => setError("")}
          />
        </MessageBar>
      )}
      <div className="workspace">
        <aside className="sidebar">
          <nav aria-label="主导航">
            {(
              [
                { id: "news", icon: <NewsRegular /> },
                { id: "circle", icon: <ChatMultipleRegular /> },
                { id: "deals", icon: <ShoppingBagRegular /> },
                { id: "messages", icon: <AlertRegular /> },
              ] as const
            ).map((item) => (
              <Button
                key={item.id}
                appearance="subtle"
                className={view === item.id ? "nav-active" : ""}
                icon={item.icon}
                onClick={() => { if (item.id === "circle") setCircleTarget(0); void navigate(item.id); }}
              >
                {names[item.id]}{item.id === "messages" && unreadBadges.messages > 0 && <i className="nav-unread-dot" aria-hidden="true" title={`${unreadBadges.messages} 条未读消息`} />}
              </Button>
            ))}
            <span className="nav-label">我的内容</span>
            <Button
              appearance="subtle"
              className={view === "history" ? "nav-active" : ""}
              icon={<HistoryRegular />}
              onClick={() => void navigate("history")}
            >
              浏览记录
            </Button>
          </nav>
          <div className="sidebar-bottom">
            <Button
              appearance="subtle"
              aria-label="我的"
              className={
                ["profile", "history", "settings"].includes(view)
                  ? "profile-nav-active"
                  : ""
              }
              onClick={() => void navigate("profile")}
            >
              <span className="mobile-my-icon">
                <PersonRegular />
              </span>
              <Avatar name={profile.nick || "家友"} image={profile.id ? { src: avatarUrl(profile.id) } : undefined} size={28} />
              <span>{profile.nick || "登录账号"}</span>
            </Button>
            <Button
              appearance="subtle"
              className={view === "settings" ? "nav-active" : ""}
              icon={<SettingsRegular />}
              onClick={() => void navigate("settings")}
            >
              设置
            </Button>
          </div>
        </aside>
        {!officialView && view !== "settings" && view !== "circle" && (
          <section className="feed-pane" aria-label={names[view]}>
            <div className="feed-heading">
              <h1>{view === "news" ? "今日资讯" : names[view]}</h1>
              <Tooltip content="刷新列表" relationship="label">
                <Button
                  appearance="subtle"
                  icon={<ArrowSyncRegular />}
                  onClick={() => void loadFeed(false, true)}
                  disabled={loading}
                />
              </Tooltip>
            </div>
            {view === "news" && (
              <div
                className="channel-tabs"
                role="tablist"
                aria-label="资讯频道"
              >
                {channels.map((c) => (
                  <button
                    key={c.id}
                    role="tab"
                    aria-selected={channel === c.id}
                    onClick={() => setChannel(c.id)}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
            <div className="feed-caption">
              <CheckmarkRegular />
              {view === "history"
                  ? "继续上次的阅读"
                  : view === "deals"
                    ? "IT之家首页公开推荐的好物与优惠"
                    : "与你一起，发现科技新鲜事"}
            </div>
            <div className="feed-scroll">
              {loading && !items.length ? (
                <div className="loading-center">
                  <Spinner size="small" label="正在获取资讯" />
                </div>
              ) : (
                <>
                  {filtered
                    .map((item) => (
                  <button
                    key={item.id}
                    data-news-id={item.id}
                    className={`news-row ${item.id === selected ? "selected" : ""} ${item.pinned ? "pinned" : ""}`}
                    onClick={() => void openArticle(item.id)}
                    aria-pressed={item.id === selected}
                  >
                    {settings.showImages && item.image && (
                      <CachedImage
                        src={item.image}
                        alt=""
                        className="news-thumb"
                      />
                    )}
                    <span className="news-row-title">{item.title}</span>
                    <span className="news-row-meta">
                      {item.pinned && <span className="news-badge pinned">置顶</span>}
                      {item.advertisement && <span className="news-badge advertisement">广告</span>}
                      {item.video && <span className="news-badge video">视频</span>}
                      <span>{displayDate(item.date)}</span>
                      <span className="push-right">
                        {item.comments > 0 ? `${item.comments} 评` : ""}
                      </span>
                    </span>
                  </button>
                    ))}
                </>
              )}
              {!loading && !filtered.length && (
                <div className="empty-state small">
                  <SearchRegular />
                  <p>
                    {query
                      ? "当前列表没有匹配项，可按回车全站搜索。"
                      : view === "history"
                          ? "读过的文章会出现在这里。"
                          : "暂时没有可显示的资讯。"}
                  </p>
                  <Button onClick={() => void loadFeed(false, true)}>
                    重新加载
                  </Button>
                </div>
              )}
              {view === "news" &&
                more &&
                !query &&
                items.length > 0 &&
                items.length < 500 && (
                  <Button
                    className="load-more"
                    appearance="subtle"
                    onClick={() => void loadFeed(true)}
                    disabled={loading}
                  >
                    {loading ? "正在加载…" : "加载更多"}
                  </Button>
                )}
            </div>
          </section>
        )}
          <button
            className="splitter"
            type="button"
            aria-label="拖动调整资讯列表宽度"
            onPointerDown={(event) => {
              draggingSplit.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!draggingSplit.current) return;
              setListWidth(Math.max(280, Math.min(560, window.innerWidth - 480, event.clientX - (document.querySelector(".sidebar")?.getBoundingClientRect().width || 80))));
            }}
            onPointerUp={() => { draggingSplit.current = false; }}
            onPointerCancel={() => { draggingSplit.current = false; }}
          />
        <main className="detail-pane" ref={articleScroll}>

          {view === "circle" ? <CircleView key={profile.id} onImage={showImage} initialId={circleTarget} blockedIds={blockedIds} profile={profile} readOnly={settings.readOnly} onLogin={openLogin} registerFlush={registerFlush} /> : view === "profile" ? (
            <AccountCenter profile={profile} tab={accountTab} onTab={setAccountTab} onLogin={openLogin}
              onLogout={() => setConfirm({ title: "退出当前账号？已保存的草稿会按账号保留。", action: logout })}
              onSettings={() => void navigate("settings")}
              readOnly={settings.readOnly}
              onConfirm={(title, action) => setConfirm({ title, action })}
              onBlacklistChanged={() => setBlacklistKey((value) => value + 1)}
              onFavoritesChanged={() => setFavoritesRefresh((value) => value + 1)}
              unreadBadges={unreadBadges}
              onRead={markViewed}
              onArticle={(id) => void navigate("news").then(() => openArticle(id))}
              onPost={(id) => { setCircleTarget(id); void navigate("circle"); }} />
          ) : view === "settings" ? (
            <SettingsView
              settings={settings}
              channel={buildChannel}
              version={version}
              onChange={patchSettings}
              onReset={resetSettings}
              onError={showError}
              onConfirm={(title, action) => setConfirm({ title, action })}
              profile={profile}
              onLogin={openLogin}
              onBlacklist={() => { setAccountTab("blacklist"); void navigate("profile"); }}
              notificationStatus={notificationStatus}
            />
          ) : officialView ? (
            <MessageCenter key={profile.id} profile={profile} onLogin={openLogin} onImage={showImage} initialTab={messageTab} onRead={markViewed} readOnly={settings.readOnly}
              onArticle={(id) => void navigate("news").then(() => openArticle(id))}
              onPost={(id) => { setCircleTarget(id); void navigate("circle"); }} />
          ) : articleLoading ? (
            <div className="loading-center">
              <Spinner label="正在打开文章" size="small" />
            </div>
          ) : article ? (
            <>
              <article className="reader">
                <div className="article-kicker">
                  {article.data.source || "IT之家"} · 科技资讯
                </div>
                <h1>{article.data.item.title}</h1>
                <div className="article-meta">
                  {displayDate(article.data.item.date, true)}
                  <span>作者：{article.data.author || "IT之家"}</span>
                </div>
                {article.stale && (
                  <div className="offline-note">
                    正在阅读缓存内容，连接恢复后可刷新核对最新版本。
                  </div>
                )}
                <ArticleBody
                  html={article.data.html}
                  showImages={settings.articleImages}
                  onArticle={(id) => void openArticle(id)}
                  onImage={showImage}
                  onError={showError}
                />
                <div className="reading-end"><span></span>读到这里，也来聊聊你的看法<span></span></div>
                <Comments key={article.data.item.id} article={articleForComments!} profile={profile}
                  refreshKey={commentsKey} onLogin={openLogin} onError={showError} onImage={showImage}
                  registerFlush={registerFlush} readOnly={settings.readOnly} blockedIds={blockedIds} showComposer={settings.showCommentComposer}
                  composeRequest={commentComposeRequest.id === article.data.item.id ? commentComposeRequest.sequence : 0} onInCommentsChange={setInComments} onCountChange={updateCommentCount} />
              </article>
              <div className="article-toolbar">
                <Tooltip content={focused ? "恢复列表" : "专注阅读"} relationship="label">
                  <Button appearance="subtle" icon={focused ? <PanelLeftExpandRegular /> : <PanelLeftContractRegular />}
                    aria-pressed={focused} onClick={() => setFocused(!focused)} />
                </Tooltip>
                <Button className="back-to-list" appearance="subtle" icon={<ArrowLeftRegular />}
                  onClick={() => void flush.current().then(() => { setSelected(null); selectedRef.current = null; setArticle(null); setFocused(false); }).catch((e) => setError(errorText(e)))}>返回列表</Button>
                <span className="toolbar-spacer" />
                <Tooltip content={selectedFavorite ? "取消收藏" : "收藏"} relationship="label">
                  <Button appearance="subtle" icon={selectedFavorite ? <StarFilled /> : <StarRegular />}
                    disabled={settings.readOnly || cloudSaving || (!!profile.id && !favoritesReady)} aria-pressed={!!selectedFavorite}
                    onClick={() => void toggleOfficialFavorite()} />
                </Tooltip>
                <Tooltip content="在官方页面查看" relationship="label">
                  <Button appearance="subtle" icon={<ArrowUpRightRegular />} onClick={() => void backend.official("article", article.data.item.id).catch((e) => setError(errorText(e)))} />
                </Tooltip>
                <span className="toolbar-spacer" />
                <Tooltip content={inComments ? "写评论" : "查看评论"} relationship="label">
                  <Button className="toolbar-comment" appearance="subtle" icon={<CommentRegular />} aria-label={inComments ? "写评论" : "查看评论"}
                    onClick={() => inComments ? setCommentComposeRequest((value) => ({ id: article.data.item.id, sequence: value.sequence + 1 })) : document.querySelector(".comments")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                    <span className="comment-count">{articleForComments?.item.comments || 0}</span>
                  </Button>
                </Tooltip>
              </div>
            </>
          ) : (
            <section className="welcome">
              <img src={appLogo} alt="" />
              <h1>爱科技，爱这里。</h1>
              <p>挑一篇感兴趣的资讯，开始今天的阅读。</p>
              <span>IT之家第三方客户端 · 非官方</span>
            </section>
          )}
        </main>
      </div>
      <footer className="statusbar">
        <span role="status">
          {view === "settings" && settingsStatus ? settingsStatus : status}
        </span>
        <span>
          {buildChannel === "preview"
            ? "浏览器预览 · 登录请使用桌面客户端"
            : "第三方 · 非官方"}
          　v{version}
        </span>
      </footer>
      <Dialog
        open={login}
        onOpenChange={(_, data) => {
          if (!syncing) setLogin(data.open);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              登录 IT之家账号
              {profile.id > 0 && remember && (
                <span className="login-cached-badge">已缓存授权</span>
              )}
            </DialogTitle>
            <DialogContent>
              <p className="dialog-intro">
                选择扫码方式，直接在应用内的官方授权窗口完成登录。成功后自动同步，也可使用原有账号登录。
              </p>
              <div className="login-methods">
                {[["login-wechat", "微信扫码"], ["login-app", "IT之家客户端扫码"]].map(([kind, label]) =>
                  <Button key={kind} size="large" onClick={() => void backend.official(kind).then(() => setLoginOpened(true)).catch((e) => setLoginError(errorText(e)))}>{label}</Button>)}
              </div>
              <Checkbox
                checked={remember}
                onChange={(_, data) => setRemember(!!data.checked)}
                label="在这台电脑上保持登录"
              />
              <p className="muted tiny">
                勾选后，会话 Cookie 使用当前 Windows 用户的 DPAPI 加密保存到本机；不会保存密码。
              </p>
              {loginError && (
                <div className="inline-error" role="alert">
                  {loginError}
                </div>
              )}
              {loginOpened && <p>正在等待官方授权；若未自动完成，可点击“同步登录”重试。</p>}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setLogin(false)} disabled={syncing}>
                取消
              </Button>
              <Button
                icon={<ArrowUpRightRegular />}
                onClick={() =>
                  void backend
                    .official("login")
                    .then(() => setLoginOpened(true))
                    .catch((e) => setLoginError(errorText(e)))
                }
              >
                账号 / 短信登录
              </Button>
              <Button
                appearance="primary"
                disabled={!loginOpened || syncing}
                onClick={() => void syncLogin()}
              >
                {syncing ? "正在核验…" : "同步登录"}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog
        open={!!confirm}
        onOpenChange={(_, data) => {
          if (!data.open) setConfirm(null);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>确认操作</DialogTitle>
            <DialogContent>{confirm?.title}</DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirm(null)}>取消</Button>
              <Button
                appearance="primary"
                onClick={() => {
                  const action = confirm?.action;
                  setConfirm(null);
                  if (action)
                    void action().catch((e) => setError(errorText(e)));
                }}
              >
                确认
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      {userTarget && <Dialog open onOpenChange={(_, data) => { if (!data.open) setUserTarget(null); }}>
        <DialogSurface className="profile-dialog"><DialogBody>
          <DialogTitle action={<Button appearance="subtle" icon={<DismissRegular />} aria-label="关闭个人主页" onClick={() => setUserTarget(null)} />}>个人主页</DialogTitle>
          <DialogContent><UserProfile id={userTarget.id} name={userTarget.name} own={userTarget.id === profile.id}
            onArticle={(id) => { setUserTarget(null); void navigate("news").then(() => openArticle(id)); }}
            onPost={(id) => { setUserTarget(null); setCircleTarget(id); void navigate("circle"); }} /></DialogContent>
        </DialogBody></DialogSurface>
      </Dialog>}
      {image && <Dialog
        open
        onOpenChange={(_, data) => {
          if (!data.open) closeImage();
        }}
      >
        <DialogSurface className="image-dialog">
          <DialogBody>
            <DialogTitle
              action={
                <Button
                  appearance="subtle"
                  icon={<DismissRegular />}
                  aria-label="关闭图片"
                  onClick={closeImage}
                />
              }
            >
              查看图片
            </DialogTitle>
            <DialogContent>
              <div className={`image-view ${zoom ? "zoomed" : ""}`}>
                <img
                  src={image.display}
                  alt="文章或评论中的图片"
                  onClick={() => setZoom(!zoom)}
                  onError={() => { if (image) setImageError(true); }}
                  onLoad={() => setImageError(false)}
                />
                {imageLoading && <Spinner size="tiny" label="正在读取图片" />}
                {imageError && (
                  <span className="image-load-error">
                    图片暂时无法显示，请重试或打开原图
                  </span>
                )}
              </div>
            </DialogContent>
            <DialogActions>
              <Button icon={<ZoomInRegular />} onClick={() => setZoom(!zoom)}>
                {zoom ? "适合窗口" : "原始大小"}
              </Button>
              <Button
                icon={<ArrowDownloadRegular />}
                onClick={() => {
                  if (image)
                    void backend
                      .saveImage(image.source)
                      .then((saved) => {
                        if (saved) setStatus("图片已保存");
                      })
                      .catch((e) => setError(errorText(e)));
                }}
              >
                保存图片
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>}
      </div>
    </FluentProvider>
  );
}
