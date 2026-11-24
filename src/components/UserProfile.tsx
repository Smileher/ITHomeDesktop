import { useEffect, useRef, useState } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import { ArrowSyncRegular, ArrowUpRightRegular } from "@fluentui/react-icons";
import { backend } from "../bridge";
import { accountRows } from "../account-domain";
import type { AccountRow } from "../account-domain";
import { displayDate, errorText } from "../domain";
import UserAvatar from "./UserAvatar";
import CachedImage from "./CachedImage";
import { CommentText, DeviceSource } from "./Comments";

interface PublicProfile {
  nickname: string; rank: number; regtime: string; iplocation?: string;
  commentcount: number; newquancontentcount: number; newquancommentcount: number;
}
export default function UserProfile({ id, name, own = false, onArticle, onPost }: {
  id: number; name: string; own?: boolean; onArticle: (id: number) => void; onPost: (id: number) => void;
}) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [tab, setTab] = useState<"comments" | "posts" | "replies">("comments");
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [error, setError] = useState("");
  const [profileError, setProfileError] = useState("");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    let live = true;
    setProfile(null); setProfileError("");
    void backend.user<PublicProfile>("profile", id).then((value) => { if (live) setProfile(value); })
      .catch((error) => { if (live) setProfileError(errorText(error)); });
    return () => { live = false; };
  }, [id]);
  async function load(append = false) {
    const token = ++generation.current;
    setLoading(true); setError("");
    try {
      const next = append ? page + 1 : 1;
      const cursor = append ? Number(rows.at(-1)?.id || 0) : 0;
      const data = own && tab !== "replies" ? await backend.account(tab, next, cursor) : await backend.user(tab, id, next, cursor);
      const incoming = accountRows(tab, data);
      if (token !== generation.current) return;
      setRows((current) => append ? [...new Map([...current, ...incoming].map((row) => [row.id, row])).values()] : incoming);
      setPage(next);
      setMore(incoming.length > 0 && (!append || incoming.some((row) => !rows.some((old) => old.id === row.id))));
    } catch (error) {
      if (token === generation.current) setError(errorText(error));
    } finally { if (token === generation.current) setLoading(false); }
  }
  useEffect(() => {
    setRows([]); setPage(1); setMore(false); void load();
    return () => { generation.current += 1; };
  }, [id, tab]);
  return <section className="user-profile">
    <div className="profile-cover">
      <UserAvatar id={id} name={profile?.nickname || name} size={72} interactive={false} />
      <div className="profile-title"><span className="eyebrow">{own ? "我的个人主页" : "家友主页"}</span><h2>{profile?.nickname || name}</h2>
        <div className="profile-badges">{profile && <span className="profile-level">Lv.{profile.rank}</span>}<span>ID {id}</span>{profile?.iplocation && <span>IP 属地：{profile.iplocation}</span>}</div>
        {profile?.regtime && !profile.regtime.startsWith("0001") && <p className="muted tiny">加入于 {profile.regtime.slice(0, 10)}</p>}
      </div>
      {own && <Button appearance="subtle" icon={<ArrowUpRightRegular />} onClick={() => void backend.official("edit-profile").catch((error) => setError(errorText(error)))}>编辑资料</Button>}
    </div>
    {profileError && <p className="muted tiny">资料暂未更新：{profileError}</p>}
    <div className="profile-tabs" aria-label="个人主页内容">
      {([ ["comments", "文章评论", profile?.commentcount], ["posts", "主题帖", profile?.newquancontentcount], ["replies", "回帖", profile?.newquancommentcount] ] as const).map(([value, title, count]) => <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{title}{count !== undefined && <span>{count}</span>}</button>)}
      <Button appearance="subtle" aria-label="刷新个人主页" icon={<ArrowSyncRegular />} disabled={loading} onClick={() => void load()} />
    </div>
    {error && <div className="inline-error" role="alert">{error}<Button size="small" onClick={() => void load()}>重试</Button></div>}
    {rows.map((row) => <article className="profile-entry" key={row.id}>
      <div className="comment-meta"><time>{displayDate(row.date)}</time>{row.tail && <DeviceSource value={row.tail} />}</div>
      {row.text && <div className="comment-content"><CommentText value={row.text} /></div>}
      {row.image && <CachedImage src={row.image} alt="帖子图片" className="profile-entry-image" />}
      <button className="profile-source" disabled={!row.newsId && !row.postId} onClick={() => row.newsId ? onArticle(row.newsId) : row.postId && onPost(row.postId)}><span>{row.newsId ? "原文" : "帖子"}</span>{row.title || "查看原帖"}<span>›</span></button>
    </article>)}
    {loading && <Spinner size="small" label="正在读取个人主页" />}
    {!loading && !rows.length && !error && <div className="empty-inline">暂时没有公开内容</div>}
    {more && <Button className="load-more" appearance="subtle" disabled={loading} onClick={() => void load(true)}>{loading ? "加载中…" : "加载更多"}</Button>}
  </section>;
}
