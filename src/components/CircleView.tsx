import { useEffect, useRef, useState } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import {
  ArrowLeftRegular,
  ArrowSyncRegular,
  CommentRegular,
  ThumbLikeRegular,
} from "@fluentui/react-icons";
import { backend } from "../bridge";
import { displayDate, errorText } from "../domain";
import type {
  CircleComments,
  CircleKind,
  CirclePage,
  CirclePost,
  CircleTopic,
} from "../types";
import CachedImage from "./CachedImage";
import { CommentText, DeviceSource } from "./Comments";
import UserAvatar from "./UserAvatar";

function PostContent({
  post,
  preview,
  onImage,
}: {
  post: CirclePost;
  preview?: boolean;
  onImage: (source: string, display?: string) => void;
}) {
  const pictures = post.pictures || [];
  return (
    <>
      {post.title && <h2 className="circle-post-title">{post.title}</h2>}
      <div
        className={`comment-content circle-copy ${preview ? "preview" : ""}`}
      >
        {post.contents?.map((element, index) =>
          element.type === 0 ? (
            <CommentText key={index} value={element.content || ""} />
          ) : element.src &&
            !pictures.some((picture) => picture.src === element.src) ? (
            <CachedImage
              key={index}
              src={element.src}
              alt="圈子图片"
              className="comment-image"
              onClick={(display) => onImage(element.src!, display)}
            />
          ) : (
            <span key={index}>{element.content || ""}</span>
          ),
        )}
      </div>
      {!!pictures.length && (
        <div
          className={`circle-pictures ${pictures.length === 1 ? "single" : ""}`}
        >
          {pictures.slice(0, preview ? 3 : undefined).map((picture, index) => (
            <CachedImage
              key={index}
              src={picture.thumbSrc || picture.src}
              alt="圈子图片"
              onClick={(display) =>
                onImage(picture.originSrc || picture.src, display)
              }
            />
          ))}
        </div>
      )}
      {!!post.videos?.length && (
        <p className="muted tiny">本帖含视频，请在官方客户端播放。</p>
      )}
    </>
  );
}
function Identity({ post }: { post: CirclePost }) {
  return (
    <div className="circle-identity">
      <UserAvatar
        id={post.user?.id || 0}
        name={post.user?.userNick || "家友"}
        src={post.user?.userAvatar}
        size={40}
      />
      <div className="circle-person">
        <div>
          <strong>{post.user?.userNick || "家友"}</strong>
          {post.user?.level !== undefined && (
            <span className="comment-level">Lv.{post.user.level}</span>
          )}
          {post.contentFlagTitle && (
            <span className="news-badge pinned">{post.contentFlagTitle}</span>
          )}
        </div>
        <div className="comment-meta">
          <time>{displayDate(post.createTime)}</time>
          {post.location && <span>{post.location}</span>}
          {post.deviceTailModel && (
            <DeviceSource value={post.deviceTailModel} />
          )}
        </div>
      </div>
      {post.floorStr && (
        <span className="circle-floor muted tiny">{post.floorStr}</span>
      )}
    </div>
  );
}
function CircleReply({
  post,
  contentId,
  onImage,
  blockedIds,
}: {
  post: CirclePost;
  contentId: number;
  onImage: (source: string, display?: string) => void;
  blockedIds: Set<number>;
}) {
  const [replies, setReplies] = useState(post.replyComments || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function expand() {
    setBusy(true);
    setError("");
    try {
      const value = await backend.circle<{ comment?: CirclePost } & CirclePost>(
        "floor",
        post.id,
        1,
        contentId,
      );
      setReplies(
        value.data.comment?.replyComments || value.data.replyComments || [],
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="circle-comment">
      <Identity post={post} />
      {post.replyUser && (
        <div className="reply-to">回复 {post.replyUser.userNick}</div>
      )}
      <PostContent post={post} onImage={onImage} />
      <div className="circle-counts muted tiny">
        <ThumbLikeRegular /> {post.support || 0}
      </div>
      {replies
        .filter((reply) => !blockedIds.has(reply.user?.id))
        .map((reply) => (
          <div className="circle-reply" key={reply.id}>
            <Identity post={reply} />
            <PostContent post={reply} onImage={onImage} />
          </div>
        ))}
      {(post.replyCount || 0) > replies.length && (
        <Button
          appearance="subtle"
          disabled={busy}
          onClick={() => void expand()}
        >
          {busy ? "加载中…" : `查看回复（${post.replyCount}）`}
        </Button>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export default function CircleView({
  onImage,
  initialId = 0,
  blockedIds,
}: {
  onImage: (source: string, display?: string) => void;
  initialId?: number;
  blockedIds: Set<number>;
}) {
  const [tab, setTab] = useState<"latest" | "recommend">("latest");
  const [menu, setMenu] = useState(2000000002);
  const [topic, setTopic] = useState<CircleTopic | null>(null);
  const [topics, setTopics] = useState<CircleTopic[]>([]);
  const [posts, setPosts] = useState<CirclePost[]>([]);
  const [page, setPage] = useState(1);
  const [stamp, setStamp] = useState("");
  const [more, setMore] = useState(false);
  const [selected, setSelected] = useState<CirclePost | null>(null);
  const [comments, setComments] = useState<CirclePost[]>([]);
  const [commentPage, setCommentPage] = useState(1);
  const [commentMore, setCommentMore] = useState(false);
  const [sort, setSort] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [error, setError] = useState("");
  const [commentError, setCommentError] = useState("");
  const [offline, setOffline] = useState(false);
  const generation = useRef(0);
  const detailGeneration = useRef(0);
  const commentGeneration = useRef(0);
  const scroll = useRef<HTMLDivElement>(null);
  async function load(append = false, refresh = false) {
    const token = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const next = append ? page + 1 : 1;
      const kind: CircleKind = topic ? "topic" : tab;
      const result = await backend.circle<CirclePage>(
        kind,
        topic?.id || 0,
        next,
        menu,
        append ? stamp : "",
        refresh,
      );
      if (token !== generation.current) return;
      const list = result.data.list;
      if (!Array.isArray(list)) throw new Error("圈子列表响应格式已变化");
      const incoming = list
        .filter((item) => item.feedType === 2 && item.feedContent?.id)
        .map((item) => item.feedContent);
      setPosts((current) =>
        append
          ? [
              ...new Map(
                [...current, ...incoming].map((post) => [post.id, post]),
              ).values(),
            ]
          : incoming,
      );
      const hot = list.find((item) => item.feedType === 7)?.feedContent.data;
      if (hot) setTopics(hot);
      setPage(next);
      setStamp(result.data.pageStamp || "");
      setMore(incoming.length > 0 && result.data.leftCount !== 0);
      setOffline(result.stale);
    } catch (e) {
      if (token === generation.current) setError(errorText(e));
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    setPosts([]);
    setSelected(null);
    setComments([]);
    detailGeneration.current += 1;
    void load();
    return () => {
      generation.current += 1;
    };
  }, [tab, menu, topic?.id]);
  useEffect(
    () => () => {
      detailGeneration.current += 1;
      commentGeneration.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (!initialId) return;
    const token = ++detailGeneration.current;
    setDetailLoading(true);
    void backend
      .circle<CirclePost>("detail", initialId)
      .then((value) => {
        if (token === detailGeneration.current) setSelected(value.data);
      })
      .catch((e) => {
        if (token === detailGeneration.current) setError(errorText(e));
      })
      .finally(() => {
        if (token === detailGeneration.current) setDetailLoading(false);
      });
  }, [initialId]);
  async function open(post: CirclePost) {
    const token = ++detailGeneration.current;
    setSelected(post);
    setDetailLoading(true);
    setError("");
    scroll.current?.scrollTo(0, 0);
    try {
      const value = await backend.circle<CirclePost>("detail", post.id);
      if (token === detailGeneration.current) setSelected(value.data);
    } catch (e) {
      if (token === detailGeneration.current) setError(errorText(e));
    } finally {
      if (token === detailGeneration.current) setDetailLoading(false);
    }
  }
  async function loadComments(append = false) {
    if (!selected) return;
    const token = ++commentGeneration.current;
    setCommentsLoading(true);
    setCommentError("");
    try {
      const next = append ? commentPage + 1 : 1;
      const value = await backend.circle<CircleComments & { total?: number }>(
        "comments",
        selected.id,
        next,
        sort,
      );
      if (token !== commentGeneration.current) return;
      if (!Array.isArray(value.data.list))
        throw new Error("圈子评论响应格式已变化");
      setComments((current) =>
        append
          ? [
              ...new Map(
                [...current, ...value.data.list].map((comment) => [
                  comment.id,
                  comment,
                ]),
              ).values(),
            ]
          : value.data.list,
      );
      setCommentPage(next);
      setCommentMore(
        value.data.list.length > 0 &&
          (value.data.total === undefined
            ? value.data.list.length >= 20
            : next * 20 < value.data.total),
      );
    } catch (e) {
      if (token === commentGeneration.current) setCommentError(errorText(e));
    } finally {
      if (token === commentGeneration.current) setCommentsLoading(false);
    }
  }
  useEffect(() => {
    setComments([]);
    if (selected) void loadComments();
    return () => {
      commentGeneration.current += 1;
    };
  }, [selected?.id, sort]);
  const menus =
    tab === "latest"
      ? ([
          [2000000002, "最新回复"],
          [2000000001, "最新主帖"],
          [2000000011, "最新评价"],
        ] as const)
      : ([
          [2000000012, "推荐"],
          [2000000003, "热门"],
          [2000000004, "精华"],
        ] as const);
  return (
    <section className="circle-page" aria-label="圈子">
      <header className="circle-heading">
        <h1>{topic?.name || "圈子"}</h1>
        <span className="muted tiny">{offline ? "离线缓存" : "公开圈子"}</span>
        <Button
          appearance="subtle"
          icon={<ArrowSyncRegular />}
          aria-label="刷新圈子"
          disabled={loading}
          onClick={() => void load(false, true)}
        />
      </header>
      <div className="circle-layout">
        <div className={`circle-feed ${selected ? "has-selection" : ""}`}>
          <div className="channel-tabs" role="tablist" aria-label="圈子分类">
            {(["latest", "recommend"] as const).map((id) => (
              <button
                key={id}
                role="tab"
                aria-selected={!topic && tab === id}
                onClick={() => {
                  setTopic(null);
                  setTab(id);
                  setMenu(id === "latest" ? 2000000002 : 2000000012);
                }}
              >
                {id === "latest" ? "最新" : "推荐"}
              </button>
            ))}
            {topic && (
              <button role="tab" aria-selected onClick={() => setTopic(null)}>
                {topic.name} ×
              </button>
            )}
          </div>
          <div className="circle-feed-scroll">
            {!topic && !!topics.length && (
              <section className="circle-topics" aria-label="热门话题">
                <h2>热门话题</h2>
                <div>
                  {topics.map((item) => (
                    <button key={item.id} onClick={() => setTopic(item)}>
                      {item.logo && <CachedImage src={item.logo} alt="" />}
                      <span>{item.name}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {!topic && (
              <div className="circle-sort">
                {menus.map(([id, name]) => (
                  <button
                    key={id}
                    aria-pressed={menu === id}
                    onClick={() => setMenu(id)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
            {error && (
              <div className="inline-error" role="alert">
                {error}
                <Button size="small" onClick={() => void load(false, true)}>
                  重试
                </Button>
              </div>
            )}
            {loading && !posts.length && (
              <Spinner size="small" label="正在读取圈子" />
            )}
            {posts
              .filter((post) => !blockedIds.has(post.user?.id))
              .map((post) => (
                <article
                  className={`circle-card ${selected?.id === post.id ? "selected" : ""}`}
                  key={post.id}
                >
                  <Identity post={post} />
                  <button
                    className="circle-open"
                    onClick={() => void open(post)}
                    aria-label={`打开帖子：${post.title || post.user?.userNick}`}
                  >
                    <span>
                      <CommentText
                        value={
                          [
                            post.title,
                            post.contents
                              ?.filter((item) => item.type === 0)
                              .map((item) => item.content)
                              .join(""),
                          ]
                            .filter(Boolean)
                            .join("\n") || "图片帖子"
                        }
                      />
                    </span>
                  </button>
                  <PostContent
                    post={{ ...post, contents: [], title: undefined }}
                    preview
                    onImage={onImage}
                  />
                  <div className="circle-tags">
                    {post.topics?.map((item) => (
                      <button key={item.id} onClick={() => setTopic(item)}>
                        # {item.name}
                      </button>
                    ))}
                  </div>
                  <div className="circle-counts">
                    <span>
                      <ThumbLikeRegular /> {post.support || 0}
                    </span>
                    <button onClick={() => void open(post)}>
                      <CommentRegular /> {post.commentCount || 0}
                    </button>
                  </div>
                </article>
              ))}
            {!loading && !posts.length && !error && (
              <p className="empty-inline">暂时没有可显示的帖子。</p>
            )}
            {more && (
              <Button
                className="load-more"
                appearance="subtle"
                disabled={loading}
                onClick={() => void load(true)}
              >
                {loading ? "加载中…" : "加载更多帖子"}
              </Button>
            )}
          </div>
        </div>
        <div
          className={`circle-detail ${selected ? "is-open" : ""}`}
          ref={scroll}
        >
          {selected ? (
            <>
              <header className="circle-detail-heading">
                <Button
                  appearance="subtle"
                  icon={<ArrowLeftRegular />}
                  aria-label="返回圈子列表"
                  onClick={() => {
                    detailGeneration.current += 1;
                    setSelected(null);
                  }}
                >
                  返回列表
                </Button>
                <span className="muted tiny">帖子详情</span>
              </header>
              <div className="circle-reading">
                <Identity post={selected} />
                <PostContent post={selected} onImage={onImage} />
                {detailLoading && (
                  <Spinner size="tiny" label="正在读取完整帖子" />
                )}
                <div className="comments-header">
                  <h2>全部评论</h2>
                  <span className="muted tiny">
                    {selected.commentCount || 0}
                  </span>
                  <div className="circle-sort push-right">
                    {[
                      [0, "最新"],
                      [1, "最早"],
                      [2, "热门"],
                    ].map(([id, name]) => (
                      <button
                        key={id}
                        aria-pressed={sort === id}
                        onClick={() => setSort(Number(id))}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
                {commentError && (
                  <div className="inline-error" role="alert">
                    {commentError}
                    <Button onClick={() => void loadComments()}>重试</Button>
                  </div>
                )}
                {comments
                  .filter((post) => !blockedIds.has(post.user?.id))
                  .map((post) => (
                    <CircleReply
                      key={post.id}
                      post={post}
                      contentId={selected.id}
                      onImage={onImage}
                      blockedIds={blockedIds}
                    />
                  ))}
                {commentsLoading && (
                  <Spinner size="tiny" label="正在读取评论" />
                )}
                {commentMore && (
                  <Button
                    appearance="subtle"
                    disabled={commentsLoading}
                    onClick={() => void loadComments(true)}
                  >
                    加载更多评论
                  </Button>
                )}
                {!commentsLoading && !comments.length && !commentError && (
                  <p className="empty-inline">还没有公开评论。</p>
                )}
                <p className="muted tiny circle-readonly">
                  圈子目前支持公开浏览，发帖和互动请使用官方客户端。
                </p>
              </div>
            </>
          ) : (
            <div className="circle-welcome">
              <CommentRegular />
              <h2>与家友聊聊科技生活</h2>
              <p>从左侧选择一篇帖子</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
