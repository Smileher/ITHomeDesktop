# 接口依据与限制

调研日期：2026-11-23。仅列公开、无访问凭据的地址。

| 用途 | 已观察到的官方依据 |
| --- | --- |
| 首页与频道 | `https://api.ithome.com/json/newslist/news`；核验过 news、win11、android、ios、digi、it、auto、game 的列表结构 |
| 分页 | `https://m.ithome.com/api/news/newslistpageget`；实际响应字段 `Success`、`Result`，游标来自列表的 `orderdate` |
| 正文 | `https://api.ithome.com/json/newscontent/{newsid}`；实际字段 detail、newsauthor、newssource、forbidcomment |
| 评论令牌 | PC 文章页中 `#post_comm` 的 `data-id`；按实际页面提取，不猜测签名 |
| 评论列表与展开 | 官方 `https://img.ithome.com/file/js/comment/comment.es5.min.js?v=1.1.202608201000` 中的 getnewscomment、getcommentcontent 请求 |
| 提交、点赞、取消点赞 | 同一官方脚本的 apiv2/comment/submit、api/comment/vote、api/comment/cancelvote；请求结构按脚本，不填写 device/client 参数 |
| 登录 | 搜索页实际跳转到 `https://www.ithome.com/user-login/index.htm`；官方 login.min.js 调用软媒登录面板 |
| 搜索 | 官方 site.min.js 使用 `/search/{keyword}.html`；匿名访问要求登录 |

官方网页的评论响应使用 `content.userId`、`userNick` 判断会话身份。客户端只把通过此核验的会话作为已同步登录，前端不接收 Cookie。

旧 `https://apiquan.ithome.com/api/post` 当前返回“全新圈子社区已开启，请下载最新App使用”的迁移提示；不能用这条记录伪装成现行圈子列表。当前圈子、好物及账号相关入口使用已观察到的官方站点，由独立网页窗口承载，并明确记录原生功能缺口。

HTTP 401、403、404、429、服务器异常和网络故障分别处理。只有网络或服务端暂时故障允许使用缓存；权限拒绝与内容移除不回退到旧内容。评论写入超时保留草稿，提示核对结果，不自动重发。

本项目未复制无许可证第三方客户端的实现代码。公开项目仅用于发现线索；运行协议以官方页面、脚本和实际响应为依据。
