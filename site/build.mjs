import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "site/dist");
const pkg = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
const repo = "https://github.com/Smileher/ITHomeDesktop";
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let release = null;
if (!process.env.ITHOME_SITE_OFFLINE) {
  try {
    const response = await fetch(
      "https://api.github.com/repos/Smileher/ITHomeDesktop/releases",
      {
        headers: {
          Accept: "application/vnd.github+json",
          ...(process.env.GH_TOKEN
            ? { Authorization: `Bearer ${process.env.GH_TOKEN}` }
            : {}),
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (response.ok) {
      const values = await response.json();
      release = values.find((value) => !value.draft) || null;
    }
  } catch {}
}
await fs.mkdir(out, { recursive: true });
await fs.mkdir(path.join(out, "en"), { recursive: true });
await fs.mkdir(path.join(out, "assets"), { recursive: true });
await fs.copyFile(
  path.join(root, "src/assets/app.svg"),
  path.join(out, "assets/app.svg"),
);
await fs.copyFile(
  path.join(root, "site/style.css"),
  path.join(out, "assets/style.css"),
);
let screenshot = false;
try {
  await fs.copyFile(
    path.join(root, "site/assets/desktop.png"),
    path.join(out, "assets/desktop.png"),
  );
  screenshot = true;
} catch {}
let mobile = false;
try {
  await fs.copyFile(
    path.join(root, "site/assets/mobile.png"),
    path.join(out, "assets/mobile.png"),
  );
  mobile = true;
} catch {}
for (const en of [false, true]) {
  const prefix = en ? "../" : "";
  const title = en ? "IT Home Desktop — Unofficial" : "IT之家第三方客户端";
  const nav = `<nav><a class="brand" href="${en ? "../en/" : "./"}"><img src="${prefix}assets/app.svg" alt=""><strong>${title}</strong></a><div><a href="#download">${en ? "Download" : "下载"}</a><a href="${repo}" target="_blank" rel="noopener">GitHub ↗</a><a href="${en ? "../" : "en/"}">${en ? "中文" : "EN"}</a><button id="theme" aria-label="${en ? "Toggle theme" : "切换明暗主题"}">◐</button></div></nav>`;
  const version = release?.tag_name || `v${pkg.version}`;
  const download =
    release?.html_url &&
    release.html_url.toLowerCase().startsWith(repo.toLowerCase() + "/releases/")
      ? release.html_url
      : repo + "/releases";
  const assets = (release?.assets || []).filter(
    (asset) =>
      /_(x64|arm64)_(setup\.exe|portable\.zip)$/.test(asset.name) &&
      asset.browser_download_url
        .toLowerCase()
        .startsWith(repo.toLowerCase() + "/releases/download/"),
  );
  const downloads = assets.length
    ? assets
        .map((asset) => {
          const arm = asset.name.includes("_arm64_");
          const portable = asset.name.endsWith(".zip");
          return `<a class="download-option" href="${esc(asset.browser_download_url)}"><span>${arm ? "ARM64" : "x64"} · ${portable ? (en ? "Portable ZIP" : "便携 ZIP") : en ? "Installer" : "安装版"}</span><span>${(asset.size / 1024 / 1024).toFixed(1)} MB ↓</span></a>`;
        })
        .join("")
    : `<a class="download-option" href="${repo}/releases"><span>${en ? "View available preview releases" : "查看可用的预览版本"}</span><span>GitHub ↗</span></a>`;
  const html = `<!doctype html><html lang="${en ? "en" : "zh-CN"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${en ? "An unofficial Windows desktop client for IT Home. Read tech news, browse comments, and keep your reading organized." : "面向 Windows 的 IT之家第三方、非官方客户端。读科技资讯、浏览评论，找回舒服的桌面阅读体验。"}"><meta name="color-scheme" content="light dark"><link rel="icon" href="${prefix}assets/app.svg"><link rel="stylesheet" href="${prefix}assets/style.css"><title>${title}</title></head><body>${nav}<main><section class="hero"><div class="hero-copy"><span class="eyebrow">ITHOME DESKTOP · UNOFFICIAL</span><h1>${en ? "A little more space<br>for what you <em>love reading.</em>" : "科技资讯，<br>回到舒服的<em>桌面。</em>"}</h1><p>${en ? "News, conversations, and ideas. A thoughtful Windows reading experience, with familiar content and a quieter interface." : "熟悉的资讯与家友讨论，配上清晰的列表、舒服的正文和顺手的桌面交互。把注意力留给内容。"}</p><div class="hero-actions"><a class="primary" href="#download">${en ? "Get the Windows preview" : "下载 Windows 预览版"} <span>↓</span></a><a href="${repo}">${en ? "Explore the project" : "了解这个项目"} ↗</a></div><div class="hero-note">${en ? "Third-party. Unofficial. Independent of IT Home and Ruanmei." : "第三方 · 非官方 · 与 IT之家及软媒无隶属关系"}</div></div><div class="hero-aside"><span class="version">${esc(version)} · PREVIEW</span><div class="quiet-symbol"><img src="${prefix}assets/app.svg" alt=""></div><span>${en ? "Made for a calmer desktop." : "爱科技，也爱舒适地阅读。"}</span></div></section>${screenshot ? `<section class="product-shot" aria-label="${en ? "Application screenshot" : "客户端界面截图"}"><img src="${prefix}assets/desktop.png" alt="${en ? "Three-column Windows interface with news list, article and comments" : "Windows 三栏布局：导航、资讯列表与文章评论"}" width="1280" height="860"></section>` : ""}<section class="features"><div class="section-heading"><span class="eyebrow">${en ? "READ. FOLLOW. RETURN." : "阅读、讨论，再回来。"}</span><h2>${en ? "Familiar content.<br>A considered desktop." : "内容很熟悉，<br>体验更从容。"}</h2></div><div class="feature-grid"><article><span>01</span><h3>${en ? "Room to read" : "适合桌面的阅读空间"}</h3><p>${en ? "Channels, readable typography, light and dark themes, and a focused reading layout." : "频道资讯、清晰排版、明暗主题，以及可以收起列表的专注阅读。"}</p></article><article><span>02</span><h3>${en ? "Keep the conversation" : "顺手接上家友讨论"}</h3><p>${en ? "Browse official comments and replies. Drafts stay with their article and account." : "查看官方评论与楼中楼，按文章、账号和回复对象保存草稿。来源标记遵循官方结果。"}</p></article><article><span>03</span><h3>${en ? "Pick up where you left off" : "收藏喜欢的，找回读过的"}</h3><p>${en ? "Local bookmarks and reading history help you return to interesting stories." : "本机收藏与浏览记录，帮你找回感兴趣的文章。缓存与草稿分别管理。"}</p></article><article><span>04</span><h3>${en ? "Connected to official pages" : "继续使用官方页面"}</h3><p>${en ? "Dedicated official-page windows provide access to sign-in and services not yet available natively." : "独立窗口打开官方登录、好物及账号页面。尚未完成的原生功能会明确标注。"}</p></article></div></section>${mobile ? `<section class="mobile-section"><div><span class="eyebrow">NARROW WINDOWS</span><h2>${en ? "A layout for<br>narrow windows." : "小窗口，<br>也有自己的布局。"}</h2><p>${en ? "A full-width feed, a dedicated reading page, and lightweight floating navigation. Bookmarks, history and settings live together under My." : "全宽资讯列表、独立阅读页，还有轻巧的悬浮底栏。窗口缩小时，收藏、历史和设置集中在“我的”，内容始终清晰。"}</p></div><img src="${prefix}assets/mobile.png" alt="${en ? "Narrow-window layout with floating bottom navigation" : "窄窗口下的单栏资讯与悬浮底部导航"}" width="375" height="860"></section>` : ""}<section id="download" class="download-section"><div><span class="eyebrow">WINDOWS · ${esc(version)}</span><h2>${en ? "Start with a preview." : "从一个预览版开始。"}</h2><p>${en ? "Choose x64 for most Intel and AMD PCs, or ARM64 for Windows on Arm. Microsoft Store distribution is being prepared." : "大多数 Intel / AMD 电脑选择 x64，Windows on Arm 选择 ARM64。Microsoft Store 分发正在准备中。"}</p><p class="small">${en ? "The preview is not a complete replacement for every official client feature. Account operations require further live-account validation." : "预览版尚未完整覆盖所有官方客户端功能，账号交互仍需真实账号进一步验证。"}</p></div><div class="download-options">${downloads}<a class="download-secondary" href="${esc(download)}">${en ? "Release notes and checksums" : "版本说明与文件校验"} ↗</a></div></section><section class="faq"><h2>${en ? "A few things to know." : "你可能还想知道。"}</h2><details><summary>${en ? "Is this an official IT Home app?" : "这是 IT之家官方客户端吗？"}</summary><p>${en ? "No. This is an independent, third-party application. IT Home content, comments, and brands belong to their respective owners." : "不是。本项目由个人独立开发，是第三方、非官方客户端。IT之家内容、评论和相关品牌归相应权利人所有。"}</p></details><details><summary>${en ? "Which Windows versions are supported?" : "支持哪些 Windows 版本？"}</summary><p>${en ? "Windows 11 is the primary target. Packaging targets Windows 10 version 2004 or later, with WebView2 required. Compatibility and ARM64 hardware validation are tracked in the project." : "优先面向 Windows 11，打包目标为 Windows 10 2004 及以上，需要 WebView2。旧系统与 ARM64 实机兼容性会在项目中单独记录。"}</p></details><details><summary>${en ? "Where are settings and sign-in data stored?" : "配置、草稿和登录数据放在哪里？"}</summary><p>${en ? "Settings, history, drafts and cache live in the current user’s local application directory. Remembered sessions are encrypted by Windows DPAPI; passwords are not saved. Read the privacy notice for details." : "配置、历史、草稿和缓存位于当前用户的应用本地数据目录；保持登录时，会话通过 Windows DPAPI 加密保存，不保存明文密码。详见隐私说明。"}</p></details></section></main><footer><span>${title}<small>${en ? "Independent project by Smileher" : "Smileher 独立开发"}</small></span><div><a href="${prefix}privacy.html">${en ? "Privacy" : "隐私说明"}</a><a href="${repo}/issues">${en ? "Feedback" : "反馈问题"} ↗</a><a href="${repo}">GitHub ↗</a></div></footer><script>document.getElementById('theme').addEventListener('click',()=>{const dark=document.documentElement.style.colorScheme==='dark'||(!document.documentElement.style.colorScheme&&matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.style.colorScheme=dark?'light':'dark';});</script></body></html>`;
  await fs.writeFile(
    path.join(out, en ? "en/index.html" : "index.html"),
    html,
    "utf8",
  );
}
const privacy = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><link rel="stylesheet" href="assets/style.css"><title>隐私说明 · IT之家第三方客户端</title></head><body><nav><a class="brand" href="./"><img src="assets/app.svg" alt=""><strong>IT之家第三方客户端</strong></a><a href="./">返回首页</a></nav><main class="privacy"><span class="eyebrow">PRIVACY · 2026-11-23</span><h1>隐私说明</h1><p>本应用为 Smileher 独立开发的第三方、非官方客户端，与 IT之家及软媒无隶属关系。</p><h2>网络服务</h2><p>资讯、正文和评论从 IT之家服务读取。登录、评论、点赞等账号操作会将完成该操作所需的数据发送至官方服务。官方页面、图片、视频或外部链接可能使用其各自的网络服务和隐私政策。GitHub Pages 托管本网站，GitHub Releases 提供程序下载。</p><h2>登录与本地数据</h2><p>客户端不保存明文密码。独立官方页面窗口使用临时浏览会话；主动同步登录后，必要的会话材料在程序内使用。选择保持登录时，使用当前 Windows 用户范围的 DPAPI 加密后保存。配置、浏览历史、本机收藏、草稿和缓存保存在应用本地数据目录；除会话材料外，这些数据未承诺额外加密。</p><h2>清理与控制</h2><p>设置中可分别清理缓存、浏览历史及当前账号的未发送草稿。清理缓存保留收藏、草稿和配置。退出登录清除客户端保存的会话材料，并关闭当前官方页面窗口；本机收藏、历史及按账号保存的草稿仍保留。</p><h2>遥测与后台行为</h2><p>本版本未添加第三方分析 SDK 或遥测上传功能，也未实现后台消息推送及独立版应用内自动更新。后续改变数据处理方式时会更新此说明。Microsoft Store 分发后的应用更新由商店管理。</p><h2>联系与反馈</h2><p>请通过 <a href="${repo}/issues">GitHub Issues</a> 反馈一般问题。请勿在公开反馈中附带密码、验证码、Cookie、会话文件或其他个人敏感数据。</p><p class="small">English: This unofficial client reads IT Home services and stores preferences, drafts and reading data locally. Remembered sessions use Windows DPAPI. No plaintext password storage or third-party analytics is included. Account actions and official pages communicate with their service providers. Use GitHub Issues for general feedback without sharing credentials.</p></main><footer><a href="./">IT之家第三方客户端 · 非官方</a></footer></body></html>`;
await fs.writeFile(path.join(out, "privacy.html"), privacy, "utf8");
await fs.writeFile(path.join(out, ".nojekyll"), "", "utf8");
console.log(
  `Built Chinese/English site; release: ${release?.tag_name || "not published"}; screenshot: ${screenshot}`,
);
