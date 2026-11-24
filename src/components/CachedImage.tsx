import { useEffect, useRef, useState } from "react";
import { backend, native } from "../bridge";
import { imagePreview } from "../image-url";

const active = new Map<string, Promise<string>>();
let running = 0;
const waiting: (() => void)[] = [];
async function resolveImage(url: string): Promise<string> {
  if (running >= 4) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await backend.image(url);
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}
export function loadImage(url: string): Promise<string> {
  let request = active.get(url);
  if (!request) {
    request = resolveImage(url)
      .catch(() => url)
      .finally(() => active.delete(url));
    active.set(url, request);
  }
  return request;
}
export async function loadDisplayImage(url: string): Promise<string> {
  const source = await loadImage(url);
  if (!native || !/^https?:\/\/asset\.localhost\//.test(source)) return source;
  try {
    // Revocable URLs let Chromium release decoded frames instead of retaining each
    // previously visited asset URL in its image cache. Originals remain on disk.
    const response = await fetch(source, { cache: "no-store" });
    if (!response.ok) return source;
    return URL.createObjectURL(await response.blob());
  } catch {
    return source;
  }
}
export function releaseDisplayImage(url: string): void {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}
export default function CachedImage({
  src,
  alt = "",
  className = "",
  onClick,
}: {
  src: string;
  alt?: string;
  className?: string;
  onClick?: (displayUrl: string) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setReady("");
    setFailed(false);
    let live = true;
    let visible = false;
    let request = 0;
    let displayed = "";
    if (!/^https:\/\//i.test(src)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        const token = ++request;
        if (visible) {
          const preview = imagePreview(src, className.includes("news-thumb") ? 320 : 720);
          void loadDisplayImage(preview).then((value) => {
            if (live && visible && token === request) {
              releaseDisplayImage(displayed);
              displayed = value;
              setReady(value);
            } else releaseDisplayImage(value);
          });
        } else {
          // Keep the sized wrapper, release decoded pixels outside the reading area.
          setReady("");
          releaseDisplayImage(displayed);
          displayed = "";
        }
      },
      { rootMargin: "300px" },
    );
    if (ref.current) observer.observe(ref.current);
    return () => {
      live = false;
      observer.disconnect();
      releaseDisplayImage(displayed);
    };
  }, [src]);
  return (
    <span className={`image-wrap ${className}`} ref={ref}>
      {ready && !failed ? (
        <img
          src={ready}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          onClick={() => onClick?.(ready)}
        />
      ) : (
        <span className="image-placeholder" aria-label={alt || "图片"}>
          {failed ? "图片暂不可用" : ""}
        </span>
      )}
    </span>
  );
}
