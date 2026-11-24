import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.ITHOME_TEST_URL || "http://127.0.0.1:5173";
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 860 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const report = { live: {}, fixtures: {}, responsive: [] };
try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator(".news-row").first().waitFor({ timeout: 45000 });
  await page.locator(".reader>h1").waitFor({ timeout: 45000 });
  await page
    .locator(".comment-thread,.empty-inline,.comments .inline-error")
    .first()
    .waitFor({ timeout: 30000 });
  const title = await page.locator(".reader>h1").innerText();
  assert.ok(title.length > 5);
  await page.locator('.top-actions button[aria-label^="切换"]').hover();
  await page.getByRole("tooltip").waitFor();
  assert.equal(await page.locator(".app").count(), 1, "Tooltip portals must not inherit the app layout");
  assert.equal(await page.evaluate(() =>
    !!document.elementFromPoint(100, 100)?.closest('[data-portal-node="true"]'),
  ), false, "Tooltip portal must not cover the content");
  await page.mouse.move(3, 3);
  report.live = {
    articles: await page.locator(".news-row").count(),
    title,
    comments: await page.locator(".comment-thread").count(),
  };
  await page.getByRole("button", { name: "好物", exact: true }).click();
  await page.locator(".news-row").first().waitFor({ timeout: 45000 });
  assert.ok((await page.locator(".news-row").count()) > 0);
  report.live.deals = await page.locator(".news-row").count();
  await page.getByRole("button", { name: "资讯", exact: true }).click();
  await page.locator(".news-row").first().waitFor({ timeout: 45000 });
  await page.locator(".news-row:not(.pinned) .news-thumb img").first().waitFor({ timeout: 15000 });
  await page.locator(".reader>h1").waitFor({ timeout: 45000 });
  await fs.mkdir("test-results", { recursive: true });
  await fs.mkdir("site/assets", { recursive: true });
  await page.screenshot({ path: "test-results/live-desktop.png" });
  if (process.env.ITHOME_CAPTURE_SITE === "1") await page.screenshot({ path: "site/assets/desktop.png" });
  await page.setViewportSize({ width: 375, height: 860 });
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  const navigation = await page.locator(".sidebar").boundingBox();
  const feed = await page.locator(".feed-pane").boundingBox();
  assert.ok(
    navigation.y > feed.y &&
      navigation.width < 373 &&
      navigation.width >= 340 &&
      feed.width >= 373,
    "Phone layout must use an inset floating bar and a full-width feed",
  );
  assert.ok(
    navigation.x >= 10 && 860 - navigation.y - navigation.height >= 10,
    "Floating navigation needs outer breathing room",
  );
  await page.screenshot({ path: "test-results/live-mobile-feed.png" });
  if (process.env.ITHOME_CAPTURE_SITE === "1") await page.screenshot({ path: "site/assets/mobile.png" });
  await page.locator(".news-row").first().click();
  await page.locator(".reader>h1").waitFor();
  assert.equal(await page.locator(".feed-pane").isVisible(), false);
  await page.screenshot({ path: "test-results/live-mobile-article.png" });
  await page.locator(".detail-pane").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.locator(".comments").waitFor();
  assert.equal(await page.getByRole("textbox", { name: "评论草稿" }).count(), 0);
  await page.locator(".toolbar-comment").click();
  await page.getByRole("textbox", { name: "评论草稿" }).waitFor();
  await page.getByRole("button", { name: "暂存并关闭", exact: true }).click();
  await page.getByRole("button", { name: "我的", exact: true }).click();
  await page.locator(".mobile-account-links").waitFor();
  await page
    .locator(".account-menu")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
  await page.getByRole("button", { name: "资讯", exact: true }).click();
  assert.equal(await page.locator(".feed-pane").isVisible(), true);
  report.phone = {
    floatingNavigation: "pass",
    fullWidthList: "pass",
    articleNavigation: "pass",
    composerClearance: "pass",
    accountAndSettings: "pass",
  };
  await page.setViewportSize({ width: 1280, height: 860 });

  // Controlled responses exercise failures and draft persistence without writing to a real account.
  const news = {
    newslist: [
      {
        newsid: 1030761,
        title: "自动化测试：文章与评论的状态恢复",
        postdate: "2026-11-23T09:35:25",
        orderdate: "2026-11-23T09:35:25",
        description: "测试数据",
        image: "",
        commentcount: 1,
      },
      {
        newsid: 1030760,
        title: "自动化测试：切换文章后保留草稿",
        postdate: "2026-11-23T09:32:41",
        orderdate: "2026-11-23T09:32:41",
        image: "",
        commentcount: 0,
      },
    ],
  };
  const comment = {
    id: 100,
    city: "测试区域",
    postTime: "2026-11-23T10:00:00",
    support: 1,
    against: 0,
    userInfo: { id: 1, userNick: "测试家友", level: 1 },
    elements: [
      { type: 0, content: "仅用于离线测试的评论" },
      { type: 1, src: "https://img.ithome.com/test/comment-image.png" },
    ],
    children: [],
    floorStr: "1楼",
    replyCommentId: 0,
    parentCommentId: 0,
    deviceTailModel: "官方来源测试文本",
  };
  await page.route("**/__news/json/newslist/**", (route) =>
    route.fulfill({ json: news }),
  );
  await page.route("**/__news/json/newscontent/*", (route) => {
    const id = Number(
      new URL(route.request().url()).pathname.split("/").at(-1),
    );
    const value =
      news.newslist.find((v) => v.newsid === id) || news.newslist[0];
    return route.fulfill({
      json: {
        ...value,
        success: true,
        detail:
          '<p>受控测试正文</p><script>window.badScriptRan=true</script><img src="javascript:alert(1)">',
        newsauthor: "测试作者",
        newssource: "测试来源",
      },
    });
  });
  await page.route("**/__page/**", (route) =>
    route.fulfill({
      body: '<div id="post_comm" data-id="test-sn"></div>',
      contentType: "text/html",
    }),
  );
  await page.route("**/__comments/**", (route) =>
    route.fulfill({
      json: {
        success: true,
        content: {
          newsId: 1030761,
          userId: 0,
          userNick: null,
          canComment: true,
          cannotCommentTip: null,
          ruleHint: "测试提示",
          comments: [comment],
          hotComments: [comment],
        },
      },
    }),
  );
  await page.route("**/__appcomments/**", (route) => route.fulfill({
    json: { success: true, content: { comments: [{
      id: 100,
      deviceTailModel: { name: "ThinkBook 14", color: null, darkColor: null, extraTails: [] },
    }] } },
  }));
  await page.route("https://img.ithome.com/test/comment-image.png", (route) =>
    route.fulfill({
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
      contentType: "image/png",
    }),
  );
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: "自动化测试：文章与评论的状态恢复" })
    .waitFor();
  await page.locator(".toolbar-comment").click();
  await page
    .getByRole("textbox", { name: "评论草稿" })
    .fill("测试草稿：切换之后继续写。");
  await page.getByText("草稿已保存", { exact: true }).waitFor();
  await page.getByRole("button", { name: "暂存并关闭", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("switch", { name: "紧凑列表" }).click();
  await page.getByText("设置已保存", { exact: true }).waitFor();
  await page.getByRole("button", { name: "资讯", exact: true }).click();
  await page.locator(".toolbar-comment").click();
  await page.getByRole("textbox", { name: "评论草稿" }).waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "评论草稿" }).inputValue(),
    "测试草稿：切换之后继续写。",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".toolbar-comment").click();
  await page.getByRole("textbox", { name: "评论草稿" }).waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector("textarea")?.value ===
      "测试草稿：切换之后继续写。",
  );
  assert.equal(await page.evaluate(() => window.badScriptRan), undefined);
  assert.equal(await page.locator(".article-body script").count(), 0);
  assert.equal(await page.getByRole("button", { name: "本机收藏", exact: true }).count(), 0);
  await page.getByRole("button", { name: "登录后评论", exact: true }).click();
  await page.getByRole("dialog", { name: "登录 IT之家账号" }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "同步登录", exact: true })
      .isEnabled(),
    false,
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  const closeComposer = page.getByRole("button", { name: "暂存并关闭", exact: true });
  if (await closeComposer.isVisible()) await closeComposer.click();
  assert.equal(
    await page.locator(".comment-device-tail").first().innerText(),
    "ThinkBook 14",
  );
  await page.locator(".comment-image").first().scrollIntoViewIfNeeded();
  const commentImage = page.locator(".comment-image img").first();
  await commentImage.waitFor();
  await commentImage.click();
  await page.getByRole("heading", { name: "查看图片", exact: true }).waitFor();
  assert.ok((await page.locator(".image-view img").getAttribute("src"))?.includes("comment-image.png"));
  await page.getByRole("button", { name: "关闭图片", exact: true }).click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator(".image-dialog").count(), 0);
  report.fixtures = {
    draftSwitch: "pass",
    draftRestart: "pass",
    localFavoriteRemoved: "pass",
    settings: "pass",
    htmlSanitization: "pass",
    loginGate: "pass",
    commentImage: "pass",
  };
  for (const width of [1280, 1024, 768, 600, 420, 375, 360]) {
    await page.setViewportSize({ width, height: 860 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    assert.equal(overflow, false, `horizontal overflow at ${width}`);
    report.responsive.push({ width, pass: true });
  }
  assert.deepEqual(errors, []);
  report.runtimeErrors = errors;
  await fs.writeFile(
    "test-results/browser.json",
    JSON.stringify(report, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
