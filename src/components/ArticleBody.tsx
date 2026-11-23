import { useEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import { backend } from "../bridge";
import { articleId, errorText } from "../domain";

export function sanitizeArticle(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "div",
      "span",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "a",
      "img",
      "figure",
      "figcaption",
      "blockquote",
      "ul",
      "ol",
      "li",
      "br",
      "hr",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "pre",
      "code",
      "video",
      "audio",
      "source",
      "picture",
      "sup",
      "sub",
    ],
    ALLOWED_ATTR: [
      "href",
      "src",
      "alt",
      "title",
      "width",
      "height",
      "controls",
      "poster",
      "type",
      "colspan",
      "rowspan",
      "srcset",
      "media",
    ],
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ["style", "onerror", "onclick"],
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
}
export default function ArticleBody({
  html,
  onArticle,
  onImage,
  onError,
}: {
  html: string;
  onArticle: (id: number) => void;
  onImage: (sourceUrl: string, displayUrl?: string) => void;
  onError: (text: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const clean = useMemo(() => sanitizeArticle(html), [html]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let live = true;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          const image = entry.target as HTMLImageElement;
          const src = image.dataset.originalSrc;
          if (src)
            void backend
              .image(src)
              .then((value) => {
                if (live && image.isConnected) image.src = value;
              })
              .catch(() => {});
        }
      },
      { rootMargin: "150px" },
    );
    element.querySelectorAll("img").forEach((img) => {
      const raw = img.getAttribute("src") || "";
      const src = raw.startsWith("//") ? "https:" + raw : raw;
      if (!src.startsWith("https://")) {
        img.removeAttribute("src");
        return;
      }
      img.src = src;
      img.dataset.originalSrc = src;
      img.loading = "lazy";
      img.decoding = "async";
      img.removeAttribute("srcset");
      img.removeAttribute("width");
      img.removeAttribute("height");
      observer.observe(img);
    });
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [clean]);
  return (
    <div
      ref={root}
      className="article-body"
      dangerouslySetInnerHTML={{ __html: clean }}
      onClick={(event) => {
        const element = event.target as HTMLElement;
        const image = element.closest("img");
        if (image) {
          event.preventDefault();
          const url = image.dataset.originalSrc;
          if (url) onImage(url, image.src);
          return;
        }
        const anchor = element.closest("a");
        if (!anchor) return;
        event.preventDefault();
        const url = anchor.getAttribute("href");
        if (!url) return;
        const id = articleId(url);
        if (id) onArticle(id);
        else {
          try {
            const resolved = new URL(url, "https://www.ithome.com/").href;
            void backend
              .external(resolved)
              .catch((error) => onError(errorText(error)));
          } catch {
            onError("链接地址无效");
          }
        }
      }}
    />
  );
}
