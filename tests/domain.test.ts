import { test } from "node:test";
import assert from "node:assert/strict";
import {
  articleId,
  articleUrl,
  cursorFor,
  mergeComments,
  mergeNews,
  enrichCommentSources,
} from "../src/domain.ts";
import type { NewsItem, OfficialComment } from "../src/types.ts";

const item = (id: number, date = "2026-11-23T10:00:00"): NewsItem => ({
  id,
  title: `News ${id}`,
  date,
  orderDate: date,
  summary: "",
  image: "",
  url: articleUrl(id),
  comments: 0,
  forbidComment: false,
});
test("official links roundtrip without accepting lookalike domains", () => {
  assert.equal(articleUrl(1030761), "https://www.ithome.com/1/030/761.htm");
  assert.equal(articleUrl(655926), "https://www.ithome.com/0/655/926.htm");
  assert.equal(articleId("https://m.ithome.com/html/1030761.htm"), 1030761);
  assert.equal(articleId(articleUrl(1030761)), 1030761);
  assert.equal(
    articleId("https://www.ithome.com.evil.test/1/030/761.htm"),
    null,
  );
  assert.equal(articleId("javascript:alert(1)"), null);
  assert.throws(() => articleUrl(0));
});
test("pagination preserves server ordering, deduplicates IDs and keeps the actual cursor", () => {
  const values = mergeNews(
    [item(3), item(2)],
    [item(2), item(1, "2026-11-22T09:00:00")],
  );
  assert.deepEqual(
    values.map((v) => v.id),
    [3, 2, 1],
  );
  assert.equal(cursorFor(values), "2026-11-22T09:00:00");
  assert.equal(cursorFor([...values, { ...item(4), pinned: true }]), "2026-11-22T09:00:00");
  assert.equal(
    mergeNews(
      [],
      Array.from({ length: 600 }, (_, i) => item(i + 1)),
    ).length,
    500,
  );
});
test("comment refresh updates known rows without duplicate floors", () => {
  const before = { id: 1, support: 2 } as OfficialComment;
  const after = { id: 1, support: 3 } as OfficialComment;
  const result = mergeComments([before], [after, { id: 2 } as OfficialComment]);
  assert.equal(result.length, 2);
  assert.equal(result[0].support, 3);
});
test("source enrichment matches comment IDs and preserves permission and user state", () => {
  const web = {
    canComment: false,
    userId: 1,
    comments: [{ id: 10, deviceTailModel: null as unknown, children: [{ id: 11, tail: null as string | null }] }],
  };
  const app = { userId: 9, canComment: true, comments: [
    { id: 10, deviceTailModel: { name: "ThinkBook 14", extraTails: [] }, children: [{ id: 11, tail: "Xiaomi 14 Ultra" }] },
    { id: 999, deviceTailModel: { name: "unrelated" } },
  ] };
  enrichCommentSources(web, app);
  assert.equal(web.canComment, false);
  assert.equal(web.userId, 1);
  assert.equal(web.comments.length, 1);
  assert.deepEqual(web.comments[0].deviceTailModel, { name: "ThinkBook 14", extraTails: [] });
  assert.equal(web.comments[0].children[0].tail, "Xiaomi 14 Ultra");
});
