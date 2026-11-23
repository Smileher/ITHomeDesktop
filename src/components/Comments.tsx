import { useEffect, useRef, useState } from 'react';
import { Avatar, Button, Spinner, Textarea } from '@fluentui/react-components';
import { ArrowReplyRegular, ArrowSyncRegular, ThumbLikeRegular } from '@fluentui/react-icons';
import { backend } from '../bridge';
import { displayDate, errorText, mergeComments } from '../domain';
import type { Article, CommentsPage, OfficialComment, Profile } from '../types';
import CachedImage from './CachedImage';
import officialEmojis from '../emoji.json';

export interface DraftSnapshot { id:number;reply:number;account:number;body:string }
export function CommentText({value}:{value:string}) {
  const names=officialEmojis as Record<string,string>;
  return <>{value.split(/(\[[^\]\n]+\])/g).map((part,index)=>{
    const slug=part.startsWith('[')?names[part.slice(1,-1)]:undefined;
    return slug?<img key={index} className="official-emoji" src={`https://img.ithome.com/app/emotion/svg/rm_e_${slug}.svg`} alt={part} loading="lazy"/>:<span key={index}>{part}</span>;
  })}</>;
}
function Thread({comment,article,depth=0,onReply,onError,onImage,onLogin}:{comment:OfficialComment;article:Article;depth?:number;onReply:(c:OfficialComment)=>void;onError:(s:string)=>void;onImage:(s:string)=>void;onLogin:()=>void}) {
  const [children,setChildren]=useState(comment.children||[]);const [expanded,setExpanded]=useState(false);const [loading,setLoading]=useState(false);const [vote,setVote]=useState({count:comment.support,active:comment.voteStatus===1});
  const knownChildren=expanded?children:children.slice(0,3);
  useEffect(()=>{setVote({count:comment.support,active:comment.voteStatus===1});setChildren(comment.children||[]);setExpanded(false);},[comment]);
  async function expand(){setLoading(true);try{const result=await backend.children(article.item.id,article.sn,comment.id);setChildren(Array.isArray(result)?result:result.children||[]);setExpanded(true);}catch(e){onError(errorText(e));}finally{setLoading(false);}}
  async function voteClick(){setLoading(true);try{const result=await backend.vote(comment.id,vote.active);const count=Number(result.message);setVote({count:Number.isFinite(count)?count:vote.count+(vote.active?-1:1),active:!vote.active});}catch(e){onError(errorText(e));if(errorText(e).includes('登录'))onLogin();}finally{setLoading(false);}}
  return <div className={`comment-thread ${depth?'nested':''}`}>
    <Avatar name={comment.userInfo?.userNick||'家友'} image={comment.userInfo?.userAvatar?{src:comment.userInfo.userAvatar}:undefined} size={depth?24:32}/>
    <div className="comment-main"><div className="comment-byline"><strong>{comment.userInfo?.userNick||'家友'}</strong>{comment.userInfo?.level!==undefined&&<span>Lv.{comment.userInfo.level}</span>}<span className="push-right">{comment.floorStr}</span></div><div className="comment-meta">{comment.city} · {displayDate(comment.postTime)}</div>
      {comment.replyUserInfo?.userNick&&<div className="reply-to">回复 {comment.replyUserInfo.userNick}</div>}
      <div className="comment-content">{comment.elements?.map((element,index)=>element.type===0?<CommentText key={index} value={element.content||''}/>:element.type===1&&element.src?<CachedImage key={index} src={element.src.startsWith('//')?'https:'+element.src:element.src} className="comment-image" alt="评论图片" onClick={()=>onImage(element.src!)}/>:<span key={index}>{element.content||element.link||''}</span>)}</div>
      {typeof comment.deviceTailModel==='string'&&comment.deviceTailModel&&<div className="muted tiny">{comment.deviceTailModel}</div>}
      {comment.aiHint&&<div className="muted tiny">{comment.aiHint}</div>}
      <div className="comment-actions"><Button appearance="subtle" size="small" icon={<ThumbLikeRegular/>} aria-pressed={vote.active} onClick={()=>void voteClick()} disabled={loading}>{vote.count||'赞'}</Button><Button appearance="subtle" size="small" icon={<ArrowReplyRegular/>} onClick={()=>onReply(comment)}>回复</Button></div>
      {depth<3&&knownChildren.map(child=><Thread key={child.id} comment={child} article={article} depth={depth+1} onReply={onReply} onError={onError} onImage={onImage} onLogin={onLogin}/>)}
      {(comment.expandCount!>children.length||(!expanded&&children.length>3))&&<Button appearance="subtle" size="small" onClick={()=>void expand()} disabled={loading}>{loading?'加载中…':'展开更多回复'}</Button>}
    </div>
  </div>;
}

