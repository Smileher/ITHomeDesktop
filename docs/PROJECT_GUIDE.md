# 开发与分发

## 本地开发

Node.js 24、pnpm 11、稳定版 Rust、MSVC C++ 工具、Windows SDK、WebView2。

```powershell
pnpm install --frozen-lockfile
pnpm tauri:dev
```

`pnpm dev` 仅启动浏览器预览，地址为 `http://127.0.0.1:5173/`。浏览器预览使用本地开发代理读取真实资讯；账号写操作仅限桌面客户端。浏览器预览状态与桌面数据分离，不用于证明 DPAPI 或原生持久化正确。

```powershell
pnpm build
pnpm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
# 保持开发服务运行，再执行真实匿名接口与受控响应交互测试：
pnpm test:e2e
pnpm test:site
# 原生程序已构建且没有登录真实账号时，可执行原生 IPC 与窗口隔离检查：
pnpm test:native
```

## 数据与登录

通过 Tauri 的应用本地数据目录保存数据，Windows 通常为 `%LOCALAPPDATA%\com.smileher.ithomedesktop\`。包括 settings.json、data.sqlite3、cache/images 和勾选保持登录时生成的 session.bin。便携版同样使用该目录；免安装不等于数据跟随 EXE。

登录按钮打开官方登录窗口。用户完成验证后点击同步登录；客户端通过评论接口核验 userId/userNick，再把必要会话材料保存在内存或 DPAPI 密文文件。官方窗口不获得 Tauri 系统权限。真实登录验证码和账号授权由用户完成。

配置保存失败会显示错误；损坏或未来版本配置不会自动覆盖，设置中显式恢复默认会保留原文件备份。收藏为本机收藏，不宣称与官方云端同步。历史最多保留 2000 条。

## 普通安装版与便携版

```powershell
./scripts/build-release.ps1 -Architecture x64
./scripts/build-release.ps1 -Architecture arm64
```

输出在 `src-tauri/target/release-assets/<架构>/`。安装版在缺少 WebView2 时引导安装；便携 ZIP 依赖已有运行时。正式发布提供 SHA256SUMS.txt。当前程序未配置商业代码签名；校验和用于核对下载完整性，不能代替代码签名。

## Microsoft Store

先在 Partner Center 为此应用取得新的 Identity Name 和 Publisher。不要复用 RemindOn 的应用身份或产品链接。

```powershell
$env:ITHOME_MSIX_IDENTITY = '<此应用的 Identity Name>'
$env:ITHOME_MSIX_PUBLISHER = '<Partner Center 的 Publisher CN>'
./scripts/build-store.ps1 -AllArchitectures
```

脚本使用 Windows SDK MakeAppx 生成 MSIX/MSIXBundle，不假定 Tauri CLI 直接生成 MSIX。输出位于 `src-tauri/target/store/<四段版本>/upload/`；上传包由商店发布时签名。Store 工作流支持手动输入身份并生成提交包，不自动提交 Partner Center。

`./scripts/build-store.ps1 -DevelopmentPackage` 仅验证开发身份下的未签名包，不可上传商店，也不代表已通过安装或商店认证。脚本不修改系统证书信任。

Store 构建通过 ITHOME_STORE_BUILD 标记更新渠道；此版不包含独立自更新。后续独立更新必须使用新应用自己的签名密钥和清单，Store 版继续由商店管理更新。

## GitHub 与网站

仓库：`https://github.com/Smileher/ITHomeDesktop`；Pages：`https://smileher.github.io/ITHomeDesktop/`。

Check 工作流执行构建和测试；Release 在匹配 `v<应用版本>` 标签时构建 x64/ARM64 安装版、便携 ZIP 及校验文件，作为预览版本发布。源码、Cargo、Tauri 与标签版本必须一致，发布说明必须存在。已公开版本不覆盖。

Pages 使用 Actions 构建并发布中英文官网和隐私页。网站从 Releases 读取公开版本与下载包；无可用版本时提供版本页链接。不会将构建令牌写入页面。

```powershell
pnpm site:build
```

网站图片来自真实匿名阅读测试的界面截图；更新界面后重新检查截图。常规测试只写入忽略的 test-results，设置 ITHOME_CAPTURE_SITE=1 才从浏览器测试更新网站截图。新增业务功能前更新 FEATURES.md，保持实现与宣传一致。
