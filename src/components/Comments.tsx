import { useEffect, useRef, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Spinner, Textarea } from "@fluentui/react-components";
import {
  ArrowReplyRegular,
  ArrowSyncRegular,
  DismissRegular,
} from "@fluentui/react-icons";
import { backend } from "../bridge";
import { displayDate, errorText, mergeComments } from "../domain";
import type { Article, CommentsPage, DeviceTail, OfficialComment, Profile } from "../types";
import type { CSSProperties } from "react";
import CachedImage from "./CachedImage";
import officialEmojis from "../emoji.json";
import UserAvatar from "./UserAvatar";

export interface DraftSnapshot {
  id: number;
  reply: number;
  account: number;
  body: string;
}
export function CommentText({ value }: { value: string }) {
  if (typeof value !== "string") return null;
  const names = officialEmojis as Record<string, string>;
  return (
    <>
      {value.split(/(\[[^\]\n]+\])/g).map((part, index) => {
        const slug = part.startsWith("[")
          ? names[part.slice(1, -1)]
          : undefined;
        return slug ? (
          <CachedImage
            key={index}
            className="official-emoji"
            src={`https://img.ithome.com/app/emotion/imgs/rm_e_${slug}.png`}
            alt={part}
          />
        ) : (
          <span key={index}>{part}</span>
        );
      })}
    </>
  );
}
export function DeviceSource({ value }: { value: DeviceTail | string }) {
  if (typeof value === "string") return <span>{value}</span>;
  const color = (input?: string | null) =>
    input && /^#[0-9a-f]{3,8}$/i.test(input) ? input : undefined;
  return (
    <>
      {value.name && (
        <span
          className="device-source-name"
          style={{
            "--source-color": color(value.color),
            "--source-dark-color": color(value.darkColor),
          } as CSSProperties}
        >{value.name}</span>
      )}
      {(Array.isArray(value.extraTails) ? value.extraTails : []).map((extra, index) =>
        extra?.name ? <span key={index}> · <DeviceSource value={extra} /></span> : null,
      )}
    </>
  );
}
function Thread({
  comment,
  article,
  depth = 0,
  onReply,
  onError,
  onImage,
  onLogin,
  loggedIn,
  readOnly = false,
  blockedIds,
}: {
  comment: OfficialComment;
  article: Article;
  depth?: number;
  onReply: (c: OfficialComment) => void;
  onError: (s: string) => void;
  onImage: (sourceUrl: string, displayUrl?: string) => void;
  onLogin: () => void;
  loggedIn: boolean;
  readOnly?: boolean;
  blockedIds: Set<number>;
}) {
  const [children, setChildren] = useState(comment.children || []);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [vote, setVote] = useState({ support: comment.support || 0, against: comment.against || 0, type: comment.voteStatus || 0 });
  const voting = useRef(false);
  const visibleChildren = children.filter((child) => !blockedIds.has(child.userInfo?.id));
  const knownChildren = expanded ? visibleChildren : visibleChildren.slice(0, 3);
  useEffect(() => {
    setVote({ support: comment.support || 0, against: comment.against || 0, type: comment.voteStatus || 0 });
    setChildren(comment.children || []);
    setExpanded(false);
  }, [comment]);
  async function expand() {
    setLoading(true);
    try {
      const result = await backend.children(
        article.item.id,
        article.sn,
        comment.id,
      );
      setChildren(Array.isArray(result) ? result : result.children || []);
      setExpanded(true);
    } catch (e) {
      onError(errorText(e));
    } finally {
      setLoading(false);
    }
  }
  async function voteClick(type: 1 | 2) {
    if (!loggedIn) { onLogin(); return; }
    if (readOnly || voting.current) return;
    if (vote.type && vote.type !== type) { onError("请先取消原有投票，再选择另一种态度"); return; }
    voting.current = true;
    setLoading(true);
    try {
      const cancel = vote.type === type;
      const result = await backend.vote(comment.id, cancel, type);
      const count = result.message === undefined || result.message === "" ? NaN : Number(result.message);
      const key = type === 1 ? "support" : "against";
      setVote({ ...vote, [key]: Number.isFinite(count) ? Math.max(0, count) : Math.max(0, vote[key] + (cancel ? -1 : 1)), type: cancel ? 0 : type });
    } catch (e) {
      onError(errorText(e));
      if (errorText(e).includes("登录")) onLogin();
    } finally {
      voting.current = false;
      setLoading(false);
    }
  }
  return (
    <div className={`comment-thread ${depth ? "nested" : ""}`}>
      <div className="comment-row">
      <div className="comment-identity">
      <UserAvatar
        id={comment.userInfo?.id || 0}
        name={comment.userInfo?.userNick || "家友"}
        src={comment.userInfo?.userAvatar}
        size={depth ? 32 : 40}
      />
      {comment.userInfo?.level !== undefined && (
        <span className="comment-level">Lv.{comment.userInfo.level}</span>
      )}
      </div>
      <div className="comment-main">
        <div className="comment-byline">
          <strong>{comment.userInfo?.userNick || "家友"}</strong>
          <span className="push-right">{comment.floorStr}</span>
        </div>
        <div className="comment-meta">
          <time>{displayDate(comment.postTime)}</time>
          {(comment.deviceTailModel || comment.tail) && (
            <span className="comment-device-tail"><DeviceSource value={comment.deviceTailModel || comment.tail!} /></span>
          )}
          {comment.city && <span className="comment-city">{comment.city}</span>}
        </div>
        <div className="comment-content">
          {comment.replyUserInfo?.userNick && <span className="reply-to">回复 {comment.replyUserInfo.userNick}：</span>}
          {comment.elements?.map((element, index) =>
            element.type === 0 ? (
              <CommentText key={index} value={element.content || ""} />
            ) : element.type === 1 && element.src ? (
              <CachedImage
                key={index}
                src={
                  element.src.startsWith("//")
                    ? "https:" + element.src
                    : element.src
                }
                className="comment-image"
                alt="评论图片"
                onClick={(displayUrl) =>
                  onImage(
                    element.src!.startsWith("//")
                      ? `https:${element.src}`
                      : element.src!,
                    displayUrl,
                  )
                }
              />
            ) : (
              <span key={index}>{element.content || element.link || ""}</span>
            ),
          )}
        </div>
        {comment.pictures?.filter((picture) =>
          picture.src && !comment.elements?.some((element) => element.src === picture.src),
        ).map((picture, index) => (
          <CachedImage
            key={index}
            src={picture.src}
            alt="评论图片"
            className="comment-image"
            onClick={(display) => onImage(picture.originSrc || picture.src, display)}
          />
        ))}
        {comment.aiHint && <div className="muted tiny">{comment.aiHint}</div>}
        <div className="comment-actions">
          <Button
            appearance="subtle"
            size="small"
            className="comment-support"
            aria-label={`支持评论 ${comment.id}`}
            aria-pressed={vote.type === 1}
            onClick={() => void voteClick(1)}
            disabled={loading || readOnly}
          >
            {vote.type === 1 ? "取消支持" : "支持"}({vote.support})
          </Button>
          <Button className="comment-against" aria-label={`反对评论 ${comment.id}`} appearance="subtle" size="small" aria-pressed={vote.type === 2} onClick={() => void voteClick(2)} disabled={loading || readOnly}>{vote.type === 2 ? "取消反对" : "反对"}({vote.against})</Button>
          <Button
            appearance="subtle"
            size="small"
            icon={<ArrowReplyRegular />}
            onClick={() => onReply(comment)}
            disabled={readOnly || loading}
          >
            回复
          </Button>
        </div>
      </div>
      </div>
      {(knownChildren.length > 0 || comment.expandCount! > children.length) && (
      <div className={depth ? "comment-reply-children" : "comment-replies"}>
        {depth < 3 &&
          knownChildren.map((child) => (
            <Thread
              key={child.id}
              comment={child}
              article={article}
              depth={depth + 1}
              onReply={onReply}
              onError={onError}
              onImage={onImage}
              onLogin={onLogin}
              loggedIn={loggedIn}
              readOnly={readOnly}
              blockedIds={blockedIds}
            />
          ))}
        {(comment.expandCount! > children.length ||
          (!expanded && children.length > 3)) && (
          <Button
            appearance="subtle"
            size="small"
            onClick={() => void expand()}
            disabled={loading}
          >
            {loading ? "加载中…" : "展开更多回复"}
          </Button>
        )}
      </div>
      )}
    </div>
  );
}

