import { useEffect, useState } from "react";
import { Button, Dropdown, Option, Switch } from "@fluentui/react-components";
import {
  ArrowDownloadRegular,
  ArrowUpRightRegular,
  CheckmarkCircleRegular,
} from "@fluentui/react-icons";
import { backend } from "../bridge";
import { bytesLabel, errorText } from "../domain";
import type { Profile, Settings, Stats } from "../types";
import appLogo from "../assets/app.svg";

export default function SettingsView({
  settings,
  channel,
  version,
  onChange,
  onReset,
  onError,
  onConfirm,
  profile,
  onLogin,
  onBlacklist,
}: {
  settings: Settings;
  channel: string;
  version: string;
  onChange: (patch: Partial<Settings>) => void;
  onReset: () => Promise<void>;
  onError: (s: string) => void;
  onConfirm: (title: string, action: () => Promise<void>) => void;
  profile: Profile;
  onLogin: () => void;
  onBlacklist: () => void;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const reload = () => {
    void backend
      .stats()
      .then(setStats)
      .catch((e) => onError(errorText(e)));
  };
  useEffect(reload, []);
  const clear = async (kind: "cache" | "history" | "draft") => {
    await backend.clear(kind);
    reload();
  };
  const themeName = { system: "跟随系统", light: "浅色", dark: "深色" };
  return (
    <section className="settings-page">
      <div className="page-heading">
        <span className="eyebrow">按你的习惯阅读</span>
        <h1>设置</h1>
        <p>外观、阅读与本地数据</p>
      </div>
      <nav className="settings-sections" aria-label="设置分类">
        {[["settings-account", "账号"], ["settings-reading", "阅读"], ["settings-storage", "存储"], ["settings-about", "关于"]].map(([id, name]) =>
          <button key={id} onClick={() => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" })}>{name}</button>)}
      </nav>
      <h2 id="settings-account">账号</h2>
      <div className="setting-group">
        <div className="setting-row"><div><strong>IT之家账号</strong><p>{profile.id ? profile.nick : "未登录"} · 使用官方扫码或账号登录</p></div><Button onClick={onLogin}>{profile.id ? "重新授权" : "登录"}</Button></div>
        <div className="setting-row"><div><strong>黑名单管理</strong><p>查看、添加和解除官方账号的用户屏蔽</p></div><Button onClick={onBlacklist}>管理</Button></div>
        {([ ["validateSessionOnStart", "启动时验证登录状态", "启动后检查官方会话，网络异常时保留本地授权"], ["readOnly", "只读模式", "禁用评论、点赞、云端收藏和屏蔽等账号写入操作"] ] as const).map(([key, name, description]) => <div className="setting-row" key={key}><div><strong>{name}</strong><p>{description}</p></div><Switch aria-label={name} checked={settings[key]} onChange={(_, data) => onChange({ [key]: data.checked })} /></div>)}
      </div>
      <h2 id="settings-reading">外观与阅读</h2>
      <div className="setting-group">
        <div className="setting-row">
          <div>
            <strong>应用主题</strong>
            <p>跟随系统，或单独选择明暗主题</p>
          </div>
          <Dropdown
            aria-label="应用主题"
            value={themeName[settings.theme]}
            selectedOptions={[settings.theme]}
            onOptionSelect={(_, data) =>
              onChange({ theme: data.optionValue as Settings["theme"] })
            }
          >
            {Object.entries(themeName).map(([id, name]) => (
              <Option key={id} value={id}>
                {name}
              </Option>
            ))}
          </Dropdown>
        </div>
        <div className="setting-row">
          <div>
            <strong>正文字号</strong>
            <p>调整文章内容的显示大小</p>
          </div>
          <Dropdown
            aria-label="正文字号"
            value={`${settings.fontSize} px`}
            selectedOptions={[String(settings.fontSize)]}
            onOptionSelect={(_, data) =>
              onChange({ fontSize: Number(data.optionValue) })
            }
          >
            {[14, 15, 16, 17, 18, 20, 22, 24].map((n) => (
              <Option key={n} value={String(n)}>{`${n} px`}</Option>
            ))}
          </Dropdown>
        </div>
        <div className="setting-row">
          <div>
            <strong>紧凑列表</strong>
            <p>在同一窗口中显示更多资讯</p>
          </div>
          <Switch
            aria-label="紧凑列表"
            checked={settings.compact}
            onChange={(_, data) => onChange({ compact: data.checked })}
          />
        </div>
        {([ ["uiFont", "界面字体"], ["bodyFont", "正文字体"] ] as const).map(([key, name]) => <div className="setting-row" key={key}><div><strong>{name}</strong><p>使用 Windows 已安装字体，缺失时由系统回退</p></div><Dropdown aria-label={name} value={settings[key] === "system" ? "跟随系统" : settings[key]} selectedOptions={[settings[key]]} onOptionSelect={(_, data) => onChange({ [key]: data.optionValue || "system" })}>{["system", "Microsoft YaHei UI", "SimSun", "Segoe UI"].map((font) => <Option key={font} value={font}>{font === "system" ? "跟随系统" : font}</Option>)}</Dropdown></div>)}
        <div className="setting-row"><div><strong>正文行距</strong><p>调整长文的阅读密度</p></div><Dropdown aria-label="正文行距" value={`${settings.lineHeight} 倍`} selectedOptions={[String(settings.lineHeight)]} onOptionSelect={(_, data) => onChange({ lineHeight: Number(data.optionValue) })}>{[1.5, 1.7, 1.9, 2.1, 2.4].map((n) => <Option key={n} value={String(n)}>{`${n} 倍`}</Option>)}</Dropdown></div>
        {([ ["articleImages", "显示文章图片", "关闭后正文使用纯文字阅读"], ["autoOpenArticle", "桌面自动打开首篇资讯", "进入频道时在阅读区域打开首篇内容"], ["showCommentComposer", "显示评论输入框", "关闭后仍可阅读评论，草稿会继续保留"], ["pinnedCard", "置顶资讯卡片", "用独立卡片呈现官方置顶内容"], ["circleGrid", "圈子图片网格", "多图使用网格；关闭后使用大图逐张展示"] ] as const).map(([key, name, description]) => <div className="setting-row" key={key}><div><strong>{name}</strong><p>{description}</p></div><Switch aria-label={name} checked={settings[key]} onChange={(_, data) => onChange({ [key]: data.checked })} /></div>)}
        <div className="setting-row">
          <div>
            <strong>显示资讯缩略图</strong>
            <p>关闭后列表使用纯文字排版</p>
          </div>
          <Switch
            aria-label="显示资讯缩略图"
            checked={settings.showImages}
            onChange={(_, data) => onChange({ showImages: data.checked })}
          />
        </div>
      </div>
      <h2 id="settings-storage">账号与数据</h2>
      <div className="setting-group">
        <div className="setting-row">
          <div>
            <strong>保持登录</strong>
            <p>在这台电脑上加密保存会话；关闭后仅保留本次会话</p>
          </div>
          <Switch
            aria-label="保持登录"
            checked={settings.rememberLogin}
            onChange={(_, data) => onChange({ rememberLogin: data.checked })}
          />
        </div>
        <div className="setting-row">
          <div>
            <strong>图片和文章缓存</strong>
            <p>
              {stats
                ? `${bytesLabel(stats.cacheBytes)} · 清理时保留配置、收藏和草稿`
                : "正在统计…"}
            </p>
          </div>
          <Button
            onClick={() =>
              onConfirm("清理可重新下载的缓存？", () => clear("cache"))
            }
          >
            清理缓存
          </Button>
        </div>
        <div className="setting-row">
          <div>
            <strong>缓存上限</strong>
            <p>达到上限后清理较久未使用的内容</p>
          </div>
          <Dropdown
            aria-label="缓存上限"
            value={`${settings.cacheLimitMb} MB`}
            selectedOptions={[String(settings.cacheLimitMb)]}
            onOptionSelect={(_, data) =>
              onChange({ cacheLimitMb: Number(data.optionValue) })
            }
          >
            {[64, 128, 256, 512, 1024, 2048].map((n) => (
              <Option key={n} value={String(n)}>{`${n} MB`}</Option>
            ))}
          </Dropdown>
        </div>
        <div className="setting-row">
          <div>
            <strong>浏览记录</strong>
            <p>{stats?.historyCount || 0} 条本机记录，最多保留 2000 条</p>
          </div>
          <Button
            onClick={() =>
              onConfirm("清空这台电脑上的浏览记录？", () => clear("history"))
            }
          >
            清空记录
          </Button>
        </div>
        <div className="setting-row">
          <div>
            <strong>未发送草稿</strong>
            <p>按账号和回复对象分别保存；此操作只清理当前账号</p>
          </div>
          <Button
            onClick={() =>
              onConfirm("删除当前账号的全部未发送草稿？", () => clear("draft"))
            }
          >
            删除草稿
          </Button>
        </div>
        <div className="setting-row">
          <div>
            <strong>恢复默认设置</strong>
            <p>保留一份原配置备份，收藏和历史不受影响</p>
          </div>
          <Button
            onClick={() => onConfirm("恢复默认设置并保留配置备份？", onReset)}
          >
            恢复默认
          </Button>
        </div>
      </div>
      <h2 id="settings-about">关于与分发</h2>
      <div className="about-card">
        <img src={appLogo} className="app-logo" alt="客户端图标" />
        <div>
          <strong>IT之家第三方客户端</strong>
          <p>
            v{version} ·{" "}
            {channel === "store"
              ? "Microsoft Store 版"
              : channel === "preview"
                ? "浏览器预览"
                : "独立分发版"}
          </p>
        </div>
      </div>
      <p className="about-note">
        本应用为第三方、非官方作品，与
        IT之家及软媒无隶属关系。资讯、评论及相关品牌归原权利人所有。
      </p>
      <div className="about-links">
        <Button
          icon={<ArrowUpRightRegular />}
          onClick={() =>
            void backend
              .external("https://smileher.github.io/ITHomeDesktop/")
              .catch((e) => onError(errorText(e)))
          }
        >
          产品网站
        </Button>
        <Button
          icon={<ArrowDownloadRegular />}
          onClick={() =>
            void backend
              .external("https://github.com/smileher/ITHomeDesktop/releases")
              .catch((e) => onError(errorText(e)))
          }
        >
          版本与下载
        </Button>
        <Button
          onClick={() =>
            void backend
              .external("https://github.com/smileher/ITHomeDesktop/issues")
              .catch((e) => onError(errorText(e)))
          }
        >
          问题反馈
        </Button>
      </div>
      <div className="muted about-update">
        <CheckmarkCircleRegular />
        {channel === "store"
          ? "此版本由 Microsoft Store 管理更新。"
          : "后续更新可在版本与下载页面获取；应用内自动更新尚未启用。"}
      </div>
    </section>
  );
}
