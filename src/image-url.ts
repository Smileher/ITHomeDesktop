// Verified against the same BCE resize syntax returned by official circle feeds.
// Keep original URLs separately for the viewer and image download.
export function imagePreview(url: string, width: number): string {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      !["img.ithome.com", "qimg.ithome.com"].includes(parsed.hostname) ||
      !/\.(?:jpe?g|png|webp)$/i.test(parsed.pathname) ||
      !/^\/(?:newsuploadfiles|news\/uploaded|newfiles)\//.test(parsed.pathname)
    ) return url;
    // Existing server-generated thumbnails already specify their own dimensions.
    if (!parsed.searchParams.has("x-bce-process"))
      parsed.searchParams.set("x-bce-process", `image/auto-orient,o_1/quality,q_75/resize,m_lfit,w_${width}/format,f_webp`);
    return parsed.href;
  } catch {
    return url;
  }
}
