import { useEffect, useRef, useState } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import { AlertRegular, ArrowLeftRegular, ArrowSyncRegular } from "@fluentui/react-icons";
import { backend } from "../bridge";
import { articleId, displayDate, errorText } from "../domain";
import type { CirclePost, CommentElement, OfficialComment, Profile } from "../types";
import UserAvatar from "./UserAvatar";
import CachedImage from "./CachedImage";
import { CommentText, DeviceSource } from "./Comments";

interface Conversation {
  id: number; anotherUserId: number; summary: string; lastTime: string;
  notReadMessageCount: number; anotherUserBaseInfoModel?: { id: number; userNick: string; userAvatar?: string; link?: string };
}
interface Message {
  messageId?: number | string; id?: number | string; contentType: number; createTime: string;
  contentElements?: CommentElement[]; systemNotifyElements?: CommentElement[];
  image?: { url: string }; fromUserId: number; link?: string;
}
interface NewsReply { comment: OfficialComment; news?: { id: number; title: string }; link?: string }
type Tab = "conversations" | "news-replies" | "circle-replies";
export default function MessageCenter({ profile, onLogin, onArticle, onPost, onImage, initialTab = "conversations", onRead, readOnly }: {
  profile: Profile; onLogin: () => void; onArticle: (id: number) => void; onPost: (id: number) => void;
  onImage: (source: string, display?: string) => void;
  initialTab?: Tab; readOnly: boolean; onRead: (kind: "news-replies" | "circle-replies" | "conversation") => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [rows, setRows] = useState<(Conversation | NewsReply | CirclePost)[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [unread, setUnread] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadedFor, setLoadedFor] = useState("");
  const contextKey = selected ? `conversation:${selected.anotherUserId}` : tab;
  const generation = useRef(0);
  async function load(append = false) {
    if (!profile.id) return;
    const token = ++generation.current;
    setBusy(true); setError("");
    try {
      const next = append ? page + 1 : 1;
      if (selected) {
        const value = await backend.messages<Message[]>("conversation", selected.anotherUserId, next, 0, append ? messages.at(-1)?.createTime || "" : "");
        if (!Array.isArray(value)) throw new Error("会话响应格式已变化");
        if (token !== generation.current) return;
        const incoming = value.filter((item) => item.messageId !== undefined || item.id !== undefined);
        setMessages((old) => append ? [...new Map([...old, ...incoming].map((item) => [String(item.messageId ?? item.id), item])).values()] : incoming);
        setLoadedFor(`conversation:${selected.anotherUserId}`);
        setMore(incoming.length >= 20 && (!append || incoming.some((item) => !messages.some((old) => String(old.messageId ?? old.id) === String(item.messageId ?? item.id)))));
      } else {
        const value = await backend.messages<unknown>(tab, 0, next, append && tab === "news-replies" ? (rows.at(-1) as NewsReply)?.comment?.id || 0 : 0);
        const incoming = Array.isArray(value) ? value : (value as { list?: unknown[] })?.list;
        if (!Array.isArray(incoming)) throw new Error("消息列表响应格式已变化");
        if (token !== generation.current) return;
        const identity = (item: Conversation | NewsReply | CirclePost) => "comment" in item ? `news:${item.comment?.id ?? item.news?.id ?? "removed"}` : item.id;
        setRows((old) => append ? [...new Map([...old, ...incoming].map((item) => [identity(item), item])).values()] : incoming);
        setLoadedFor(tab);
        setMore(tab !== "conversations" && incoming.length >= 20 && (!append || incoming.some((item) => !rows.some((old) => identity(old) === identity(item)))));
      }
      setPage(next);
      if (!append && !readOnly && (selected || tab !== "conversations")) {
        const kind = selected ? "conversation" : tab as "news-replies" | "circle-replies";
        void backend.messageRead(kind, selected?.anotherUserId || 0).then(async () => {
          if (token === generation.current) onRead(kind);
          const value = await backend.messages<{ totalCount: number }>("unread");
          if (token === generation.current) setUnread(value.totalCount);
        }).catch((e) => { if (token === generation.current) setError(`内容已读取，${errorText(e)}`); });
      }
    } catch (e) { if (token === generation.current) setError(errorText(e)); }
    finally { if (token === generation.current) setBusy(false); }
  }
  useEffect(() => {
    let live = true;
    if (profile.id) void backend.messages<{ totalCount: number }>("unread").then((value) => { if (live) setUnread(value.totalCount); }).catch(() => { if (live) setUnread(null); });
    return () => { live = false; };
  }, [profile.id]);
  useEffect(() => {
    setRows([]); setMessages([]); setMore(false); setError("");
    void load();
    return () => { generation.current += 1; };
  }, [profile.id, tab, selected?.anotherUserId]);
  useEffect(() => { setSelected(null); setTab(initialTab); }, [initialTab]);
  function refresh() {
    void load();
    if (!profile.id) return;
    const token = generation.current;
    void backend.messages<{ totalCount: number }>("unread").then((value) => {
      if (token === generation.current) setUnread(value.totalCount);
    }).catch(() => {});
  }
  async function openLink(raw: string) {
    try {
      const id = articleId(raw);
      if (id) { onArticle(id); return; }
      const url = new URL(raw);
      const post = url.hostname === "quan.ithome.com" && url.pathname.match(/^\/(?:0\/)?(\d+)$/);
      if (post) { onPost(Number(post[1])); return; }
      await backend.external(raw);
    } catch (e) { setError(errorText(e)); }
  }
  return <section className="message-page official-page" aria-label="消息中心">
    <header className="message-heading"><h1>消息</h1><span className="muted tiny">{unread === null ? "" : `未读 ${unread}`}</span>
      <Button appearance="subtle" icon={<ArrowSyncRegular />} aria-label="刷新消息" disabled={busy} onClick={refresh} /></header>
    <div className="message-tabs" role="tablist" aria-label="消息分类">{([["conversations", "会话与通知"], ["news-replies", "新闻回复"], ["circle-replies", "圈子回复"]] as const).map(([id, name]) =>
      <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setSelected(null); setTab(id); }}>{name}</button>)}</div>
    {!profile.id ? <div className="empty-state"><AlertRegular /><p>登录后查看消息和回复</p><Button appearance="primary" onClick={onLogin}>登录账号</Button></div> : <>
      {selected && <div className="message-detail-heading"><Button icon={<ArrowLeftRegular />} appearance="subtle" onClick={() => setSelected(null)}>返回消息列表</Button><strong>{selected.anotherUserBaseInfoModel?.userNick || "系统通知"}</strong></div>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {busy && <Spinner size="tiny" label="正在读取消息" />}
      <div className="message-list">
        {selected ? (loadedFor === contextKey ? [...messages] : []).sort((a, b) => (a.createTime || "").localeCompare(b.createTime || "")).map((item) => <article className={`message-item ${item.fromUserId === profile.id ? "self" : ""}`} key={String(item.messageId ?? item.id)}>
          <time className="muted tiny">{displayDate(item.createTime)}</time><div className="message-copy">
          {(item.contentType === 2 ? item.systemNotifyElements : item.contentElements)?.map((element, index) => element.link ? <button className="message-link" key={index} onClick={() => void openLink(element.link!)}><CommentText value={element.content || "查看详情"} /></button> : <CommentText key={index} value={element.content || ""} />)}
          {item.contentType === 1 && item.image?.url && <CachedImage src={item.image.url} className="message-image" alt="消息图片" onClick={(display) => onImage(item.image!.url, display)} />}
          {![0, 1, 2].includes(item.contentType) && <span>请使用官方客户端查看此类消息。</span>}
          {item.link && <Button appearance="subtle" size="small" onClick={() => void openLink(item.link!)}>查看详情</Button>}</div>
        </article>) : (loadedFor === contextKey ? rows : []).map((row, rowIndex) => {
          if (tab === "conversations") {
            const item = row as Conversation;
            return <article className="message-conversation" key={item.id}>
              <UserAvatar id={item.anotherUserId > 0 ? item.anotherUserId : 0} name={item.anotherUserBaseInfoModel?.userNick || "系统通知"} src={item.anotherUserBaseInfoModel?.userAvatar} size={44} />
              <button className="message-summary" onClick={() => { if (item.anotherUserId) setSelected(item); else if (item.anotherUserBaseInfoModel?.link) void openLink(item.anotherUserBaseInfoModel.link); }}><strong>{item.anotherUserBaseInfoModel?.userNick || "系统通知"}</strong><span>{item.summary || "暂无消息摘要"}</span></button>
              <span className="message-date"><time>{displayDate(item.lastTime)}</time>{item.notReadMessageCount > 0 && <b>{item.notReadMessageCount}</b>}</span>
            </article>;
          }
          const news = tab === "news-replies" ? row as NewsReply : null;
          const circle = tab === "circle-replies" ? row as CirclePost : null;
          const user = news?.comment?.userInfo || circle?.user;
          return <article className="message-reply" key={tab === "news-replies" ? `news:${news?.comment?.id ?? rowIndex}` : `circle:${circle?.id ?? rowIndex}`}>
            <UserAvatar id={user?.id || 0} name={user?.userNick || "家友"} src={user?.userAvatar} size={40} />
            <div><strong>{user?.userNick || "家友"}</strong><div className="comment-meta"><time>{displayDate(news?.comment?.postTime || circle?.createTime || "")}</time>{(news?.comment?.deviceTailModel || circle?.deviceTailModel) && <DeviceSource value={(news?.comment?.deviceTailModel || circle?.deviceTailModel)!} />}</div>
              <div className="comment-content">{(Array.isArray(news?.comment?.elements) ? news.comment.elements : Array.isArray(circle?.contents) ? circle.contents : []).map((element, index) => <CommentText key={index} value={element.content || ""} />)}</div>
              <Button appearance="subtle" size="small" onClick={() => news ? onArticle(news.news!.id) : onPost(circle!.contentId!)} disabled={news ? !news.news?.id : !circle?.contentId}>{news?.news?.title || "打开原帖"}</Button>
            </div></article>;
        })}
      {!busy && !(selected ? messages : rows).length && !error && <div className="empty-state"><AlertRegular /><p>{selected ? "这条会话暂无可读取的消息" : "暂时没有消息"}</p>{selected && <p className="muted tiny">{selected.summary}</p>}</div>}
      {more && <Button className="load-more" appearance="subtle" disabled={busy} onClick={() => void load(true)}>{selected ? "更早的消息" : "加载更多"}</Button>}
      </div>
      <p className="muted tiny message-note">{readOnly ? "只读模式：保留官方未读状态" : "打开分类后同步已读状态"} · 通知可在设置中开启</p>
    </>}
  </section>;
}