export default function Comments({
  article,
  profile,
  refreshKey,
  onLogin,
  onError,
  onImage,
  registerFlush,
  readOnly = false,
  blockedIds,
  showComposer = true,
  composeRequest = 0,
  onInCommentsChange,
  onCountChange,
}: {
  article: Article;
  profile: Profile;
  refreshKey: number;
  onLogin: () => void;
  onError: (s: string) => void;
  onImage: (sourceUrl: string, displayUrl?: string) => void;
  registerFlush: (flush: () => Promise<void>) => void;
  readOnly?: boolean;
  blockedIds: Set<number>;
  showComposer?: boolean;
  composeRequest?: number;
  onInCommentsChange?: (visible: boolean) => void;
  onCountChange?: (id: number, count: number) => void;
}) {
  const [page, setPage] = useState<CommentsPage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [tab, setTab] = useState<"new" | "earliest">("new");
  const [reply, setReply] = useState<OfficialComment | null>(null);
  const [body, setBody] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [composing, setComposing] = useState(false);
  const sendPending = useRef(false);
  const context = useRef(0);
  const generation = useRef(0);
  const pending = useRef<DraftSnapshot | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const input = useRef<HTMLTextAreaElement>(null);
  const ready = useRef(false);
  const head = useRef<HTMLDivElement>(null);
  const loadMore = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = head.current?.closest(".detail-pane");
    if (!root) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!head.current) return;
        const area = root.getBoundingClientRect();
        const comments = head.current.getBoundingClientRect();
        const atEnd = root.scrollTop + root.clientHeight >= root.scrollHeight - 2;
        // Short/empty comment lists cannot always reach the top of the viewport.
        onInCommentsChange?.((comments.top <= area.top + Math.min(100, area.height * .2) || atEnd && comments.top < area.bottom - 100) && comments.bottom > area.top);
      });
    };
    root.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(root); observer.observe(head.current!); update();
    return () => { cancelAnimationFrame(frame); root.removeEventListener("scroll", update); observer.disconnect(); onInCommentsChange?.(false); };
  }, [onInCommentsChange]);
  useEffect(() => { if (composeRequest) void changeReply(null); }, [composeRequest]);
  useEffect(() => { setComposing(false); }, [profile.id]);
  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    const snapshot = pending.current;
    if (snapshot) {
      pending.current = null;
      const write = queue.current
        .catch(() => {})
        .then(() =>
          backend.saveDraft(
            snapshot.id,
            snapshot.reply,
            snapshot.body,
            snapshot.account,
          ),
        );
      queue.current = write;
      try {
        await write;
        setDraftStatus(snapshot.body ? "草稿已保存" : "");
      } catch (e) {
        if (!pending.current) pending.current = snapshot;
        setDraftStatus("草稿保存失败");
        throw e;
      }
    } else await queue.current;
  };
  const latestFlush = useRef(flush);
  latestFlush.current = flush;
  useEffect(() => {
    registerFlush(() => latestFlush.current());
    return () => {
      registerFlush(async () => {});
      void latestFlush.current().catch((e) => onError(errorText(e)));
    };
  }, [registerFlush]);
  useEffect(() => {
    const token = ++context.current;
    ready.current = false;
    setBody("");
    setDraftStatus("");
    setSaved(false);
    void backend
      .draft(article.item.id, reply?.id || 0)
      .then((value) => {
        if (token === context.current) {
          setBody(value);
          setDraftStatus(value ? "已恢复草稿" : "");
          ready.current = true;
        }
      })
      .catch((e) => {
        if (token === context.current) onError(errorText(e));
      });
    return () => {
      context.current += 1;
    };
  }, [article.item.id, reply?.id, profile.id]);
  useEffect(() => {
    setReply(null);
  }, [article.item.id]);
  async function load(append = false) {
    const token = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const cursor = append ? page?.comments.at(-1)?.id || 0 : 0;
      const value = await backend.comments(
        article.item.id,
        article.sn,
        cursor,
        tab === "earliest",
      );
      if (token !== generation.current) return;
      const floors = [...(value.comments || []), ...(value.hotComments || [])].map((comment) => Number(comment.floorStr?.match(/\d+/)?.[0]) || 0);
      // The App contract uses hotCount as its displayed total, including replies.
      const knownCount = Number.isSafeInteger(value.hotCount) && value.hotCount! >= 0 ? value.hotCount! : Math.max(article.item.comments, ...floors);
      if (!append) onCountChange?.(article.item.id, knownCount);
      setPage((old) => ({
        ...value,
        comments: append
          ? mergeComments(old?.comments || [], value.comments || [])
          : value.comments || [],
        hotComments: append ? old?.hotComments : value.hotComments,
      }));
      setMore((value.comments || []).length > 0 && (!append || value.comments.some(
        (comment) => !page?.comments.some((old) => old.id === comment.id),
      )));
    } catch (e) {
      if (token === generation.current) setError(errorText(e));
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    setPage(null);
    void load();
    return () => {
      generation.current += 1;
    };
  }, [article.item.id, tab, refreshKey]);
  useEffect(() => {
    if (loading || !more || !page || !loadMore.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        void load(true);
      }
    }, { rootMargin: "200px" });
    observer.observe(loadMore.current);
    return () => observer.disconnect();
  }, [loading, more, page]);
  function edit(value: string) {
    setBody(value);
    setSaved(false);
    if (!ready.current) return;
    pending.current = {
      id: article.item.id,
      reply: reply?.id || 0,
      body: value,
      account: profile.id,
    };
    setDraftStatus("正在保存…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush().catch((e) => onError(errorText(e)));
    }, 350);
  }
  async function changeReply(value: OfficialComment | null) {
    if (readOnly) { onError("只读模式已开启，请在设置中关闭后操作"); return; }
    if (!profile.id) { onLogin(); return; }
    if (article.item.forbidComment || (page && !page.canComment)) { onError(page?.cannotCommentTip || "本文已关闭评论"); return; }
    try {
      await flush();
      setReply(value);
      setComposing(true);
    } catch (e) {
      onError(errorText(e));
    }
  }
  async function send() {
    if (sendPending.current || saved || !ready.current) return;
    if (readOnly) { onError("只读模式已开启，请在设置中关闭后操作"); return; }
    if (!profile.id) {
      setComposing(false);
      onLogin();
      return;
    }
    if (!body.trim()) return;
    sendPending.current = true;
    setSending(true);
    try {
      await flush();
      const result = await backend.submit(
        article.item.id,
        reply?.id || 0,
        body,
      );
      setSaved(true);
      setDraftStatus(result.message || "已提交，等待官方结果");
      await load();
      if (result.content) {
        pending.current = {
          id: article.item.id,
          reply: reply?.id || 0,
          body: "",
          account: profile.id,
        };
        await flush();
        setBody("");
        setReply(null);
        setComposing(false);
      } else {
        setDraftStatus((result.message || "已提交") + " · 草稿保留");
      }
    } catch (e) {
      onError(errorText(e));
    } finally {
      sendPending.current = false;
      setSending(false);
    }
  }
  const list = page?.comments || [];
  const allowed = !article.item.forbidComment && (!page || page.canComment);
  async function closeComposer() {
    if (sendPending.current) return;
    try { await flush(); setComposing(false); } catch (e) { onError(errorText(e)); }
  }
  return (
    <section className="comments" ref={head} aria-label="家友评论">
      <div className="comments-header">
        <h2>家友评论</h2>
        <span className="muted tiny">{article.item.comments || ""}</span>
        <div className="push-right comment-tabs">
          {showComposer && <Button appearance="primary" size="small" onClick={() => void changeReply(null)}>写评论</Button>}
          {(
            [
              ["new", "最新"],
              ["earliest", "最早"],
            ] as const
          ).map(([id, name]) => (
            <Button
              key={id}
              size="small"
              appearance="subtle"
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
            >
              {name}
            </Button>
          ))}
          <Button
            size="small"
            appearance="subtle"
            icon={<ArrowSyncRegular />}
            aria-label="刷新评论"
            onClick={() => void load()}
            disabled={loading}
          />
        </div>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
          <Button size="small" onClick={() => void load()}>
            重试
          </Button>
        </div>
      )}
      {!page && loading && <Spinner size="tiny" label="正在读取评论" />}
      {!!page?.hotComments?.length && (
        <div className="hot-comments">
          <h3 className="comment-section-title">热门评论</h3>
          {page.hotComments.filter((comment) => !blockedIds.has(comment.userInfo?.id)).map((comment) => (
            <Thread key={comment.id} comment={comment} article={article}
              onReply={(value) => void changeReply(value)} onError={onError}
              onImage={onImage} onLogin={onLogin} loggedIn={!!profile.id} readOnly={readOnly} blockedIds={blockedIds} />
          ))}
        </div>
      )}
      {page && <h3 className="comment-section-title all-comments">全部评论 <span>{article.item.comments || 0}</span></h3>}
      {list.filter((comment) => !blockedIds.has(comment.userInfo?.id)).map((comment) => (
        <Thread
          key={comment.id}
          comment={comment}
          article={article}
          onReply={(c) => void changeReply(c)}
          onError={onError}
          onImage={onImage}
          onLogin={onLogin}
          loggedIn={!!profile.id}
          readOnly={readOnly}
          blockedIds={blockedIds}
        />
      ))}
      {page && !list.length && !loading && (
        <p className="empty-inline">还没有评论，来聊聊你的看法。</p>
      )}
      <div ref={loadMore} className="comments-more">
      {page && more && (
        <Button
          appearance="subtle"
          onClick={() => void load(true)}
          disabled={loading}
        >
          {loading ? "加载中…" : "加载更多评论"}
        </Button>
      )}
      </div>
      {composing && <Dialog open onOpenChange={(_, data) => {
        if (!data.open) void closeComposer();
      }}><DialogSurface className="compose-dialog"><DialogBody>
        <DialogTitle action={<Button appearance="subtle" icon={<DismissRegular />} aria-label="关闭评论" disabled={sending} onClick={() => void closeComposer()} />}>{reply ? `回复 ${reply.userInfo?.userNick || "家友"}` : "写评论"}</DialogTitle>
        <DialogContent><div className="composer">
        {reply && (
          <div className="composer-reply">
            回复 {reply.userInfo?.userNick || "家友"} · {reply.floorStr}
            <Button
              appearance="subtle"
              size="small"
              onClick={() => void closeComposer()}
            >
              取消回复
            </Button>
          </div>
        )}
        <Textarea
          ref={input}
          value={body}
          onChange={(_, data) => edit(data.value)}
          placeholder={
            allowed
              ? "聊聊你的看法…"
              : page?.cannotCommentTip || "本文已关闭评论"
          }
            disabled={!allowed || sending || readOnly}
          resize="vertical"
          appearance="outline"
          aria-label="评论草稿"
          autoFocus
          onKeyDown={(event) => {
            if (event.ctrlKey && event.key === "Enter") {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="composer-footer">
          <span className="muted tiny" role="status">
            {draftStatus || page?.ruleHint || "愿每句评论都带来思考"}
          </span>
          <Button
            appearance="primary"
            onClick={() => void send()}
            disabled={
              !allowed || sending || saved || readOnly || (!body.trim() && !!profile.id)
            }
          >
            {sending ? "提交中…" : profile.id ? "发表评论" : "登录后评论"}
          </Button>
        </div>
      </div></DialogContent>
      <DialogActions><Button disabled={sending} aria-label="取消评论" onClick={() => void closeComposer()}>取消</Button></DialogActions>
      </DialogBody></DialogSurface></Dialog>}
    </section>
  );
}
