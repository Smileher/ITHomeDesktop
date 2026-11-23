import { useEffect, useRef, useState } from "react";
import { backend } from "../bridge";

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
function load(url: string): Promise<string> {
  let request = active.get(url);
  if (!request) {
    request = resolveImage(url)
      .catch(() => url)
      .finally(() => active.delete(url));
    active.set(url, request);
  }
  return request;
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
    if (!/^https:\/\//i.test(src)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          void load(src).then((value) => {
            if (live) setReady(value);
          });
        }
      },
      { rootMargin: "180px" },
    );
    if (ref.current) observer.observe(ref.current);
    return () => {
      live = false;
      observer.disconnect();
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
