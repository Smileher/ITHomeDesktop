import { useEffect, useState } from "react";
import { Button } from "@fluentui/react-components";
import { ArrowDownloadRegular, ArrowUpRightRegular, CheckmarkCircleRegular, ColorRegular, TextFontRegular, PersonRegular, StorageRegular, InfoRegular, TagRegular, AlertRegular } from "@fluentui/react-icons";
import { backend } from "../bridge";
import { bytesLabel, errorText } from "../domain";
import type { Profile, Settings, Stats } from "../types";
import appLogo from "../assets/app.svg";

const categories = [
  ["appearance", "外观", ColorRegular], ["reading", "阅读", TextFontRegular],
  ["account", "账号", PersonRegular], ["notifications", "通知", AlertRegular], ["storage", "存储", StorageRegular], ["about", "关于", InfoRegular],
] as const;
type Category = typeof categories[number][0];
export default function SettingsView({ settings, channel, version, onChange, onReset, onError, onConfirm, profile, onLogin, onBlacklist, notificationStatus }: {
  settings: Settings; channel: string; version: string;
  onChange: (patch: Partial<Settings>) => void; onReset: () => Promise<void>;
  onError: (text: string) => void; onConfirm: (title: string, action: () => Promise<void>) => void;
  profile: Profile; onLogin: () => void; onBlacklist: () => void;
  notificationStatus?: string;
}) {
  const [category, setCategory] = useState<Category>("appearance");
  const [stats, setStats] = useState<Stats | null>(null);
  const [tailPreview, setTailPreview] = useState("正在读取官方预览…");
  const [detectedModel, setDetectedModel] = useState("");
  const reload = () => { void backend.stats().then(setStats).catch((error) => onError(errorText(error))); };
  useEffect(reload, []);
  useEffect(() => {
    if (category !== "account") return;
    let live = true;
    void backend.deviceTail(settings.deviceTailMode).then((value) => {
      if (!live) return;
      const name = value.official.deviceName || "官方服务未返回机型";
      setDetectedModel(value.detectedModel || "");
      setTailPreview(settings.deviceTailMode === "official" ? "服务端自动识别（未指定机型）" : name);
    }).catch((e) => { if (live) setTailPreview(errorText(e)); });
    return () => { live = false; };
  }, [category, settings.deviceTailMode]);
  const clear = async (kind: "cache" | "history" | "draft") => { await backend.clear(kind); reload(); };
  function toggle(key: keyof Settings, title: string, description: string) {
    return <div className="setting-row" key={key}><div><strong>{title}</strong><p>{description}</p></div>
      <input className="setting-switch" type="checkbox" role="switch" aria-label={title}
        checked={Boolean(settings[key])} onChange={(event) => onChange({ [key]: event.target.checked })} />
    </div>;
  }
  return <section className="settings-page">
    <div className="page-heading"><span className="eyebrow">偏好与管理</span><h1>设置</h1><p>让阅读更适合你</p></div>
    <div className="settings-layout">
      <nav className="settings-sections" aria-label="设置分类">
        {categories.map(([id, name, Icon]) => <button key={id} aria-current={category === id ? "page" : undefined}
          onClick={() => setCategory(id)}><Icon /><span>{name}</span><span className="settings-chevron">›</span></button>)}
        <span className="settings-version">第三方 · 非官方<br />v{version}</span>
      </nav>
      <div className="settings-content" key={category}>
        <h2>{categories.find(([id]) => id === category)?.[1]}</h2>
        {category === "appearance" && <>
          <p className="settings-description">清晰的层次，舒适的显示密度。</p>
          <div className="setting-group">
            <div className="setting-row"><div><strong>应用主题</strong><p>单独选择主题，或跟随系统</p></div>
              <div className="theme-options" aria-label="应用主题">{([ ["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"] ] as const).map(([value, title]) =>
                <button key={value} aria-pressed={settings.theme === value} onClick={() => onChange({ theme: value })}><i className={`theme-swatch ${value}`} />{title}</button>)}</div>
            </div>
            {toggle("compact", "紧凑列表", "在同一窗口中显示更多资讯")}
            {([ ["uiFont", "界面字体"], ["bodyFont", "正文字体"] ] as const).map(([key, title]) =>
              <div className="setting-row" key={key}><div><strong>{title}</strong><p>使用已安装字体，缺失时由系统回退</p></div>
                <select className="setting-select" aria-label={title} value={settings[key]} onChange={(event) => onChange({ [key]: event.target.value })}>
                  {["system", "Microsoft YaHei UI", "SimSun", "Segoe UI"].map((font) => <option key={font} value={font}>{font === "system" ? "跟随系统" : font}</option>)}
                </select></div>)}
          </div>
          <div className="settings-preview"><span className="eyebrow">阅读预览</span><h3>爱科技，爱这里。</h3><p style={{ fontSize: settings.fontSize, lineHeight: settings.lineHeight }}>从每一个新发现开始，让科技成为生活的一部分。</p></div>
        </>}
        {category === "reading" && <>
          <p className="settings-description">正文、图片与评论的阅读习惯。</p>
          <div className="setting-group">
            <div className="setting-row"><div><strong>正文字号</strong><p>调整文章内容大小</p></div><select className="setting-select" aria-label="正文字号" value={settings.fontSize} onChange={(event) => onChange({ fontSize: Number(event.target.value) })}>{[14, 15, 16, 17, 18, 20, 22, 24].map((n) => <option key={n} value={n}>{n} px</option>)}</select></div>
            <div className="setting-row"><div><strong>正文行距</strong><p>调整长文的阅读密度</p></div><select className="setting-select" aria-label="正文行距" value={settings.lineHeight} onChange={(event) => onChange({ lineHeight: Number(event.target.value) })}>{[1.5, 1.7, 1.9, 2.1, 2.4].map((n) => <option key={n} value={n}>{n} 倍</option>)}</select></div>
            {toggle("showImages", "显示资讯缩略图", "关闭后列表使用纯文字排版")}
            {toggle("articleImages", "显示文章图片", "关闭后正文使用纯文字阅读")}
            {toggle("autoOpenArticle", "桌面自动打开首篇资讯", "进入频道时打开首篇内容")}
            {toggle("showCommentComposer", "显示评论区写评论按钮", "关闭后可通过阅读工具栏或回复按钮发表评论")}
            {toggle("pinnedCard", "置顶资讯卡片", "独立呈现官方置顶内容")}
            {toggle("circleGrid", "圈子图片网格", "关闭后使用大图逐张展示")}
          </div>
        </>}
        {category === "account" && <>
          <p className="settings-description">官方账号、授权与互动权限。</p>
          <div className="setting-group">
            <div className="setting-row"><div><strong>IT之家账号</strong><p>{profile.id ? profile.nick : "未登录"} · 官方扫码或账号登录</p></div><Button onClick={onLogin}>{profile.id ? "重新授权" : "登录"}</Button></div>
            <div className="setting-row"><div><strong>黑名单管理</strong><p>与官方账号同步屏蔽列表</p></div><Button onClick={onBlacklist}>管理</Button></div>
            {toggle("rememberLogin", "保持登录", "在本机加密保存授权；关闭后仅保留本次会话")}
            {toggle("validateSessionOnStart", "启动时验证登录状态", "网络异常时保留本地授权")}
            {toggle("readOnly", "只读模式", "禁用评论、点赞、收藏和屏蔽等写入操作")}
            <div className="setting-row tail-setting-row"><div><strong><TagRegular /> 机型小尾巴</strong><p>官方服务预览；最终显示以发布后的官方结果为准</p></div><span className="tail-preview-chip">{tailPreview}</span></div>
            <div className="setting-row"><div><strong>尾巴模式</strong><p>{detectedModel ? `识别型号：${detectedModel}；选择后随评论和帖子发送` : "仅提供 Windows 标识及真实识别的本机型号"}</p></div><select className="setting-select" aria-label="尾巴模式" value={settings.deviceTailMode} onChange={(event) => onChange({ deviceTailMode: event.target.value as Settings["deviceTailMode"] })}><option value="official">跟随官方默认</option><option value="windows">Windows 客户端</option><option value="detected">识别本机型号</option></select></div>
          </div>
        </>}
        {category === "notifications" && <>
          <p className="settings-description">同步官方推送内容与未读消息，使用 Windows 图文通知。</p>
          <div className="setting-group">
            {toggle("notificationsEnabled", "通知总开关", "程序运行期间约每两分钟同步；退出程序后停止。首次开启只记录当前内容，避免历史通知刷屏")}
            {toggle("notifyNews", "官方热点推送", "读取官方当日已推送新闻，通知包含标题、摘要及可用图片")}
            {toggle("notifyReplies", "评论与帖子回复", "官方未读数增加时，提示最新回复；正文可能显示在 Windows 通知中心")}
            {toggle("notifyMessages", "会话与系统消息", "有新未读时提示；默认只提示有新消息，点击后查看内容")}
            <div className="setting-row"><div><strong>测试图文通知</strong><p>{notificationStatus || "以 Windows 系统通知权限及免打扰设置为准"}；测试仅发送一条固定示例，不改变总开关</p></div><Button onClick={() => void backend.testNotification().catch((e) => onError(errorText(e)))}>发送测试通知</Button></div>
          </div>
          <p className="about-note">此功能同步官方已推送列表，不接管官方 Android/iOS 推送凭据。通知可在 Windows 通知中心保留；图片不可用时显示文字。</p>
        </>}
        {category === "storage" && <>
          <p className="settings-description">可下载内容与本机记录分别管理。</p>
          <div className="storage-summary"><StorageRegular /><div><strong>{stats ? bytesLabel(stats.cacheBytes) : "正在统计…"}</strong><span>图片与文章磁盘缓存</span></div></div>
          <div className="setting-group">
            <div className="setting-row"><div><strong>图片和文章缓存</strong><p>清理时保留配置、收藏和草稿</p></div><Button onClick={() => onConfirm("清理可重新下载的缓存？", () => clear("cache"))}>清理缓存</Button></div>
            <div className="setting-row"><div><strong>缓存上限</strong><p>磁盘上限，达到后清理较久未使用的内容</p></div><select className="setting-select" aria-label="缓存上限" value={settings.cacheLimitMb} onChange={(event) => onChange({ cacheLimitMb: Number(event.target.value) })}>{[64, 128, 256, 512, 1024, 2048].map((n) => <option key={n} value={n}>{n} MB</option>)}</select></div>
            <div className="setting-row"><div><strong>浏览记录</strong><p>{stats?.historyCount || 0} 条本机记录，最多保留 2000 条</p></div><Button onClick={() => onConfirm("清空这台电脑上的浏览记录？", () => clear("history"))}>清空记录</Button></div>
            <div className="setting-row"><div><strong>未发送草稿</strong><p>只清理当前账号的全部未发送草稿</p></div><Button onClick={() => onConfirm("删除当前账号的全部未发送草稿？", () => clear("draft"))}>删除草稿</Button></div>
            <div className="setting-row"><div><strong>恢复默认设置</strong><p>保留原配置备份，收藏和历史不受影响</p></div><Button onClick={() => onConfirm("恢复默认设置并保留配置备份？", onReset)}>恢复默认</Button></div>
          </div>
        </>}
        {category === "about" && <>
          <div className="about-card"><img src={appLogo} className="app-logo" alt="客户端图标" /><div><strong>IT之家第三方客户端</strong><p>v{version} · {channel === "store" ? "Microsoft Store 版" : channel === "preview" ? "浏览器预览" : "独立分发版"}</p></div></div>
          <p className="about-note">本应用为第三方、非官方作品，与 IT之家及软媒无隶属关系。资讯、评论及相关品牌归原权利人所有。</p>
          <div className="about-links">
            {([ ["产品网站", "https://smileher.github.io/ITHomeDesktop/", ArrowUpRightRegular], ["版本与下载", "https://github.com/smileher/ITHomeDesktop/releases", ArrowDownloadRegular], ["问题反馈", "https://github.com/smileher/ITHomeDesktop/issues", InfoRegular] ] as const).map(([title, url, Icon]) => <Button key={title} icon={<Icon />} onClick={() => void backend.external(url).catch((error) => onError(errorText(error)))}>{title}</Button>)}
          </div>
          <div className="muted about-update"><CheckmarkCircleRegular />{channel === "store" ? "此版本由 Microsoft Store 管理更新。" : "后续版本可在下载页面获取；应用内自动更新尚未启用。"}</div>
        </>}
      </div>
    </div>
  </section>;
}
