# 接口依据与限制

调研日期：2026-11-24。仅列接口地址，不包含访问凭据。

| 用途 | 已观察到的官方依据 |
| --- | --- |
| 首页与频道 | `https://api.ithome.com/json/newslist/news`；核验过 news、win11、android、ios、digi、it、auto、game 的列表结构 |
| 分页 | `https://m.ithome.com/api/news/newslistpageget`；实际响应字段 `Success`、`Result`，游标来自列表的 `orderdate` |
| 正文 | `https://api.ithome.com/json/newscontent/{newsid}`；实际字段 detail、newsauthor、newssource、forbidcomment |
| 评论令牌 | PC 文章页中 `#post_comm` 的 `data-id`；按实际页面提取，不猜测签名 |
| 评论列表与展开 | 官方 `https://img.ithome.com/file/js/comment/comment.es5.min.js?v=1.1.202608201000` 中的 getnewscomment、getcommentcontent 请求 |
| 评论来源与小尾巴 | IT之家 App 公开读取协议使用 `https://cmt.ithome.com/apiv2/comment/getnewscomment?sn=...&appver=933`；`sn` 为文章 ID 经过公开 DES/ECB 编码后的值，响应中的 `deviceTailModel.name`、`extraTails` 和 `pictures` 用于补充网页评论数据 |
| 提交、点赞、取消点赞 | 同一官方脚本的 apiv2/comment/submit、api/comment/vote、api/comment/cancelvote；请求结构按脚本，不填写 device/client 参数 |
| 登录 | 搜索页实际跳转到 `https://www.ithome.com/user-login/index.htm`；官方 login.min.js 调用软媒登录面板 |
| 搜索 | 官方 site.min.js 使用 `/search/{keyword}.html`；匿名访问要求登录 |
| 好物列表 | 当前 `https://www.ithome.com/` 首页公开输出 `https://lapin.ithome.com/html/{category}/{newsid}.htm` 链接；正文 ID 可由现有资讯正文接口读取 |

官方网页的评论响应使用 `content.userId`、`userNick` 判断会话身份。客户端只把通过此核验的会话作为已同步登录，前端不接收 Cookie。

旧 `https://apiquan.ithome.com/api/post` 返回迁移提示，不能据此判断新版圈子不可用。分析用户提供的 ITHomeWinUI 2.2611.20.0 程序中的请求地址后，已用实际官方响应核验新版接口：

| 用途 | 当前接口与字段依据 |
| --- | --- |
| 新闻置顶、广告、视频 | 同一 newslist 响应中的 `toplist`、`aid`、`v`；原实现遗漏置顶并将首条新闻移至焦点区，现已恢复完整列表，刷新附带时间参数 |
| 最新圈子 | `https://qapi.ithome.com/api/home/getnewmenufeeds`，pageId=2000000004；menuId=2000000002/2000000001/2000000011；首屏使用 flowType=0、appver=933、platform=ithome_android 的读取契约 |
| 推荐圈子 | `/api/home/getrecommendedmenufeeds`，pageId=2000000002；menuId=2000000012/2000000003/2000000004 |
| 话题帖子 | `/api/topic/gettopicfeeds`，topicId、pid=0、menuId、page、stamp |
| 圈子正文、评论、楼中楼 | `/api/content/getcontentdetail`、`/api/comment/getcomments`、`/api/comment/getsinglefloorcomment`；评论排序 0=最新、1=最早、2=热门，已对照实时楼层顺序 |
| 新闻云收藏 | `https://napi.ithome.com/api/favnews/get?page=...`；addlist/deletelist 的 JSON `newsids` 数组来自参考程序请求契约 |
| 账号评论 | `https://cmt.ithome.com/apiv2/comment/getusercommentlist`；真实响应为 news/comment 对，分页游标使用 comment.id |
| 我的帖子、帖子收藏、关注 | qapi 的 `/api/content/getmycontents`、`/api/content/getstaredcontents`、`/api/user/getfollowedusers`，实际读取通过 |
| 官方黑名单 | napi 的 `/api/userselfblock/getblockusers`；实际字段 UserID、UserNick、AddTime；create/delete 使用 userId |
| 二维码登录 | 官方 `my.ruanmei.com/user-login/` 页面及其 main.49ad7041.js；微信 getwxqrcode/getwxqrcodelogininfo、App qrcodelogin/create/check 由官方页面执行，客户端仅调整显示布局并核验最终 Cookie |

账号接口需要 JWT。凭据由现有加密 Cookie 会话或官方 `loginbyuserhash` 授权流程取得，仅短暂保留在 Rust 内存，不发送至前端、不写日志。公开圈子列表不附带账号凭据；登录后的详情及评论携带授权以读取自身点赞/收藏状态，不写入公共缓存；个人黑名单在本地显示时生效。写操作只发送一次，结果不确定时要求先刷新核对。

0.1.5 补充（参考用户提供的 WinUI 客户端请求契约；消息均已做官方服务只读核验）：

| 用途 | 当前接口与字段依据 |
| --- | --- |
| 会话、未读数 | chat.ithome.com 的 `/api/conversation/getconversations`、`/api/message/getnotreadcount`；列表含 anotherUserId、summary、lastTime、notReadMessageCount，计数为 totalCount |
| 会话历史 | `/api/message/getmessages`；anotherUserId 是有符号整数，系统会话可能为负数，lastTime 为分页游标；实际空数组保留为空，不构造消息 |
| 回复我的新闻评论 | cmt 的 `/apiv2/comment/getreplymecommentlist`；news/comment 对，使用 comment.id 分页 |
| 回复我的圈子评论 | qapi 的 `/api/comment/getreplymecomments`；current/list/pageSize/total，评论关联 contentId |
| 圈子文字发帖 | `/api/content/postmicroblog`；id=0、contents、topicId、timeStamp、location、whoCanSee、bigImage。只使用真实列表中返回的话题，不伪造设备来源 |
| 圈子回复 | `/api/comment/postcomment`；contentId 和 replyCommentId 分开，contents 为服务端内容结构 |
| 圈子点赞、收藏 | `/api/content/vote`、`/api/comment/vote`（voteType=1/0）；`/api/content/star`、`/api/content/unstar`（query id）。仅隔离写测试，尚未向真实账号提交验证 |

实时对比中，无参数、r=0、时间参数的新闻源返回相同最新新闻，未证明第三方拥有更快的独立新闻源。官方 CDN 自身的更新时间仍取决于服务端。

HTTP 401、403、404、429、服务器异常和网络故障分别处理。只有网络或服务端暂时故障允许使用缓存；权限拒绝与内容移除不回退到旧内容。评论写入超时保留草稿，提示核对结果，不自动重发。

本项目未复制无许可证第三方客户端的实现代码。公开项目仅用于发现线索；运行协议以官方页面、脚本和实际响应为依据。
