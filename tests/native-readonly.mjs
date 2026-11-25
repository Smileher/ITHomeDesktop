import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import net from "node:net";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const executable = path.resolve(
  process.env.ITHOME_NATIVE_EXE ||
    "src-tauri/target/x86_64-pc-windows-msvc/release/ithome-desktop.exe",
);
const sessionRoot = path.join(
  process.env.LOCALAPPDATA,
  "com.smileher.ithomedesktop",
);
async function hashes() {
  return Promise.all(
    ["session.bin", "settings.json"].map(async (name) => {
      try {
        return createHash("sha256")
          .update(await fs.readFile(path.join(sessionRoot, name)))
          .digest("hex");
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    }),
  );
}
const before = await hashes();
const port = await new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
const child = spawn(executable, [], {
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*`,
  },
});
let browser;
const report = {
  version: "",
  news: 0,
  circles: 0,
  accountReads: {},
  publicUserReads: {},
  messageReads: {},
  remoteIsolation: false,
  sessionAndSettingsUnchanged: false,
};
try {
  let endpoint;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null)
      throw new Error(
        "Native process exited; a running instance may already own the application",
      );
    try {
      endpoint = (
        await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
      ).webSocketDebuggerUrl;
    } catch {}
    if (endpoint) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.ok(endpoint);
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  let app;
  for (let attempt = 0; attempt < 50; attempt++) {
    app = context
      .pages()
      .find((page) => /localhost|tauri\.localhost/.test(page.url()));
    if (app) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(app);
  await app.waitForFunction(() => !!window.__TAURI_INTERNALS__);
  // UI reads use the real account. Suppress read markers and automatic toasts in
  // this test so render regressions never mutate the user's unread state.
  await app.evaluate(() => {
    const original = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
    window.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === "message_read") return;
      if (command === "notice_sync") return { badges: await original("badge_counts"), notificationError: "只读测试不发送通知" };
      return original(command, args);
    };
  });
  const runtimeErrors = [];
  app.on("pageerror", (e) => runtimeErrors.push(e.message));
  const call = (command, args = {}) =>
    app.evaluate(
      ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
      { command, args },
    );
  const boot = await call("bootstrap");
  report.version = boot.version;
  if (process.env.ITHOME_TEST_TOAST === "1") {
    report.fixedSampleToast = await app.evaluate(async () => {
      try { await window.__TAURI_INTERNALS__.invoke("test_notification"); return { accepted: true }; }
      catch (error) { return { accepted: false, code: error?.code, message: error?.message || String(error) }; }
    });
  }
  const news = await call("get_news", {
    channel: "news",
    cursor: null,
    refresh: true,
  });
  assert.ok(news.data.length > 0);
  report.news = news.data.length;
  assert.ok(news.data.some((item) => item.pinned));
  const feed = await call("get_circle", {
    kind: "latest",
    id: 0,
    page: 1,
    menu: 2000000002,
    stamp: "",
    refresh: true,
  });
  const posts = feed.data.list.filter((item) => item.feedType === 2);
  report.circles = posts.length;
  assert.ok(posts.length > 0);
  const detail = await call("get_circle", {
    kind: "detail",
    id: posts[0].feedContent.id,
    page: 1,
    menu: 0,
    stamp: "",
    refresh: false,
  });
  assert.equal(detail.data.id, posts[0].feedContent.id);
  const comments = await call("get_circle", {
    kind: "comments",
    id: detail.data.id,
    page: 1,
    menu: 0,
    stamp: "",
    refresh: false,
  });
  assert.ok(Array.isArray(comments.data.list));
  if (boot.profile.id) {
    for (const kind of ["unread", "conversations", "news-replies", "circle-replies"]) {
      const data = await call("message_data", { kind, id: 0, page: 1, cursor: 0, stamp: "" });
      if (kind === "unread") assert.equal(typeof data.totalCount, "number");
      else assert.ok(Array.isArray(data) || Array.isArray(data.list));
      report.messageReads[kind] = "pass";
      if (kind === "conversations") {
        const conversation = data.find((item) => Number.isInteger(item.anotherUserId) && item.anotherUserId !== 0);
        if (conversation) {
          const messages = await call("message_data", { kind: "conversation", id: conversation.anotherUserId, page: 1, cursor: 0, stamp: "" });
          assert.ok(Array.isArray(messages));
          report.messageReads.conversation = "pass";
        }
      }
    }
    for (const kind of [
      "favorites",
      "blacklist",
      "comments",
      "posts",
      "starred-posts",
      "following",
    ]) {
      const data = await call("account_data", { kind, page: 1, cursor: 0 });
      assert.ok(Array.isArray(data) || Array.isArray(data.list));
      report.accountReads[kind] = "pass";
    }
  }
  for (const kind of ["profile", "posts", ...(boot.profile.id ? ["comments", "replies"] : [])]) {
    const data = await call("user_data", { kind, id: 2553613, page: 1, cursor: 0 });
    if (kind === "profile") assert.equal(typeof data.nickname, "string");
    else assert.ok(Array.isArray(data) || Array.isArray(data.list));
    report.publicUserReads[kind] = "pass";
  }
  await assert.rejects(() => call("user_data", { kind: "profile", id: 0, page: 1, cursor: 0 }));
  await assert.rejects(() => call("user_data", { kind: "unknown", id: 1, page: 1, cursor: 0 }));
  await assert.rejects(() => call("message_data", { kind: "unknown", id: 0, page: 1, cursor: 0, stamp: "" }));
  await app.locator(".news-row").first().waitFor({ timeout: 30000 });
  await app.locator(".reader > h1").waitFor({ timeout: 30000 });
  await fs.mkdir("test-results", { recursive: true });
  await app.screenshot({
    path: "test-results/native-public-desktop.png",
    mask: [app.locator(".sidebar-bottom"), app.locator(".account-button")],
  });
  if (boot.profile.id) {
    await app.getByRole("button", { name: "消息", exact: true }).click();
    for (const label of ["新闻回复", "圈子回复", "会话与通知", "新闻回复"]) {
      await app.getByRole("tab", { name: label, exact: true }).click();
      await app.waitForTimeout(500);
      assert.equal(await app.locator(".message-page").count(), 1);
    }
    assert.deepEqual(runtimeErrors, []);
    report.messageRendering = "actual reply payloads and repeated tab switching passed; read writes suppressed";
  }
  await call("open_official", { kind: "feedback", id: null, query: null });
  let remote;
  for (let attempt = 0; attempt < 40; attempt++) {
    remote = context
      .pages()
      .find((page) =>
        page.url().startsWith("https://img.ithome.com/app/errorfeedback/"),
      );
    if (remote) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(remote);
  let remoteState;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      remoteState = await remote.evaluate(() => ({
        origin: location.origin,
        state: document.readyState,
        bodyLength: document.body?.textContent?.length || 0,
      }));
      if (
        remoteState.origin === "https://img.ithome.com" &&
        remoteState.bodyLength > 0
      )
        break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(remoteState?.origin, "https://img.ithome.com");
  const rejected = await remote.evaluate(async () => {
    try {
      await window.__TAURI_INTERNALS__.invoke("bootstrap");
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(rejected, true);
  report.remoteIsolation = true;
  report.sessionAndSettingsUnchanged =
    JSON.stringify(before) === JSON.stringify(await hashes());
  assert.equal(report.sessionAndSettingsUnchanged, true);
  await fs.writeFile(
    "test-results/native-readonly-report.json",
    JSON.stringify(report, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
}
