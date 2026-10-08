/**
 * 把 app_data_dir 相对路径转为 h3video:// 协议 URL。
 * macOS/Linux: h3video://localhost/<rel>
 * Windows:     http://h3video.localhost/<rel>
 */
export function h3videoUrl(rel: string): string {
  const p = rel.startsWith("/") ? rel : `/${rel}`;
  const isWin =
    typeof navigator !== "undefined" && /Win(dows|\s*NT)/i.test(navigator.userAgent);
  return isWin ? `http://h3video.localhost${p}` : `h3video://localhost${p}`;
}
