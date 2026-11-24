import { test } from "node:test";
import assert from "node:assert/strict";
import { accountRows } from "../src/account-domain.ts";
test("official favorites preserve IDs, deletion state and ordering", () => {
  const rows = accountRows("favorites", [
    {
      newsId: 1031291,
      title: "优惠",
      newsPostDate: "2026-11-24T09:41:00",
      isNewsDeleted: true,
    },
  ]);
  assert.equal(rows[0].newsId, 1031291);
  assert.equal(rows[0].deleted, true);
  assert.throws(() => accountRows("favorites", { unexpected: [] }));
});
test("account comments keep their article and official source", () => {
  const rows = accountRows("comments", [
    {
      news: { id: 123, title: "原文" },
      comment: {
        id: 456,
        elements: [{ type: 0, content: "内容[微笑]" }],
        deviceTailModel: { name: "Windows" },
      },
    },
  ]);
  assert.equal(rows[0].newsId, 123);
  assert.equal(rows[0].id, 456);
  assert.equal(rows[0].text, "内容[微笑]");
  assert.deepEqual(rows[0].tail, { name: "Windows" });
});
test("account post feeds exclude structural rows and retain the actual post ID", () => {
  const rows = accountRows("posts", {
    list: [
      { feedType: 9, feedContent: { id: 5 } },
      {
        feedType: 2,
        feedContent: { id: 6, contents: [{ type: 0, content: "帖子" }] },
      },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].postId, 6);
  assert.equal(rows[0].text, "帖子");
});
test("official blacklist fields and draft reply identities remain distinct", () => {
  assert.equal(
    accountRows("blacklist", [{ UserID: 10, UserNick: "测试" }])[0].userId,
    10,
  );
  const drafts = accountRows("drafts", [
    { newsId: 999999999, replyId: 0, body: "主评" },
    { newsId: 999999999, replyId: 12, body: "回复" },
  ]);
  assert.notEqual(drafts[0].id, drafts[1].id);
});
