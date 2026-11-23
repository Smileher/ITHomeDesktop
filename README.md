# IT Home Desktop · Unofficial

[中文网站](https://smileher.github.io/ITHomeDesktop/) · [English website](https://smileher.github.io/ITHomeDesktop/en/) · [Downloads](https://github.com/Smileher/ITHomeDesktop/releases)

A third-party Windows desktop client for IT Home, with a focused reading layout, official news and comments, local bookmarks, and persistent drafts.

**This is an independent, unofficial project. It is not affiliated with IT Home or Ruanmei.** Content, comments, and third-party brands belong to their respective owners.

## Preview status

- Native news channels, article reading, comment browsing, local bookmarks, history, and settings.
- Official sign-in window, encrypted session persistence, and comment/reply/vote integration; live-account validation is still required.
- Public homepage deals are shown in the native feed; circles and account services open in an isolated official-page window because the current circle API has migrated to the official app. Native community parity and background notifications are not complete.
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
