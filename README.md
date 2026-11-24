# IT Home Desktop · Unofficial

[中文网站](https://smileher.github.io/ITHomeDesktop/) · [English website](https://smileher.github.io/ITHomeDesktop/en/) · [Downloads](https://github.com/Smileher/ITHomeDesktop/releases)

A third-party Windows desktop client for IT Home, with a focused reading layout, official news and comments, cloud favorites, and persistent drafts.

**This is an independent, unofficial project. It is not affiliated with IT Home or Ruanmei.** Content, comments, and third-party brands belong to their respective owners.

## Preview status

- Native news channels, article reading, comment browsing, official favorites, history, and settings. The reading toolbar jumps to comments; writing and replying use a dialog.
- Official WeChat / IT Home QR sign-in windows, automatic session sync and encrypted persistence. Phone confirmation and account writes require user validation.
- Native public circles, topics, post details and replies; official news/post favorites, account comments, posts, following and blacklist management. Account reads have been checked with a real session; account mutation checks use fixtures.
- Circle text posts, replies, likes and favorites use the official service, with account-scoped local drafts. Automated write checks use fixtures; live publishing requires user validation.
- Read conversations, unread totals, news replies and circle replies inside the client. Message content stays in memory; background push and private-message sending remain unfinished.
- The account hub includes local drafts/history and verified official-page shortcuts for the mall, assets, coin tasks, contributions and profile editing. Background notifications remain unfinished.
- Source labels follow official responses; there is no custom tail or device impersonation.
- Microsoft Store packaging is provided. Store identity and review are required before Store distribution.

## Development

Requires Node.js 24, pnpm 11, stable Rust, MSVC C++ tools, Windows SDK and WebView2.

```sh
pnpm install
pnpm tauri:dev
pnpm build
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
```

Windows x64 is the primary validation target. ARM64 builds are provided with hardware validation tracked separately. Windows 11 is preferred; package minimum is Windows 10 version 2004.

See [project guide](docs/PROJECT_GUIDE.md), [feature status](docs/FEATURES.md), [interface evidence](docs/API_EVIDENCE.md), and [privacy notice](docs/PRIVACY.md).

## Distribution

- Microsoft Store: new application identity required; updates managed by the Store.
- Installer / portable ZIP: GitHub Releases with SHA-256 checksums. In-app updating is planned.
- The portable ZIP does not contain WebView2 and stores data in the user's application data directory.

Application source is MIT licensed. That license does not grant rights to IT Home content, trademarks, or other third-party material.
