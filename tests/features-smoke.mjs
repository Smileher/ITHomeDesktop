import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { defaultSettings } from "../src/types.ts";

const base = process.env.ITHOME_TEST_URL || "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const report = { publicCircle: {}, fixtures: {}, qr: {} };
try {
  const live = await browser.newPage({
    viewport: { width: 1280, height: 860 },
  });
  await live.goto(base);
  await live.getByRole("button", { name: "圈子", exact: true }).click();
  await live.locator(".circle-card").first().waitFor({ timeout: 40000 });
  report.publicCircle.posts = await live.locator(".circle-card").count();
  assert.ok(report.publicCircle.posts > 0);
  for (const label of ["最新主帖", "最新评价", "最新回复"]) {
    await live
      .locator(".circle-sort")
      .getByRole("button", { name: label, exact: true })
      .click();
    await live.locator(".circle-card").first().waitFor({ timeout: 30000 });
  }
  await live.locator(".circle-open").first().click();
  await live.locator(".circle-detail.is-open").waitFor();
  await live.waitForFunction(
    () => !document.querySelector('.circle-reading [role="progressbar"]'),
    { timeout: 30000 },
  );
  assert.equal(await live.locator(".circle-reading .inline-error").count(), 0);
  await live.setViewportSize({ width: 375, height: 860 });
  assert.equal(await live.locator(".circle-feed").isVisible(), false);
  await live.getByRole("button", { name: "返回圈子列表" }).click();
  assert.equal(await live.locator(".circle-feed").isVisible(), true);
  await live.locator(".circle-topics button").first().click();
  await live.locator(".circle-card").first().waitFor({ timeout: 30000 });
  report.publicCircle.topicAndMobileDetail = "pass";
  await live.close();

  // A native IPC test double exercises account writes without touching the user's account.
  const fixture = await browser.newPage({
    viewport: { width: 1280, height: 860 },
  });
  const errors = [];
  fixture.on("pageerror", (error) => errors.push(error.message));
  await fixture.addInitScript(
    ({ defaults }) => {
      window.isTauri = true;
      const state = {
        settings: defaults,
        calls: [],
        callbacks: {},
        listeners: {},
        favorites: Array.from({ length: 21 }, (_, i) => ({
          newsId: 1000 + i,
          title: `界面测试收藏 ${i + 1}`,
          newsPostDate: "2026-11-24T09:30:00",
          isNewsDeleted: false,
        })),
        blocks: [
          {
            UserID: 2,
            UserNick: "屏蔽测试用户",
            AddTime: "2026-11-24T09:00:00",
          },
        ],
        next: 0,
        circleDrafts: {},
        failCircleWrite: false,
      };
      window.__fixture = state;
      const item = {
        id: 1000,
        title: "界面回归测试文章",
        date: "2026-11-24T09:30:00",
        orderDate: "2026-11-24T09:30:00",
        summary: "",
        image: "",
        url: "https://www.ithome.com/0/001/000.htm",
        comments: 2,
        forbidComment: false,
      };
      const comment = (id, userId) => ({
        id,
        userInfo: {
          id: userId,
          userNick: userId === 2 ? "屏蔽测试用户" : "界面测试家友",
          level: 57,
        },
        elements: [{ type: 0, content: "评论排版和表情测试[微笑]" }],
        postTime: "2026-11-24T09:30:00",
        support: 2,
        against: 0,
        floorStr: `${id}楼`,
        deviceTailModel: {
          name: "官方设备来源示例",
          color: "#4669b2",
          extraTails: [],
        },
        children: id === 1 ? [comment(11, 1)] : id === 11 ? [comment(12, 1)] : [],
        parentCommentId: 0,
        replyCommentId: 0,
      });
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      window.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback(callback) {
          const id = ++state.next;
          state.callbacks[id] = callback;
          return id;
        },
        unregisterCallback(id) {
          delete state.callbacks[id];
        },
        convertFileSrc(value) {
          return value;
        },
        async invoke(command, args = {}) {
          if (command === "plugin:event|listen") {
            state.listeners[args.event] = args.handler;
            return ++state.next;
          }
          if (command.startsWith("plugin:")) return;
          if (command === "bootstrap")
            return {
              settings: state.settings,
              profile: { id: 1, nick: "界面测试账号" },
              channel: "preview",
              version: "test",
              warnings: [],
            };
          if (command === "validate_session" || command === "sync_login")
            return { id: 1, nick: "界面测试账号" };
          if (command === "user_data") {
            if (args.kind === "profile") return { nickname: "界面测试账号", rank: 57, regtime: "2020-01-01T00:00:00", iplocation: "测试区域", commentcount: 2, newquancontentcount: 0, newquancommentcount: 0 };
            return { list: [], current: 1, pageSize: 20, total: 0 };
          }
          if (command === "get_news" || command === "get_deals")
            return { data: [item], savedAt: Date.now() / 1000, stale: false };
          if (command === "get_article")
            return {
              data: {
                item,
                html: "<p>本文用于界面回归验证。</p>",
                author: "测试",
                source: "测试",
                sn: "fixture",
              },
              stale: false,
              savedAt: Date.now() / 1000,
            };
          if (command === "get_comments")
            return {
              newsId: 1000,
              userId: 1,
              canComment: true,
              ruleHint: "测试",
              comments: [comment(1, 1), comment(2, 2)],
              hotComments: [comment(1, 1), comment(2, 2)],
            };
          if (command === "local_items") return [];
          if (command === "get_draft") return "";
          if (command === "get_circle_draft") return state.circleDrafts[`${args.id}:${args.reply}:${args.topic}`] || "";
          if (command === "save_circle_draft") {
            state.circleDrafts[`${args.id}:${args.reply}:${args.topic}`] = args.body;
            return;
          }
          if (command === "message_data") {
            if (args.kind === "unread") return { totalCount: 3 };
            if (args.kind === "conversations") return [{ id: 1, anotherUserId: -1, summary: "系统消息测试摘要", lastTime: "2026-11-24T12:00:00", notReadMessageCount: 1, anotherUserBaseInfoModel: { id: -1, userNick: "通知测试" } }];
            if (args.kind === "conversation") return [{ messageId: 2, fromUserId: -1, contentType: 2, systemNotifyElements: [{ type: 0, content: "通知测试正文" }], createTime: "2026-11-24T12:00:00" }];
            if (args.kind === "news-replies") return [{ comment: comment(3, 1), news: { id: 1000, title: "界面回归测试文章" } }];
            return { current: 1, total: 1, pageSize: 20, list: [{ id: 9, contentId: 77, user: { id: 1, userNick: "测试圈子回复" }, contents: [{ type: 0, content: "圈子回复测试" }], createTime: "2026-11-24T12:00:00" }] };
          }
          if (command === "get_circle") {
            const post = { id: 77, user: { id: 1, userNick: "圈子测试家友" }, contents: [{ type: 0, content: "圈子互动测试正文" }], support: 2, voteStatus: 0, starStatus: 0, commentCount: 1, createTime: "2026-11-24T12:00:00" };
            const data = args.kind === "detail" ? post : args.kind === "comments" ? { list: [{ ...post, id: 78, floorStr: "1楼", contents: [{ type: 0, content: "圈子评论测试" }] }], total: 1 } : { list: [{ feedType: 7, feedContent: { data: [{ id: 4030, name: "真实协议测试话题" }] } }, { feedType: 2, feedContent: post }], leftCount: 0 };
            return { data, stale: false, savedAt: Date.now() / 1000 };
          }
          if (command === "circle_action") {
            if (state.settings.readOnly) throw { message: "只读模式已开启" };
            state.calls.push({ command, ...args });
            if (state.failCircleWrite) throw { message: "操作结果待确认，请先刷新核对；草稿已保留，不会自动重发" };
            return { success: true, data: {} };
          }
          if (command === "get_drafts")
            return [
              {
                newsId: 1000,
                replyId: 0,
                body: "测试草稿",
                updated: 1795480000,
              },
            ];
          if (command === "cache_image") return args.url;
          if (command === "get_stats")
            return { cacheBytes: 0, historyCount: 0, favoritesCount: 0 };
          if (command === "save_settings") {
            state.settings = args.settings;
            return state.settings;
          }
          if (command === "reset_settings") return defaults;
          if (command === "account_data") {
            if (args.kind === "favorites")
              return state.favorites.slice(
                (args.page - 1) * 20,
                args.page * 20,
              );
            if (args.kind === "blacklist") return state.blocks;
            if (args.kind === "comments")
              return [
                {
                  news: { id: 1000, title: "界面回归测试文章" },
                  comment: comment(1, 1),
                },
              ];
            if (args.kind === "posts" || args.kind === "starred-posts")
              return { current: 1, total: 0, pageSize: 20, list: [] };
            if (args.kind === "following")
              return { current: 1, total: 0, pageSize: 20, list: [] };
          }
          if (command === "account_action") {
            if (state.settings.readOnly) throw { message: "只读模式已开启" };
            state.calls.push({ command, ...args });
            if (args.kind === "favorite-remove")
              state.favorites = state.favorites.filter(
                (v) => v.newsId !== args.id,
              );
            if (args.kind === "unblock")
              state.blocks = state.blocks.filter((v) => v.UserID !== args.id);
            return;
          }
          if (command === "open_official") {
            state.calls.push({ command, ...args });
            return;
          }
          if (["save_draft", "toggle_favorite", "logout"].includes(command))
            return;
          throw new Error(`Unexpected test command: ${command}`);
        },
      };
    },
    { defaults: { ...defaultSettings, validateSessionOnStart: false } },
  );
  await fixture.goto(base);
  await fixture.locator(".comment-thread").first().waitFor();
  assert.equal(
    await fixture.locator(".comment-thread:not(.nested)").count(),
    2,
    "Official blacklist must hide the blocked author",
  );
  assert.equal(await fixture.getByRole("textbox", { name: "评论草稿" }).count(), 0);
  await fixture.locator(".toolbar-comment").click();
  assert.equal(await fixture.getByRole("textbox", { name: "评论草稿" }).count(), 0);
  await fixture.locator(".comments").getByRole("button", { name: "写评论", exact: true }).click();
  await fixture.getByRole("textbox", { name: "评论草稿" }).waitFor();
  await fixture.getByRole("button", { name: "暂存并关闭", exact: true }).click();
  const feedWidth = (await fixture.locator(".feed-pane").boundingBox()).width;
  const handle = await fixture.locator(".splitter").boundingBox();
  await fixture.mouse.move(handle.x + handle.width / 2, 200);
  await fixture.mouse.down(); await fixture.mouse.move(handle.x + 72, 200); await fixture.mouse.up();
  assert.ok((await fixture.locator(".feed-pane").boundingBox()).width > feedWidth + 50);
  await fixture.setViewportSize({ width: 900, height: 860 });
  assert.ok((await fixture.locator(".detail-pane").boundingBox()).width >= 390, "Resizing after dragging must keep a usable reader");
  await fixture.setViewportSize({ width: 1280, height: 860 });
  await fixture.locator(".news-row.selected").click();
  await fixture.locator(".welcome").waitFor();
  await fixture.locator(".news-row").first().click();
  await fixture.locator(".reader").waitFor();
  assert.equal(await fixture.evaluate(() => !window.dispatchEvent(new MouseEvent("contextmenu", { cancelable: true }))), true);
  for (const key of ["F12", "I", "J", "C", "U"]) assert.equal(await fixture.evaluate((key) => !window.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: key !== "F12", shiftKey: ["I", "J", "C"].includes(key), cancelable: true })), key), true);
  await fs.mkdir("test-results", { recursive: true });
  await fixture.locator(".detail-pane").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await fixture.locator(".official-emoji img").first().waitFor();
  await fixture.waitForFunction(() =>
    [...document.querySelectorAll(".official-emoji img")].some(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  await fixture.screenshot({ path: "test-results/comments-desktop.png" });
  await fixture.getByRole("button", { name: "切换深色", exact: true }).click();
  await fixture.locator(".app.dark").waitFor();
  await fixture.setViewportSize({ width: 375, height: 860 });
  await fixture.locator(".detail-pane").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await fixture.screenshot({ path: "test-results/comments-mobile-dark.png" });
  await fixture.setViewportSize({ width: 1280, height: 860 });
  await fixture.getByRole("button", { name: "切换浅色", exact: true }).click();
  await fixture.locator(".app.light").waitFor();
  await fixture.getByRole("button", { name: "资讯", exact: true }).click();
  await fixture.locator(".welcome").waitFor();
  assert.equal(await fixture.locator(".reader").count(), 0);
  await fixture.getByRole("button", { name: "我的", exact: true }).click();
  await fixture
    .locator(".account-shortcuts")
    .getByRole("button", { name: "收藏", exact: true })
    .click();
  await fixture.locator(".account-row").nth(19).waitFor();
  await fixture.getByRole("button", { name: "加载更多", exact: true }).click();
  await fixture.locator(".account-row").nth(20).waitFor();
  const topbar = await fixture.locator(".topbar").boundingBox();
  assert.ok(topbar.x + topbar.width >= 1278, "Account header must cover the content width");
  await fixture.locator(".detail-pane").evaluate((element) => { element.scrollTop = 600; });
  const fixed = await fixture.locator(".account-shortcuts").boundingBox();
  const scroller = await fixture.locator(".detail-pane").boundingBox();
  assert.ok(Math.abs(fixed.y - scroller.y) <= 2, "Four account shortcuts must remain pinned");
  await fixture.locator(".detail-pane").evaluate((element) => { element.scrollTop = 0; });
  await fixture
    .getByRole("button", { name: "取消收藏", exact: true })
    .first()
    .click();
  await fixture
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await fixture.waitForFunction(() =>
    window.__fixture.calls.some((call) => call.kind === "favorite-remove"),
  );
  await fixture.getByRole("button", { name: "黑名单", exact: true }).click();
  await fixture.getByText("屏蔽测试用户", { exact: true }).waitFor();
  await fixture.getByRole("button", { name: "解除屏蔽", exact: true }).click();
  await fixture
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await fixture.waitForFunction(() => window.__fixture.blocks.length === 0);
  await fixture.getByRole("button", { name: "我的草稿", exact: true }).click();
  await fixture.getByText("测试草稿", { exact: true }).waitFor();
  await fixture.getByRole("button", { name: "消息", exact: true }).click();
  await fixture.getByText("未读 3", { exact: true }).waitFor();
  await fixture.locator(".message-summary").click();
  await fixture.getByText("通知测试正文", { exact: true }).waitFor();
  await fixture.getByRole("tab", { name: "新闻回复", exact: true }).click();
  await fixture.locator(".message-reply").waitFor();
  await fixture.getByRole("tab", { name: "圈子回复", exact: true }).click();
  await fixture.getByText("圈子回复测试", { exact: true }).waitFor();
  await fixture.screenshot({ path: "test-results/messages-fixture.png" });
  await fixture.setViewportSize({ width: 375, height: 860 });
  assert.equal(await fixture.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await fixture.screenshot({ path: "test-results/messages-mobile-fixture.png" });
  await fixture.setViewportSize({ width: 1280, height: 860 });
  await fixture.getByRole("button", { name: "圈子", exact: true }).click();
  await fixture.locator(".circle-open").first().click();
  await fixture.getByRole("button", { name: "写评论", exact: true }).waitFor();
  await fixture.getByRole("button", { name: "点赞 2", exact: true }).click();
  await fixture.getByRole("button", { name: "已赞 3", exact: true }).waitFor();
  await fixture.locator(".circle-post-actions").getByRole("button", { name: "收藏", exact: true }).click();
  await fixture.getByRole("button", { name: "已收藏", exact: true }).waitFor();
  await fixture.locator(".circle-comment").getByRole("button", { name: "回复", exact: true }).click();
  await fixture.getByRole("textbox", { name: "圈子草稿" }).fill("测试圈子评论草稿");
  await fixture.getByRole("button", { name: "暂存并关闭", exact: true }).click();
  await fixture.locator(".circle-comment").getByRole("button", { name: "回复", exact: true }).click();
  await fixture.waitForFunction(() => document.querySelector('[aria-label="圈子草稿"]')?.value === "测试圈子评论草稿");
  await fixture.getByRole("button", { name: "发表回复", exact: true }).click();
  await fixture.getByRole("dialog").waitFor({ state: "hidden" });
  assert.ok(await fixture.evaluate(() => window.__fixture.calls.some((call) => call.kind === "reply" && call.id === 77 && call.reply === 78 && call.body === "测试圈子评论草稿")));
  await fixture.getByRole("button", { name: "发帖", exact: true }).click();
  await fixture.getByRole("textbox", { name: "圈子草稿" }).fill("测试圈子动态草稿");
  await fixture.evaluate(() => { window.__fixture.failCircleWrite = true; });
  await fixture.getByRole("button", { name: "发布动态", exact: true }).click();
  await fixture.getByRole("alert").getByText(/操作结果待确认/).waitFor();
  assert.equal(await fixture.getByRole("textbox", { name: "圈子草稿" }).inputValue(), "测试圈子动态草稿");
  await fixture.waitForTimeout(700);
  assert.equal(await fixture.evaluate(() => window.__fixture.calls.filter((call) => call.kind === "post").length), 1, "Uncertain submissions must never auto retry");
  await fixture.getByRole("button", { name: "暂存并关闭", exact: true }).click();
  await fixture.getByRole("button", { name: "发帖", exact: true }).click();
  await fixture.waitForFunction(() => document.querySelector('[aria-label="圈子草稿"]')?.value === "测试圈子动态草稿");
  await fixture.setViewportSize({ width: 375, height: 860 });
  assert.equal(await fixture.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await fixture.waitForTimeout(350);
  await fixture.screenshot({ path: "test-results/circle-compose-mobile-fixture.png" });
  await fixture.setViewportSize({ width: 1280, height: 860 });
  await fixture.evaluate(() => { window.__fixture.failCircleWrite = false; });
  await fixture.waitForTimeout(350);
  await fixture.screenshot({ path: "test-results/circle-compose-fixture.png" });
  await fixture.getByRole("button", { name: "发布动态", exact: true }).click();
  await fixture.getByRole("dialog").waitFor({ state: "hidden" });
  assert.ok(await fixture.evaluate(() => window.__fixture.calls.some((call) => call.kind === "post" && call.id === 0 && call.topic === 4030)));
  await fixture
    .getByRole("button", { name: "设置", exact: true })
    .last()
    .click();
  await fixture.locator(".settings-sections").getByRole("button", { name: "账号", exact: false }).click();
  await fixture.getByRole("switch", { name: "只读模式", exact: true }).click();
  assert.equal(
    await fixture.evaluate(() => window.__fixture.settings.readOnly),
    true,
  );
  await fs.mkdir("test-results", { recursive: true });
  await fixture.screenshot({ path: "test-results/settings-desktop.png" });
  for (const name of ["外观", "阅读", "存储", "关于"]) {
    await fixture.locator(".settings-sections").getByRole("button", { name, exact: false }).click();
    await fixture.screenshot({ path: 'test-results/settings-' + name + '.png' });
  }
  const writesBeforeReadonly = await fixture.evaluate(() => window.__fixture.calls.filter((call) => call.command === "circle_action").length);
  await fixture.getByRole("button", { name: "圈子", exact: true }).click();
  assert.equal(await fixture.getByRole("button", { name: "发帖", exact: true }).isDisabled(), true);
  await fixture.locator(".circle-open").first().click();
  assert.equal(await fixture.getByRole("button", { name: "写评论", exact: true }).isDisabled(), true);
  assert.equal(await fixture.evaluate(() => window.__fixture.calls.filter((call) => call.command === "circle_action").length), writesBeforeReadonly);
  await fixture.getByRole("button", { name: "我的", exact: true }).click();
  await fixture.getByRole("button", { name: "返回账号首页" }).click();
  await fixture.screenshot({ path: "test-results/account-desktop.png" });
  await fixture.getByRole("button", { name: "重新授权", exact: true }).click();
  await fixture.getByRole("button", { name: "微信扫码", exact: true }).click();
  assert.ok(
    await fixture.evaluate(() =>
      window.__fixture.calls.some((call) => call.kind === "login-wechat"),
    ),
  );
  await fixture.evaluate(() => {
    const state = window.__fixture;
    state.callbacks[state.listeners["official-login-ready"]]({
      event: "official-login-ready",
      payload: null,
    });
  });
  await fixture.getByRole("dialog").waitFor({ state: "hidden" });
  await fixture.setViewportSize({ width: 375, height: 860 });
  await fixture.screenshot({ path: "test-results/account-mobile.png" });
  const nav = await fixture.locator(".sidebar").boundingBox();
  assert.ok(
    nav.height <= 62 && nav.height >= 54,
    "Mobile navigation must remain compact",
  );
  assert.deepEqual(errors, []);
  report.fixtures = {
    cloudFavoritePagination: "pass",
    cloudFavoriteRemoval: "pass",
    blacklistFilterAndUnblock: "pass",
    drafts: "pass",
    readOnly: "pass",
    clearReader: "pass",
    qrAutoSync: "pass",
    mobileNavigationHeight: nav.height,
    stickyAccountShortcuts: "pass",
    messagesAndSystemConversations: "pass",
    circleWriteIdentityAndDraftRecovery: "pass",
    uncertainCircleSubmissionNoAutoRetry: "pass",
  };
  await fixture.close();

  const qr = await browser.newPage({ viewport: { width: 460, height: 600 } });
  await qr.addInitScript({ path: "src-tauri/src/official-login.js" });
  for (const mode of ["wechat", "app"]) {
    await qr.goto(
      `https://my.ruanmei.com/user-login/index.htm?forsid=https%3A%2F%2Fwww.ithome.com%2F&cliextra=ithome&desktopMode=${mode}`,
    );
    await qr.locator(".qr-panel .panel-title").waitFor({ timeout: 30000 });
    await qr.waitForFunction(
      (mode) =>
        document
          .querySelector(".qr-panel .panel-title")
          ?.textContent?.includes(mode === "app" ? "IT之家" : "微信"),
      mode,
    );
    assert.equal(await qr.locator(".form-panel").isVisible(), false);
    await qr.waitForFunction(
      () =>
        !!document.querySelector(".qr-code img, .qr-code svg, .qr-code canvas"),
    );
    report.qr[mode] = "official QR displayed; phone confirmation not performed";
  }
  await qr.close();
  await fs.writeFile(
    "test-results/features-report.json",
    JSON.stringify(report, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
