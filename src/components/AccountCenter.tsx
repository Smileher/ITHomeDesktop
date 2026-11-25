import { useEffect, useRef, useState } from "react";
import { Button, Input, Spinner } from "@fluentui/react-components";
import {
  ArrowLeftRegular,
  ArrowSyncRegular,
  StarRegular,
  CommentRegular,
  DocumentRegular,
  HistoryRegular,
  SettingsRegular,
  ShoppingBagRegular,
  WalletRegular,
  PeopleRegular,
  EditRegular,
  DraftsRegular,
  QuestionCircleRegular,
  ShieldPersonRegular,
  CheckmarkCircleRegular,
} from "@fluentui/react-icons";
import { backend } from "../bridge";
import { accountRows } from "../account-domain";
import type { AccountRow, AccountTab } from "../account-domain";
import { displayDate, errorText } from "../domain";
import type { Profile } from "../types";
import CachedImage from "./CachedImage";
import { CommentText, DeviceSource } from "./Comments";
import UserAvatar from "./UserAvatar";
import UserProfile from "./UserProfile";

const names: Record<AccountTab, string> = {
  home: "我的",
  comments: "我的评论",
  posts: "我的帖子",
  favorites: "收藏",
  "starred-posts": "收藏",
  following: "我的关注",
  drafts: "我的草稿",
  history: "足迹",
  blacklist: "黑名单管理",
};
export default function AccountCenter({
  profile,
  tab,
  onTab,
  onLogin,
  onLogout,
  onSettings,
  onArticle,
  onPost,
  readOnly,
  onConfirm,
  onBlacklistChanged,
  onFavoritesChanged,
  unreadBadges,
  onRead,
}: {
  profile: Profile;
  tab: AccountTab;
  onTab: (tab: AccountTab) => void;
  onLogin: () => void;
  onLogout: () => void;
  onSettings: () => void;
  onArticle: (id: number) => void;
  onPost: (id: number) => void;
  readOnly: boolean;
  onConfirm: (title: string, action: () => Promise<void>) => void;
  onBlacklistChanged: () => void;
  onFavoritesChanged: () => void;
  unreadBadges?: { comments: number; posts: number };
  onRead?: (kind: "news-replies" | "circle-replies") => void;
}) {
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState("");
  const [filter, setFilter] = useState("");
  const [visible, setVisible] = useState(80);
  const generation = useRef(0);
  async function load(append = false) {
    const token = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const next = append ? page + 1 : 1;
      const data =
        tab === "history" ? await backend.items("history") : tab === "drafts"
          ? await backend.drafts()
          : await backend.account(
              tab,
              next,
              append ? Number(rows.at(-1)?.id || 0) : 0,
            );
      if (token !== generation.current) return;
      const incoming = accountRows(tab, data);
      const kind = tab === "comments" ? "news-replies" : tab === "posts" ? "circle-replies" : null;
      if (kind && !readOnly && !append) {
        void backend.messageRead(kind).then(() => { if (token === generation.current) onRead?.(kind); }).catch((e) => { if (token === generation.current) setError(`内容已读取，${errorText(e)}`); });
      }
      setRows((current) =>
        append
          ? [
              ...new Map(
                [...current, ...incoming].map((row) => [row.id, row]),
              ).values(),
            ]
          : incoming,
      );
      setPage(next);
      const metadata = Array.isArray(data) ? {} : data;
      const total = Number(metadata.total);
      setMore(
        !["blacklist", "drafts", "history"].includes(tab) &&
          incoming.length > 0 &&
          (Number.isFinite(total)
            ? next * Number(metadata.pageSize || 20) < total
            : tab === "comments" || incoming.length >= 20),
      );
    } catch (e) {
      if (token === generation.current) setError(errorText(e));
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    setRows([]);
    setFilter("");
    setError("");
    setVisible(80);
    if (tab !== "home" && (profile.id || ["drafts", "history"].includes(tab))) void load();
    return () => {
      generation.current += 1;
    };
  }, [tab, profile.id]);
  function official(kind: string) {
    if (!["mall", "feedback"].includes(kind) && !profile.id) {
      onLogin();
      return;
    }
    void backend.official(kind).catch((e) => setError(errorText(e)));
  }
  async function remove(row: AccountRow) {
    await backend.accountAction(
      tab === "blacklist" ? "unblock" : "favorite-remove",
      row.userId || row.newsId!,
    );
    await load();
    if (tab === "blacklist") onBlacklistChanged();
    if (tab === "favorites") onFavoritesChanged();
  }
  function block() {
    const id = Number(userId);
    if (!Number.isSafeInteger(id) || id < 1 || id > 999999999) {
      setError("请输入有效的官方用户 ID");
      return;
    }
    onConfirm(`将用户 ${id} 加入官方黑名单？`, async () => {
      await backend.accountAction("block", id);
      setUserId("");
      await load();
      onBlacklistChanged();
    });
  }
  return (
    <section className="account-page official-page">
      <div className="account-header">
        <UserAvatar id={profile.id} name={profile.nick || "家友"} size={56} />
        <div>
          <h1>{profile.nick || "登录，发现更多精彩"}</h1>
          <p className="muted">
            {profile.id
              ? "IT之家官方账号已连接"
              : "同步官方收藏、评论和圈子内容"}
          </p>
        </div>
        <Button appearance="subtle" onClick={onLogin}>{profile.id ? "重新授权" : "登录 / 注册"}</Button>
      </div>
      <div className="account-shortcuts mobile-account-links">
        <Button
          appearance="subtle"
          icon={<CommentRegular />}
          aria-pressed={tab === "comments"}
          onClick={() => onTab("comments")}
        >
          评论{(unreadBadges?.comments || 0) > 0 && <i className="shortcut-unread-dot" aria-hidden="true" title={`${unreadBadges!.comments} 条未读评论`} />}
        </Button>
        <Button
          appearance="subtle"
          icon={<DocumentRegular />}
          aria-pressed={tab === "posts"}
          onClick={() => onTab("posts")}
        >
          帖子{(unreadBadges?.posts || 0) > 0 && <i className="shortcut-unread-dot" aria-hidden="true" title={`${unreadBadges!.posts} 条未读帖子`} />}
        </Button>
        <Button
          appearance="subtle"
          icon={<StarRegular />}
          aria-pressed={tab === "favorites" || tab === "starred-posts"}
          onClick={() => onTab("favorites")}
        >
          收藏
        </Button>
        <Button
          appearance="subtle"
          icon={<HistoryRegular />}
          aria-pressed={tab === "history"}
          onClick={() => onTab("history")}
        >
          足迹
        </Button>
      </div>
      <div className="account-layout">
        <nav className="account-menu" aria-label="账号功能">
          {(
            [
              ["之家商城", <ShoppingBagRegular />, () => official("mall")],
              ["我的资产", <WalletRegular />, () => official("assets")],
              ["金币任务", <CheckmarkCircleRegular />, () => official("tasks")],
              ["我的关注", <PeopleRegular />, () => onTab("following")],
              ["我的投稿", <EditRegular />, () => official("contributions")],
              ["我的草稿", <DraftsRegular />, () => onTab("drafts")],
              ["黑名单", <ShieldPersonRegular />, () => onTab("blacklist")],
              ["设置", <SettingsRegular />, onSettings],
              [
                "帮助与反馈",
                <QuestionCircleRegular />,
                () => official("feedback"),
              ],
            ] as const
          ).map(([name, icon, action]) => (
            <Button
              key={name}
              aria-label={name}
              appearance="subtle"
              icon={icon}
              onClick={action}
            >
              {name}
              <span className="push-right" aria-hidden="true">
                ›
              </span>
            </Button>
          ))}
          {profile.id > 0 && (
            <Button appearance="subtle" onClick={onLogout}>
              退出登录
            </Button>
          )}
        </nav>
        <div className="account-content">
          {tab === "home" ? (
            profile.id ? <UserProfile id={profile.id} name={profile.nick} own onArticle={onArticle} onPost={onPost} /> :
              <div className="account-welcome"><StarRegular /><h2>你的科技生活，都在这里</h2><p>登录后同步收藏，查看评论与帖子。</p><Button appearance="primary" onClick={onLogin}>登录账号</Button></div>
          ) : (
            <>
              <div className="account-content-heading">
                <Button
                  appearance="subtle"
                  icon={<ArrowLeftRegular />}
                  aria-label="返回账号首页"
                  onClick={() => onTab("home")}
                />
                <h2>{names[tab]}</h2>
                <Button
                  appearance="subtle"
                  icon={<ArrowSyncRegular />}
                  aria-label="刷新账号内容"
                  disabled={loading}
                  onClick={() => {
                    void load();
                    if (tab === "favorites") onFavoritesChanged();
                  }}
                />
              </div>
              {(tab === "favorites" || tab === "starred-posts") && (
                <div className="circle-sort">
                  <button
                    aria-pressed={tab === "favorites"}
                    onClick={() => onTab("favorites")}
                  >
                    新闻
                  </button>
                  <button
                    aria-pressed={tab === "starred-posts"}
                    onClick={() => onTab("starred-posts")}
                  >
                    帖子
                  </button>
                </div>
              )}
              {!profile.id && !["drafts", "history"].includes(tab) ? (
                <div className="empty-state">
                  <p>登录后读取官方账号内容</p>
                  <Button appearance="primary" onClick={onLogin}>
                    登录账号
                  </Button>
                </div>
              ) : (
                <>
                  {tab === "blacklist" && (
                    <>
                      <p className="muted tiny">
                        与官方账号同步，屏蔽与解除操作会影响官方客户端。
                      </p>
                      <div className="blacklist-controls">
                        <Input
                          aria-label="查找黑名单"
                          placeholder="按昵称或 ID 查找"
                          value={filter}
                          onChange={(_, data) => setFilter(data.value)}
                        />
                        <Input
                          aria-label="屏蔽用户 ID"
                          placeholder="官方用户 ID"
                          value={userId}
                          onChange={(_, data) => setUserId(data.value)}
                        />
                        <Button disabled={readOnly || loading} onClick={block}>
                          屏蔽用户
                        </Button>
                      </div>
                    </>
                  )}
                  {error && (
                    <div className="inline-error" role="alert">
                      {error}
                      <Button size="small" onClick={() => void load()}>
                        重试
                      </Button>
                    </div>
                  )}
                  {loading && !rows.length && (
                    <Spinner size="small" label="正在读取账号内容" />
                  )}
                  {rows
                    .filter(
                      (row) =>
                        !filter ||
                        `${row.title} ${row.userId}`
                          .toLowerCase()
                          .includes(filter.toLowerCase()),
                    )
                    .slice(0, visible)
                    .map((row) => (
                      <article className="account-row" key={row.id}>
                        {row.userId ? <UserAvatar id={row.userId} name={row.title} src={row.image} size={44} /> : row.image && (
                          <CachedImage
                            src={row.image}
                            alt=""
                            className="account-row-image"
                          />
                        )}
                        <div className="account-row-main">
                          <strong>
                            {row.title || (row.postId ? "圈子帖子" : "家友")}
                          </strong>
                          {row.text && (
                            <div className="comment-content account-row-text">
                              <CommentText value={row.text} />
                            </div>
                          )}
                          <div className="comment-meta">
                            <time>{displayDate(row.date)}</time>
                            {row.tail && <DeviceSource value={row.tail} />}
                          </div>
                          <div className="account-row-actions">
                            {(row.newsId || row.postId) && !row.deleted && (
                              <Button
                                appearance="subtle"
                                size="small"
                                onClick={() =>
                                  row.newsId
                                    ? onArticle(row.newsId)
                                    : onPost(row.postId!)
                                }
                              >
                                {row.newsId ? "打开原文" : "打开帖子"}
                              </Button>
                            )}
                            {row.deleted && (
                              <span className="muted tiny">原文已删除</span>
                            )}
                            {["blacklist", "favorites"].includes(tab) && (
                              <Button
                                appearance="subtle"
                                size="small"
                                disabled={readOnly || loading}
                                onClick={() =>
                                  onConfirm(
                                    tab === "blacklist"
                                      ? `解除对“${row.title}”的官方屏蔽？`
                                      : `取消“${row.title}”的官方收藏？`,
                                    () => remove(row),
                                  )
                                }
                              >
                                {tab === "blacklist"
                                  ? "解除屏蔽"
                                  : "取消收藏"}
                              </Button>
                            )}
                          </div>
                        </div>
                      </article>
                    ))}
                  {!loading && !rows.length && !error && (
                    <p className="empty-inline">这里还没有内容。</p>
                  )}
                  {more && (
                    <Button
                      className="load-more"
                      appearance="subtle"
                      disabled={loading}
                      onClick={() => void load(true)}
                    >
                      {loading ? "加载中…" : "加载更多"}
                    </Button>
                  )}
                  {rows.filter(
                    (row) =>
                      !filter ||
                      `${row.title} ${row.userId}`
                        .toLowerCase()
                        .includes(filter.toLowerCase()),
                  ).length > visible && (
                    <Button
                      appearance="subtle"
                      onClick={() => setVisible((value) => value + 80)}
                    >
                      显示更多
                    </Button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
      <p className="muted tiny account-disclaimer">
        IT之家第三方客户端 · 非官方
      </p>
    </section>
  );
}
