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
  BookmarkRegular,
  BookmarkFilled,
  CheckmarkRegular,
  DismissRegular,
  HistoryRegular,
  HomeRegular,
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
import ArticleBody from "./components/ArticleBody";
import Comments from "./components/Comments";
import SettingsView from "./components/SettingsView";
import appLogo from "./assets/app.svg";

type View =
  | "news"
  | "favorite"
  | "history"
  | "settings"
  | "circle"
  | "deals"
  | "messages"
  | "profile";
const names: Record<View, string> = {
  news: "资讯",
  favorite: "本机收藏",
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
  const [version, setVersion] = useState("0.1.0");
  const [view, setView] = useState<View>("news");
  const [items, setItems] = useState<NewsItem[]>([]);
  const [article, setArticle] = useState<Cached<Article> | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [favoriteIds, setFavoriteIds] = useState(new Set<number>());
  const [loading, setLoading] = useState(true);
  const [articleLoading, setArticleLoading] = useState(false);
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
  const [loginError, setLoginError] = useState("");
  const [commentsKey, setCommentsKey] = useState(0);
  const [image, setImage] = useState<{
    source: string;
    display: string;
  } | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [confirm, setConfirm] = useState<{
    title: string;
    action: () => Promise<void>;
  } | null>(null);
  const feedGeneration = useRef(0);
  const articleGeneration = useRef(0);
  const selectedRef = useRef(selected);
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
  const dark =
    settings.theme === "dark" || (settings.theme === "system" && systemDark);
  const showError = useCallback((text: string) => setError(text), []);
  const openLogin = useCallback(() => {
    setLogin(true);
    setLoginOpened(false);
    setLoginError("");
  }, []);
  const showImage = useCallback((source: string, display = source) => {
    const normalized = source.startsWith("//") ? `https:${source}` : source;
    setImage({ source: normalized, display });
    setImageLoading(display === normalized);
    setImageError(false);
    setZoom(false);
    if (display === normalized) {
      void backend
        .image(normalized)
        .then((value) => {
          setImage((current) =>
            current?.source === normalized
              ? { source: normalized, display: value }
              : current,
          );
        })
        .catch(() => {})
        .finally(() => setImageLoading(false));
    }
  }, []);

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);
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
  async function reloadFavorites() {
    const values = await backend.items("favorite");
    setFavoriteIds(new Set(values.map((item) => item.id)));
  }
  async function loadFeed(append = false, refresh = false) {
    const token = ++feedGeneration.current;
    setLoading(true);
    setError("");
    try {
      let values: NewsItem[];
      let offline = false;
      if (view === "favorite" || view === "history") {
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
        values.length &&
        window.innerWidth >= 900
      )
        void openArticle(values[0].id);
    } catch (e) {
      if (token === feedGeneration.current) setError(errorText(e));
    } finally {
      if (token === feedGeneration.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (!ready) return;
    if (["news", "favorite", "history", "deals"].includes(view)) {
      setItems([]);
      setQuery("");
      void loadFeed();
      void reloadFavorites().catch((e) => setError(errorText(e)));
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
      setView(next);
      setFocused(false);
      setError("");
      if (
        window.innerWidth <= 600 &&
        ["news", "favorite", "history", "deals"].includes(next)
      ) {
        setSelected(null);
        selectedRef.current = null;
      }
      if (!["news", "favorite", "history", "deals"].includes(next))
        setQuery("");
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
  async function toggleFavorite() {
    if (!article) return;
    const enabled = !favoriteIds.has(article.data.item.id);
    try {
      await backend.favorite(article.data.item, enabled);
      await reloadFavorites();
      if (view === "favorite") await loadFeed();
      setStatus(enabled ? "已加入本机收藏" : "已取消本机收藏");
    } catch (e) {
      setError(errorText(e));
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
  const officialView = ["circle", "messages", "profile"].includes(
    view,
  );
  const selectedFavorite = article && favoriteIds.has(article.data.item.id);
  const theme = useMemo(
    () => ({
      ...(dark ? webDarkTheme : webLightTheme),
      colorBrandBackground: dark ? "#d6535b" : "#bd2530",
      colorBrandBackgroundHover: dark ? "#df6971" : "#a71f29",
      colorBrandBackgroundPressed: "#8e1923",
      colorBrandForeground1: dark ? "#ff949b" : "#b3222d",
      colorBrandForegroundLink: dark ? "#ff949b" : "#b3222d",
      colorBrandStroke1: dark ? "#ff949b" : "#bd2530",
    }),
    [dark],
  );

  return (
    <FluentProvider
      theme={theme}
      className={`app ${dark ? "dark" : "light"} ${settings.compact ? "compact" : ""} ${selected ? "has-article" : ""} ${focused ? "focus-reading" : ""}`}
      style={
        { "--reader-font": `${settings.fontSize}px` } as React.CSSProperties
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
                onClick={() => void navigate(item.id)}
              >
                {names[item.id]}
              </Button>
            ))}
            <span className="nav-label">我的内容</span>
            <Button
              appearance="subtle"
              className={view === "favorite" ? "nav-active" : ""}
              icon={<BookmarkRegular />}
              onClick={() => void navigate("favorite")}
            >
              本机收藏
            </Button>
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
                ["profile", "favorite", "history", "settings"].includes(view)
                  ? "profile-nav-active"
                  : ""
              }
              onClick={() => void navigate("profile")}
            >
              <span className="mobile-my-icon">
                <PersonRegular />
              </span>
              <Avatar name={profile.nick || "家友"} size={28} />
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
        {!officialView && view !== "settings" && (
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
              {view === "favorite"
                ? "仅保存在这台电脑上"
                : view === "history"
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
                  {view === "news" && !query && filtered[0] && (
                    <button
                      className={`news-feature ${filtered[0].id === selected ? "selected" : ""}`}
                      onClick={() => void openArticle(filtered[0].id)}
                      aria-label={`打开焦点文章：${filtered[0].title}`}
                    >
                      {settings.showImages && filtered[0].image && (
                        <CachedImage
                          src={filtered[0].image}
                          alt=""
                          className="feature-image"
                        />
                      )}
                      <span className="feature-shade" />
                      <span className="feature-copy">
                        <span className="feature-kicker">今日焦点</span>
                        <span className="feature-title">{filtered[0].title}</span>
                        <span className="feature-action">打开文章&nbsp; →</span>
                      </span>
                    </button>
                  )}
                  {filtered
                    .slice(view === "news" && !query ? 1 : 0)
                    .map((item) => (
                  <button
                    key={item.id}
                    className={`news-row ${item.id === selected ? "selected" : ""}`}
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
                      : view === "favorite"
                        ? "喜欢的文章，收藏在这里。"
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
        <main className="detail-pane" ref={articleScroll}>
          {view === "settings" ? (
            <SettingsView
              settings={settings}
              channel={buildChannel}
              version={version}
              onChange={patchSettings}
              onReset={resetSettings}
              onError={showError}
              onConfirm={(title, action) => setConfirm({ title, action })}
            />
          ) : officialView ? (
            <section className="official-page">
              <span className="eyebrow">连接官方服务</span>
              <h1>{names[view]}</h1>
              {view === "profile" && profile.id ? (
                <>
                  <Avatar name={profile.nick} size={64} />
                  <h2>{profile.nick}</h2>
                  <p>软媒账号 {profile.id}</p>
                </>
              ) : (
                <div className="official-symbol">
                  {view === "circle" ? (
                    <ChatMultipleRegular />
                  ) : view === "deals" ? (
                    <ShoppingBagRegular />
                  ) : view === "messages" ? (
                    <AlertRegular />
                  ) : (
                    <PersonRegular />
                  )}
                </div>
              )}
              <p>
                {view === "circle"
                  ? "旧版圈子接口当前只返回迁移公告，现行内容由官方 App 提供；这里保留官方页面入口，不显示过期或伪造的帖子。"
                  : view === "deals"
                    ? "在官方好物页面查看商品、优惠和促销详情。"
                    : view === "messages"
                      ? "在官方账号页面查看账号相关内容。当前版本尚未提供后台消息推送。"
                      : "在官方页面管理资料及账号相关内容。"}
              </p>
              <Button
                appearance="primary"
                icon={<ArrowUpRightRegular />}
                onClick={() =>
                  void backend
                    .official(view)
                    .catch((e) => setError(errorText(e)))
                }
              >
                打开官方{view === "profile" ? "账号" : names[view]}页面
              </Button>
              {view === "profile" && (
                <div className="profile-actions">
                  <Button onClick={openLogin}>
                    {profile.id ? "重新登录 / 同步会话" : "登录账号"}
                  </Button>
                  {profile.id > 0 && (
                    <Button
                      onClick={() =>
                        setConfirm({
                          title: "退出当前账号？已保存的草稿会按账号保留。",
                          action: logout,
                        })
                      }
                    >
                      退出登录
                    </Button>
                  )}
                </div>
              )}
              {view === "profile" && (
                <div className="mobile-account-links">
                  <Button
                    icon={<BookmarkRegular />}
                    onClick={() => void navigate("favorite")}
                  >
                    本机收藏
                  </Button>
                  <Button
                    icon={<HistoryRegular />}
                    onClick={() => void navigate("history")}
                  >
                    浏览记录
                  </Button>
                  <Button
                    icon={<SettingsRegular />}
                    onClick={() => void navigate("settings")}
                  >
                    设置
                  </Button>
                </div>
              )}
              <p className="muted tiny">
                此窗口由第三方客户端打开，远程网页不获得本地文件操作权限。
              </p>
            </section>
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
                  onArticle={(id) => void openArticle(id)}
                  onImage={showImage}
                  onError={showError}
                />
                <div className="reading-end">
                  <span></span>读到这里，也来聊聊你的看法<span></span>
                </div>
                <Comments
                  key={article.data.item.id}
                  article={article.data}
                  profile={profile}
                  refreshKey={commentsKey}
                  onLogin={openLogin}
                  onError={showError}
                  onImage={showImage}
                  registerFlush={registerFlush}
                />
              </article>
              <div className="article-toolbar">
                <Button
                  className="back-to-list"
                  appearance="subtle"
                  icon={<ArrowLeftRegular />}
                  onClick={() => {
                    void flush
                      .current()
                      .then(() => {
                        setSelected(null);
                        selectedRef.current = null;
                        setFocused(false);
                      })
                      .catch((e) => setError(errorText(e)));
                  }}
                >
                  返回列表
                </Button>
                <span className="muted tiny article-breadcrumb">
                  {channels.find((c) => c.id === channel)?.name || "资讯"} /
                  正文
                </span>
                <div className="push-right toolbar-actions">
                  <Tooltip
                    content={selectedFavorite ? "取消本机收藏" : "加入本机收藏"}
                    relationship="label"
                  >
                    <Button
                      appearance="subtle"
                      icon={
                        selectedFavorite ? (
                          <BookmarkFilled />
                        ) : (
                          <BookmarkRegular />
                        )
                      }
                      onClick={() => void toggleFavorite()}
                      aria-pressed={!!selectedFavorite}
                    />
                  </Tooltip>
                  <Tooltip content="跳到评论" relationship="label">
                    <Button
                      appearance="subtle"
                      icon={<CommentRegular />}
                      onClick={() =>
                        document
                          .querySelector(".comments")
                          ?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          })
                      }
                    >
                      {article.data.item.comments || ""}
                    </Button>
                  </Tooltip>
                  <Tooltip content="在官方页面查看" relationship="label">
                    <Button
                      appearance="subtle"
                      icon={<ArrowUpRightRegular />}
                      onClick={() =>
                        void backend
                          .official("article", article.data.item.id)
                          .catch((e) => setError(errorText(e)))
                      }
                    />
                  </Tooltip>
                  <Tooltip
                    content={focused ? "恢复列表" : "专注阅读"}
                    relationship="label"
                  >
                    <Button
                      appearance="subtle"
                      icon={
                        focused ? (
                          <PanelLeftExpandRegular />
                        ) : (
                          <PanelLeftContractRegular />
                        )
                      }
                      aria-pressed={focused}
                      onClick={() => setFocused(!focused)}
                    />
                  </Tooltip>
                </div>
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
                在应用内打开官方登录页完成验证，授权只发送到 IT之家官方服务；同步后可缓存到本机。
              </p>
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
              {loginOpened && <p>完成官方登录后回到这里，点击“同步登录”核验授权。</p>}
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
                打开官方登录
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
      <Dialog
        open={!!image}
        onOpenChange={(_, data) => {
          if (!data.open) setImage(null);
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
                  onClick={() => setImage(null)}
                />
              }
            >
              查看图片
            </DialogTitle>
            <DialogContent>
              <div className={`image-view ${zoom ? "zoomed" : ""}`}>
                <img
                  src={image?.display || ""}
                  alt="文章或评论中的图片"
                  onClick={() => setZoom(!zoom)}
                  onError={() => setImageError(true)}
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
      </Dialog>
    </FluentProvider>
  );
}
