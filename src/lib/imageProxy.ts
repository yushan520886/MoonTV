/**
 * 图片地址处理工具
 *
 * 背景：豆瓣图床（img*.doubanio.com）会校验 Referer —— 无 Referer 或来源异常时
 * 直接返回 418（I'm a teapot），图片加载失败并留下空白/灰块。
 * 另外豆瓣图床从中国大陆访问不稳定，容易超时。
 *
 * 解决顺序（三级，逐级降级）：
 *   1. 镜像 CDN 直连 —— 各大客户端（如 Selene）普遍使用的豆瓣图床反代，
 *      免 Referer 校验、由 Cloudflare 边缘分发。
 *      ★ 浏览器直接请求，**完全不经过本站服务器**，不消耗 Functions 请求额度。
 *   2. 本站 /api/image-proxy —— 镜像不可用时兜底：服务端补 Referer 后取图，
 *      并做边缘缓存。会消耗 1 次请求额度。
 *   3. 原图直连 —— 最后手段（多数情况下会 418，仅作兜底）。
 */

/** 需要特殊处理的图床域名（豆瓣系对 Referer 敏感，直连会 418） */
export const PROXY_REQUIRED_HOSTS = ['doubanio.com', 'douban.com'];

/**
 * 豆瓣图床镜像 CDN（第三方反代，免 Referer 校验）。
 * 实测：不带 Referer 直接 200，返回与原图逐字节一致的 JPEG。
 */
export const DOUBAN_MIRROR_HOST = 'img.doubanio.cmliussss.net';

/** 豆瓣图床主机形态：img1 / img2 / img3 / img9 .doubanio.com */
const DOUBAN_IMG_HOST_RE = /^img\d+\.doubanio\.com$/i;

/** 判断某个地址是否属于「需要特殊处理」的图床（豆瓣系） */
export function shouldUseImageProxy(url: string): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return PROXY_REQUIRED_HOSTS.some(
      (h) => host === h || host.endsWith(`.${h}`)
    );
  } catch {
    return false;
  }
}

/** 生成本站代理地址 */
export function toImageProxyUrl(url: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

/**
 * 改写为豆瓣镜像 CDN 地址。
 * 仅处理 img*.doubanio.com 形态；其它地址（含已是镜像的地址）返回 null。
 */
export function toDoubanMirrorUrl(url: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!DOUBAN_IMG_HOST_RE.test(parsed.hostname)) return null;
    if (parsed.hostname.toLowerCase() === DOUBAN_MIRROR_HOST) return null;
    parsed.hostname = DOUBAN_MIRROR_HOST;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * 返回某张图片的候选地址队列（按优先级）。
 *
 * - 豆瓣图床：镜像直连 → 本站代理 → 原图
 * - 其他图床：原图 → 本站代理（直连被墙/防盗链时兜底）
 */
export function getPosterCandidates(url: string): string[] {
  if (!url) return [];

  if (shouldUseImageProxy(url)) {
    const mirror = toDoubanMirrorUrl(url);
    const list = mirror
      ? [mirror, toImageProxyUrl(url), url]
      : [toImageProxyUrl(url), url];
    return Array.from(new Set(list));
  }

  return Array.from(new Set([url, toImageProxyUrl(url)]));
}
