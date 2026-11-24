import { useEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import { backend } from "../bridge";
import { loadDisplayImage, releaseDisplayImage } from "./CachedImage";
import { imagePreview } from "../image-url";
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
  showImages = true,
  onArticle,
  onImage,
  onError,
}: {
  html: string;
  showImages?: boolean;
  onArticle: (id: number) => void;
  onImage: (sourceUrl: string, displayUrl?: string) => void;
  onError: (text: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const clean = useMemo(() => {
    // Inert DOM prevents an original-image download before the cache observer runs.
    const template = document.createElement("template");
    template.innerHTML = sanitizeArticle(html);
    template.content.querySelectorAll("img").forEach((image) => {
      const raw = image.getAttribute("src") || "";
      const src = raw.startsWith("//") ? `https:${raw}` : raw;
      if (src.startsWith("https://")) image.dataset.originalSrc = src;
      image.removeAttribute("src");
      image.removeAttribute("srcset");
      image.loading = "lazy";
      image.decoding = "async";
      image.style.width = "100%";
      image.style.aspectRatio = "16/9";
      const width = Number(image.getAttribute("width"));
      const height = Number(image.getAttribute("height"));
      if (width > 0 && height > 0) image.style.aspectRatio = `${width}/${height}`;
      image.removeAttribute("width");
      image.removeAttribute("height");
    });
    template.content.querySelectorAll("source").forEach((source) => source.removeAttribute("srcset"));
    template.content.querySelectorAll("video,audio").forEach((media) => media.setAttribute("preload", "none"));
    return template.innerHTML;
  }, [html]);
  useEffect(() => {
    const element = root.current;
    if (!element || !showImages) return;
    let live = true;
    const visible = new WeakSet<Element>();
    const displayed = new Map<HTMLImageElement, string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const image = entry.target as HTMLImageElement;
          if (!entry.isIntersecting) {
            visible.delete(image);
            if (image.naturalWidth && image.naturalHeight)
              image.style.aspectRatio = `${image.naturalWidth}/${image.naturalHeight}`;
            image.removeAttribute("src");
            releaseDisplayImage(displayed.get(image) || "");
            displayed.delete(image);
            continue;
          }
          visible.add(image);
          const src = image.dataset.originalSrc;
          if (src)
            void loadDisplayImage(imagePreview(src, 960))
              .then((value) => {
                if (live && image.isConnected && visible.has(image)) {
                  releaseDisplayImage(displayed.get(image) || "");
                  displayed.set(image, value);
                  image.src = value;
                } else releaseDisplayImage(value);
              })
              .catch(() => {});
        }
      },
      { rootMargin: "500px" },
    );
    element.querySelectorAll("img").forEach((img) => {
      img.onload = () => {
        if (img.naturalWidth && img.naturalHeight)
          img.style.aspectRatio = `${img.naturalWidth}/${img.naturalHeight}`;
      };
      observer.observe(img);
    });
    return () => {
      live = false;
      observer.disconnect();
      element.querySelectorAll("img").forEach((image) => {
        image.onload = null;
        image.removeAttribute("src");
        releaseDisplayImage(displayed.get(image) || "");
      });
      displayed.clear();
      element.querySelectorAll<HTMLMediaElement>("video,audio").forEach((media) => media.pause());
    };
  }, [clean, showImages]);
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
