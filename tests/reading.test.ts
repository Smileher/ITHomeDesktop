import { test } from "node:test";
import assert from "node:assert/strict";
import { imagePreview } from "../src/image-url.ts";
import { avatarUrl, accountRows } from "../src/account-domain.ts";
test("display images use the verified CDN transform while preserving original URL and unknown hosts", () => {
  const source = "https://img.ithome.com/newsuploadfiles/2026/11/example.png";
  const preview = new URL(imagePreview(source, 960));
  assert.ok(preview.searchParams.get("x-bce-process")?.includes("w_960"));
  assert.equal(source.includes("?"), false);
  assert.equal(imagePreview("https://elsewhere.test/image.png", 320), "https://elsewhere.test/image.png");
  assert.equal(imagePreview("https://avatar.ithome.com/avatars/002/55/36/13_60.jpg", 320), "https://avatar.ithome.com/avatars/002/55/36/13_60.jpg");
  const serverThumb = `${source}?x-bce-process=image/resize,m_lfit,w_1000`;
  assert.equal(imagePreview(serverThumb, 320), serverThumb);
});
test("official avatars retain zero padded IDs and replies link to their content rather than comment ID", () => {
  assert.equal(avatarUrl(2553613), "https://avatar.ithome.com/avatars/002/55/36/13_60.jpg");
  assert.equal(avatarUrl(0), "");
  const reply = accountRows("replies", { list: [{ id: 6789375, contentId: 906459, contents: [{ type: 0, content: "回复" }] }] });
  assert.equal(reply[0].id, 6789375);
  assert.equal(reply[0].postId, 906459);
});