export default function Comments({article,profile,refreshKey,onLogin,onError,onImage,registerFlush}:{article:Article;profile:Profile;refreshKey:number;onLogin:()=>void;onError:(s:string)=>void;onImage:(s:string)=>void;registerFlush:(flush:()=>Promise<void>)=>void}) {
  const [page,setPage]=useState<CommentsPage|null>(null);const [error,setError]=useState('');const [loading,setLoading]=useState(false);const [more,setMore]=useState(false);const [tab,setTab]=useState<'hot'|'new'|'earliest'>('hot');
  const [reply,setReply]=useState<OfficialComment|null>(null);const [body,setBody]=useState('');const [draftStatus,setDraftStatus]=useState('');const [sending,setSending]=useState(false);const [saved,setSaved]=useState(false);
  const context=useRef(0);const generation=useRef(0);const pending=useRef<DraftSnapshot|null>(null);const timer=useRef<ReturnType<typeof setTimeout>|null>(null);const queue=useRef<Promise<void>>(Promise.resolve());const input=useRef<HTMLTextAreaElement>(null);const ready=useRef(false);const head=useRef<HTMLDivElement>(null);
  const flush=async()=>{if(timer.current)clearTimeout(timer.current);const snapshot=pending.current;if(snapshot){pending.current=null;const write=queue.current.catch(()=>{}).then(()=>backend.saveDraft(snapshot.id,snapshot.reply,snapshot.body,snapshot.account));queue.current=write;try{await write;setDraftStatus(snapshot.body?'草稿已保存':'');}catch(e){if(!pending.current)pending.current=snapshot;setDraftStatus('草稿保存失败');throw e;}}else await queue.current;};
  const latestFlush=useRef(flush);latestFlush.current=flush;
  useEffect(()=>{registerFlush(()=>latestFlush.current());return()=>{registerFlush(async()=>{});void latestFlush.current().catch(e=>onError(errorText(e)));};},[registerFlush]);
  useEffect(()=>{const token=++context.current;ready.current=false;setBody('');setDraftStatus('');setSaved(false);void backend.draft(article.item.id,reply?.id||0).then(value=>{if(token===context.current){setBody(value);setDraftStatus(value?'已恢复草稿':'');ready.current=true;}}).catch(e=>{if(token===context.current)onError(errorText(e));});return()=>{context.current+=1;};},[article.item.id,reply?.id,profile.id]);
  useEffect(()=>{setReply(null);},[article.item.id]);
  async function load(append=false){const token=++generation.current;setLoading(true);setError('');try{const cursor=append?page?.comments.at(-1)?.id||0:0;const value=await backend.comments(article.item.id,article.sn,cursor,tab==='earliest');if(token!==generation.current)return;setPage(old=>({...value,comments:append?mergeComments(old?.comments||[],value.comments||[]):value.comments||[],hotComments:append?old?.hotComments:value.hotComments}));setMore((value.comments||[]).length>0);}catch(e){if(token===generation.current)setError(errorText(e));}finally{if(token===generation.current)setLoading(false);}}
  useEffect(()=>{setPage(null);void load();return()=>{generation.current+=1;};},[article.item.id,tab,refreshKey]);
  function edit(value:string){setBody(value);setSaved(false);if(!ready.current)return;pending.current={id:article.item.id,reply:reply?.id||0,body:value,account:profile.id};setDraftStatus('正在保存…');if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>{void flush().catch(e=>onError(errorText(e)));},350);}
  async function changeReply(value:OfficialComment|null){try{await flush();setReply(value);input.current?.focus();}catch(e){onError(errorText(e));}}
  async function send(){if(!profile.id){onLogin();return;}if(!body.trim())return;setSending(true);try{await flush();const result=await backend.submit(article.item.id,reply?.id||0,body);setSaved(true);setDraftStatus(result.message||'已提交，等待官方结果');await load();if(result.content){pending.current={id:article.item.id,reply:reply?.id||0,body:'',account:profile.id};await flush();setBody('');setReply(null);}else{setDraftStatus((result.message||'已提交')+' · 草稿保留');}}catch(e){onError(errorText(e));}finally{setSending(false);}}
  const list=tab==='hot'&&page?.hotComments?.length?page.hotComments:page?.comments||[];
  const allowed=!article.item.forbidComment&&(!page||page.canComment);
  return <section className="comments" ref={head} aria-label="家友评论"><div className="comments-header"><h2>家友评论</h2><span className="muted tiny">{article.item.comments||''}</span><div className="push-right comment-tabs">{([['hot','热门'],['new','最新'],['earliest','最早']] as const).map(([id,name])=><Button key={id} size="small" appearance="subtle" aria-pressed={tab===id} onClick={()=>setTab(id)}>{name}</Button>)}<Button size="small" appearance="subtle" icon={<ArrowSyncRegular/>} aria-label="刷新评论" onClick={()=>void load()} disabled={loading}/></div></div>
    {error&&<div className="inline-error" role="alert">{error}<Button size="small" onClick={()=>void load()}>重试</Button></div>}
    {!page&&loading&&<Spinner size="tiny" label="正在读取评论"/>}
    {list.map(comment=><Thread key={comment.id} comment={comment} article={article} onReply={c=>void changeReply(c)} onError={onError} onImage={onImage} onLogin={onLogin}/>)}
    {page&&!list.length&&!loading&&<p className="empty-inline">还没有评论，来聊聊你的看法。</p>}
    {page&&tab!=='hot'&&more&&<Button appearance="subtle" onClick={()=>void load(true)} disabled={loading}>{loading?'加载中…':'加载更多评论'}</Button>}
    {page&&tab==='hot'&&!page.hotComments?.length&&more&&<Button appearance="subtle" onClick={()=>setTab('new')}>查看全部评论</Button>}
    <div className="composer">{reply&&<div className="composer-reply">回复 {reply.userInfo.userNick} · {reply.floorStr}<Button appearance="subtle" size="small" onClick={()=>void changeReply(null)}>取消回复</Button></div>}<Textarea ref={input} value={body} onChange={(_,data)=>edit(data.value)} placeholder={allowed?'聊聊你的看法…':page?.cannotCommentTip||'本文已关闭评论'} disabled={!allowed||sending} resize="vertical" appearance="outline" aria-label="评论草稿" onKeyDown={event=>{if(event.ctrlKey&&event.key==='Enter'){event.preventDefault();void send();}}}/><div className="composer-footer"><span className="muted tiny" role="status">{draftStatus||page?.ruleHint||'愿每句评论都带来思考'}</span><Button appearance="primary" onClick={()=>void send()} disabled={!allowed||sending||saved||(!body.trim()&&!!profile.id)}>{sending?'提交中…':profile.id?'发表评论':'登录后评论'}</Button></div></div>
  </section>;
}
