import { useEffect, useRef, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Textarea } from "@fluentui/react-components";
import { backend } from "../bridge";
import { errorText } from "../domain";
import type { CircleTopic } from "../types";

export default function CircleComposer({ id, reply, name, topics, initialTopic, account, readOnly, registerFlush, onClose, onSent }: {
  id: number; reply: number; name: string; topics: CircleTopic[]; initialTopic: number; account: number; readOnly: boolean;
  registerFlush: (flush: () => Promise<void>) => void; onClose: () => void; onSent: () => void;
}) {
  const [topic, setTopic] = useState(initialTopic || topics[0]?.id || 0);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const pending = useRef<{ topic: number; body: string } | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(true);
  const inFlight = useRef(false);
  async function flush() {
    if (timer.current) clearTimeout(timer.current);
    const value = pending.current;
    if (!value) { await queue.current; return; }
    pending.current = null;
    const write = queue.current.catch(() => {}).then(() => backend.saveCircleDraft(id, reply, value.topic, value.body, account));
    queue.current = write;
    try { await write; if (live.current) setStatus(value.body ? "草稿已保存" : ""); }
    catch (e) { if (!pending.current) pending.current = value; throw e; }
  }
  const latestFlush = useRef(flush);
  latestFlush.current = flush;
  useEffect(() => {
    live.current = true;
    registerFlush(() => latestFlush.current());
    return () => {
      live.current = false;
      registerFlush(async () => {});
      void latestFlush.current().catch(() => {});
    };
  }, [registerFlush]);
  useEffect(() => {
    let active = true;
    setReady(false); setBody(""); setError("");
    void backend.circleDraft(id, reply, id ? 0 : topic).then((value) => {
      if (active) { setBody(value); setStatus(value ? "已恢复草稿" : ""); setReady(true); }
    }).catch((e) => { if (active) setError(errorText(e)); });
    return () => { active = false; };
  }, [id, reply, topic, account]);
  function edit(value: string) {
    setBody(value); setError("");
    pending.current = { topic: id ? 0 : topic, body: value };
    setStatus("正在保存…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush().catch((e) => { if (live.current) setError(errorText(e)); }), 350);
  }
  async function close() {
    if (inFlight.current) return;
    try { await flush(); onClose(); } catch (e) { setError(errorText(e)); }
  }
  async function send() {
    if (!ready || readOnly || inFlight.current || sent || !body.trim() || (!id && !topic)) return;
    inFlight.current = true; setSending(true); setError("");
    try {
      await flush();
      await backend.circleAction(id ? "reply" : "post", id, reply, id ? 0 : topic, body);
      if (!live.current) return;
      // A confirmed submission must stay disabled even if local draft cleanup fails.
      setSent(true); setStatus("已提交，以官方审核结果为准");
      pending.current = { topic: id ? 0 : topic, body: "" };
      await flush();
      if (live.current) { onSent(); onClose(); }
    } catch (e) { if (live.current) setError(errorText(e)); }
    finally { inFlight.current = false; if (live.current) setSending(false); }
  }
  return <Dialog open onOpenChange={(_, data) => { if (!data.open) void close(); }}><DialogSurface className="compose-dialog"><DialogBody>
    <DialogTitle>{id ? name ? `回复 ${name}` : "评论帖子" : "发布圈子动态"}</DialogTitle>
    <DialogContent><div className="composer">
      {!id && <label className="circle-topic-select">选择话题<select aria-label="发帖话题" disabled={sending || !ready || sent} value={topic} onChange={(event) => {
        const value = Number(event.target.value);
        void flush().then(() => setTopic(value)).catch((e) => setError(errorText(e)));
      }}>{!topics.length && <option value={0}>请先刷新圈子加载话题</option>}{topics.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
      <Textarea aria-label="圈子草稿" placeholder={id ? "聊聊你的看法…" : "分享你的科技生活…"} value={body} onChange={(_, data) => edit(data.value)} disabled={!ready || sending || sent || readOnly} resize="vertical" autoFocus
        onKeyDown={(event) => { if (event.ctrlKey && event.key === "Enter") { event.preventDefault(); void send(); } }} />
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="composer-footer"><span role="status" className="muted tiny">{status || "文字动态 · 由官方服务审核"}</span><Button appearance="primary" disabled={!ready || sending || sent || readOnly || !body.trim() || (!id && !topic)} onClick={() => void send()}>{sending ? "提交中…" : id ? "发表回复" : "发布动态"}</Button></div>
    </div></DialogContent><DialogActions><Button disabled={sending} onClick={() => void close()}>暂存并关闭</Button></DialogActions>
  </DialogBody></DialogSurface></Dialog>;
}
